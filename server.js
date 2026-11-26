'use strict';
/**
 * Forex Pulse — public storefront server.
 *
 * Public: live prices, locked $20 D1 signals, Stripe Checkout, automatic
 * unlock + buyer email. Owner: /owner (passcode from OWNER_PASSCODE env).
 *
 * Required env: STRIPE_SECRET_KEY (for checkout), BASE_URL (public URL,
 * e.g. https://4xpulse.com), OWNER_PASSCODE.
 * Optional env: STRIPE_WEBHOOK_SECRET, SMTP_* (buyer email),
 * DATABASE_PATH, PORT.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('./src/db');
const prices = require('./src/prices');
const calendar = require('./src/calendar');
const views = require('./src/views');
const auth = require('./src/auth');
const mail = require('./src/mail');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SIGNAL_PRICE_CENTS = 2000; // $20 per signal, no sales tax collected

let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('WARNING: STRIPE_SECRET_KEY not set — checkout is disabled until it is configured.');
}

// Minimal cookie parsing (no extra dependency).
app.use((req, res, next) => {
  req.cookies = {};
  const header = req.headers.cookie;
  if (header) {
    header.split(';').forEach((part) => {
      const i = part.indexOf('=');
      if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
  }
  next();
});

// Stripe webhook needs the raw body — register before express.json().
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send('Webhook not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return res.status(400).send('Bad signature');
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    await fulfillOrder(session, 'webhook');
  }
  res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

// --- helpers ---------------------------------------------------------------
const NY = 'America/New_York';
function todayInNY(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: NY, year: 'numeric', month: '2-digit', day: 'numeric' }).format(d);
}
function isToday(iso) { return todayInNY(new Date(iso)) === todayInNY(); }

function unlockedSignalIds(req) {
  const ids = new Set();
  try {
    const tokens = JSON.parse(req.cookies.fp_unlocks || '[]');
    for (const t of tokens) {
      const o = db.getOrderByToken(t);
      if (o && o.status === 'paid') ids.add(o.signal_id);
    }
  } catch (_) { /* ignore bad cookie */ }
  return ids;
}

function buildSummary(signals, priceByPair) {
  const newToday = signals.filter((s) => isToday(s.created_at));
  const openToday = signals.filter((s) => s.status === 'open').map((s) => ({
    ...s, pips: prices.pipsFor(s, priceByPair[s.pair]),
  }));
  const resolvedToday = signals.filter((s) => (s.status === 'won' || s.status === 'lost') && s.closed_at && isToday(s.closed_at));
  return {
    dateLabel: new Date().toLocaleDateString('en-US', { timeZone: NY, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    newToday,
    buysToday: newToday.filter((s) => s.direction === 'BUY').length,
    sellsToday: newToday.filter((s) => s.direction === 'SELL').length,
    openToday,
    resolvedToday,
  };
}

async function sendUnlockEmailForOrder(order) {
  const signal = db.getSignal(order.signal_id);
  if (!signal) return;
  const unlockUrl = `${BASE_URL}/unlock/${order.access_token}`;
  const result = await mail.sendUnlockEmail({
    buyerName: order.buyer_name, buyerEmail: order.buyer_email, signal, unlockUrl,
  });
  if (result.sent) db.setOrderEmailStatus(order.id, 'sent');
  else if (result.reason === 'not_configured') db.setOrderEmailStatus(order.id, 'not_configured');
  else db.setOrderEmailStatus(order.id, 'failed', result.error || 'unknown error');
}

/** Mark an order paid (idempotent) and send the unlock email. */
async function fulfillOrder(session, source) {
  const order = db.getOrderBySession(session.id);
  if (!order) { console.error(`[${source}] No order for Stripe session ${session.id}`); return null; }
  if (order.status === 'paid') return order;
  const paid = db.markOrderPaid(order.id, session.payment_intent || null);
  await sendUnlockEmailForOrder(paid);
  console.log(`[${source}] Order #${paid.id} paid; signal #${paid.signal_id} unlocked for ${paid.buyer_email}`);
  return paid;
}

// --- public routes ---------------------------------------------------------
app.get('/', async (req, res) => {
  try {
    const [{ prices: priceList, updatedAt }, cal] = await Promise.all([
      prices.getPrices(),
      calendar.getUpcomingEvents(),
    ]);
    prices.evaluateSignals(db, priceList);
    const priceByPair = Object.fromEntries(priceList.map((p) => [p.pair, p.price]));
    const signals = db.listSignals();
    const summary = buildSummary(signals, priceByPair);
    const newPairsToday = new Set(signals.filter((s) => isToday(s.created_at)).map((s) => s.pair));
    res.send(views.publicPage({
      prices: priceList,
      updatedAt,
      signals,
      summary,
      winLoss: db.countWonLost(),
      newPairsToday,
      unlockedIds: unlockedSignalIds(req),
      priceByPair,
      calendar: cal,
    }));
  } catch (e) {
    console.error('Homepage error:', e);
    res.status(500).send('Something went wrong loading Forex Pulse. Please try again.');
  }
});

app.get('/api/prices', async (req, res) => {
  try {
    const data = await prices.getPrices();
    prices.evaluateSignals(db, data.prices);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Price fetch failed' });
  }
});

// Create an order + Stripe Checkout session for a locked signal.
app.post('/api/orders', async (req, res) => {
  const { signal_id, name, email } = req.body || {};
  const signal = Number.isInteger(Number(signal_id)) ? db.getSignal(Number(signal_id)) : null;
  if (!signal || signal.status !== 'open') return res.status(404).json({ error: 'Signal not available.' });
  if (!name || typeof name !== 'string' || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Please provide your name and a valid email.' });
  }
  if (!stripe) return res.status(503).json({ error: 'Payments are not configured yet. Please try again later.' });
  const token = crypto.randomBytes(24).toString('hex');
  const order = db.createOrder({ signalId: signal.id, buyerName: name.trim(), buyerEmail: email.trim(), accessToken: token });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: SIGNAL_PRICE_CENTS,
          product_data: { name: `Forex Pulse Signal — ${signal.pair} ${signal.direction}` },
        },
        quantity: 1,
      }],
      metadata: { order_id: String(order.id), signal_id: String(signal.id) },
      customer_email: order.buyer_email,
      success_url: `${BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${BASE_URL}/?checkout=cancelled`,
    });
    db.setOrderSession(order.id, session.id);
    res.json({ checkoutUrl: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

// Return from Stripe Checkout — verify payment server-side (covers webhooks
// that arrive late) and show the unlocked signal.
app.get('/success', async (req, res) => {
  const sessionId = req.query.session_id;
  if (!stripe || !sessionId) return res.send(views.successPage({ order: null, signal: null }));
  try {
    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    let order = db.getOrderBySession(session.id);
    if (session.payment_status === 'paid' && order) {
      order = await fulfillOrder(session, 'success-page');
      const signal = db.getSignal(order.signal_id);
      // Remember this unlock in a cookie so the signal shows unlocked on the storefront.
      try {
        const existing = JSON.parse(req.cookies.fp_unlocks || '[]');
        const merged = [...new Set([...existing, order.access_token])];
        res.cookie('fp_unlocks', JSON.stringify(merged), { httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
      } catch (_) {
        res.cookie('fp_unlocks', JSON.stringify([order.access_token]), { httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
      }
      return res.send(views.successPage({ order, signal, emailSent: order.email_status === 'sent' }));
    }
    return res.send(views.successPage({ order: null, signal: null }));
  } catch (e) {
    console.error('Success page error:', e.message);
    return res.send(views.successPage({ order: null, signal: null }));
  }
});

// Durable unlock link (also sent in the buyer email).
app.get('/unlock/:token', (req, res) => {
  const order = db.getOrderByToken(req.params.token);
  const signal = order ? db.getSignal(order.signal_id) : null;
  if (order && order.status === 'paid') {
    try {
      const existing = JSON.parse(req.cookies.fp_unlocks || '[]');
      const merged = [...new Set([...existing, order.access_token])];
      res.cookie('fp_unlocks', JSON.stringify(merged), { httpOnly: true, maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
    } catch (_) { /* ignore */ }
  }
  res.send(views.unlockPage({ order, signal }));
});

// --- owner routes ----------------------------------------------------------
app.get('/owner/login', (req, res) => {
  if (auth.ownerLoggedIn(req)) return res.redirect('/owner');
  res.send(views.ownerLoginPage(null));
});

app.post('/owner/login', (req, res) => {
  if (auth.passcodeOk(req.body.passcode)) {
    res.cookie('fp_owner', auth.makeOwnerCookie(), { httpOnly: true, maxAge: 12 * 60 * 60 * 1000, path: '/' });
    return res.redirect('/owner');
  }
  res.status(401).send(views.ownerLoginPage('Incorrect passcode. Try again.'));
});

app.get('/owner/logout', (req, res) => {
  res.clearCookie('fp_owner', { path: '/' });
  res.redirect('/');
});

app.get('/owner', auth.requireOwner, (req, res) => {
  res.send(views.ownerPage({
    signals: db.listSignals(),
    orders: db.listOrders(),
    smtpConfigured: mail.smtpConfigured(),
    notice: req.query.notice || null,
    error: req.query.error || null,
  }));
});

function validSignalInput(direction, pair, entry, tp, sl) {
  if (!prices.PAIRS.some((p) => p.pair === pair)) return 'Unknown pair.';
  const e = Number(entry), t = Number(tp), s = Number(sl);
  if (![e, t, s].every((v) => Number.isFinite(v) && v > 0)) return 'Entry, take profit and stop loss must be positive numbers.';
  if (direction === 'BUY' && !(t > e && s < e)) return 'For a BUY, take profit must be above entry and stop loss below entry.';
  if (direction === 'SELL' && !(t < e && s > e)) return 'For a SELL, take profit must be below entry and stop loss above entry.';
  return null;
}

app.post('/owner/signals', auth.requireOwner, (req, res) => {
  const { direction, pair, entry, take_profit, stop_loss } = req.body;
  const err = validSignalInput(direction, pair, entry, take_profit, stop_loss);
  if (err) return res.redirect(`/owner?error=${encodeURIComponent(err)}`);
  db.createSignal({ pair, direction, entry: Number(entry), takeProfit: Number(take_profit), stopLoss: Number(stop_loss) });
  res.redirect('/owner?notice=' + encodeURIComponent(`${direction} signal for ${pair} posted.`));
});

app.post('/owner/signals/:id/close', auth.requireOwner, (req, res) => {
  db.setSignalStatus(Number(req.params.id), 'closed');
  res.redirect('/owner');
});
app.post('/owner/signals/:id/won', auth.requireOwner, (req, res) => {
  db.setSignalStatus(Number(req.params.id), 'won');
  res.redirect('/owner');
});
app.post('/owner/signals/:id/lost', auth.requireOwner, (req, res) => {
  db.setSignalStatus(Number(req.params.id), 'lost');
  res.redirect('/owner');
});
app.post('/owner/signals/:id/delete', auth.requireOwner, (req, res) => {
  db.deleteSignal(Number(req.params.id));
  res.redirect('/owner');
});

app.post('/owner/orders/:id/resend', auth.requireOwner, async (req, res) => {
  const order = db.getOrder(Number(req.params.id));
  if (!order) return res.redirect('/owner?error=' + encodeURIComponent('Order not found.'));
  if (order.status !== 'paid') return res.redirect('/owner?error=' + encodeURIComponent('Only paid orders can be emailed.'));
  await sendUnlockEmailForOrder(order);
  const after = db.getOrder(order.id);
  const msg = after.email_status === 'sent'
    ? `Confirmation email sent to ${after.buyer_email}.`
    : `Email could not be sent (${after.email_status}). Buyer email and signal details are shown in Orders — send it manually.`;
  res.redirect('/owner?notice=' + encodeURIComponent(msg));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Forex Pulse storefront listening on port ${PORT}`);
  console.log(`Stripe: ${stripe ? 'configured' : 'NOT configured (STRIPE_SECRET_KEY missing)'}`);
  console.log(`Email: ${mail.smtpConfigured() ? 'SMTP configured' : 'NOT configured — buyer emails will show as manual-send in Orders'}`);
});
