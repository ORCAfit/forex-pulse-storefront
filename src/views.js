'use strict';
/**
 * Server-rendered HTML. Layout order (per the owner's spec):
 *   "Forex Pulse" title → live prices → Forex signals ($20 each)
 *   → daily summary below the signals → D1 note under the signals
 *   → risk note + Owner link only at the bottom.
 */
const { PAIRS, pipsFor } = require('./prices');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtPrice = (pair, v) => {
  if (typeof v !== 'number') return '—';
  const d = PAIRS.find((p) => p.pair === pair)?.decimals ?? 4;
  return v.toFixed(d);
};

const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', {
  timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});

function sparklineSvg(points, up) {
  if (!points || points.length < 2) return '<span class="spark-empty">—</span>';
  const w = 90, h = 28, min = Math.min(...points), max = Math.max(...points);
  const range = max - min || 1;
  const step = w / (points.length - 1);
  const pts = points.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - ((v - min) / range) * (h - 6)).toFixed(1)}`).join(' ');
  const color = up === null ? '#9aa4b2' : up ? '#22c55e' : '#ef4444';
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
}

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Forex Pulse</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="wrap">${body}</div>
<script src="/app.js"></script>
</body>
</html>`;
}

function priceRow(p, isNew) {
  const up = p.changePct == null ? null : p.changePct >= 0;
  const cls = ['pair-row'];
  if (isNew) cls.push('pair-new');
  if (p.price == null) cls.push('pair-error');
  const change = p.changePct == null ? '—'
    : `${up ? '▲' : '▼'} ${Math.abs(p.changePct).toFixed(2)}%`;
  const badge = p.source === 'daily' ? '<span class="tag tag-daily">Daily rate</span>'
    : p.source === 'unavailable' ? '<span class="tag tag-error">Unavailable</span>' : '';
  const newBadge = isNew ? '<span class="tag tag-new">NEW</span>' : '';
  const detail = p.price == null
    ? '<div class="pair-detail">Price failed to load — please try Refresh.</div>'
    : `<div class="pair-detail">
        <span>Open <b>${fmtPrice(p.pair, p.open)}</b></span>
        <span>High <b>${fmtPrice(p.pair, p.dayHigh)}</b></span>
        <span>Low <b>${fmtPrice(p.pair, p.dayLow)}</b></span>
        <span>Prev close <b>${fmtPrice(p.pair, p.prevClose)}</b></span>
        ${isNew ? `<button class="linklike view-signal" data-pair="${esc(p.pair)}">View new signal →</button>` : ''}
      </div>`;
  return `<div class="${cls.join(' ')}" data-pair="${esc(p.pair)}" data-new="${isNew ? '1' : ''}" tabindex="0" role="button" aria-label="${esc(p.pair)} price details">
    <div class="pair-main">
      <span class="pair-name">${esc(p.pair)} ${newBadge} ${badge}</span>
      <span class="pair-price">${fmtPrice(p.pair, p.price)}</span>
      <span class="pair-change ${up === null ? '' : up ? 'up' : 'down'}">${change}</span>
      ${sparklineSvg(p.sparkline, up)}
    </div>
    ${detail}
  </div>`;
}

function signalCard(s, opts) {
  const { unlocked, livePips } = opts;
  const dirCls = s.direction === 'BUY' ? 'buy' : 'sell';
  const dirLabel = s.direction === 'BUY' ? 'BUY signal' : 'SELL signal';
  const statusBadge = s.status === 'open' ? '' : `<span class="tag tag-${s.status}">${s.status.toUpperCase()}</span>`;
  let body;
  if (s.status === 'open' && unlocked) {
    body = `<div class="sig-levels">
      <span>Entry <b>${esc(s.entry)}</b></span>
      <span>Take profit <b>${esc(s.take_profit)}</b></span>
      <span>Stop loss <b>${esc(s.stop_loss)}</b></span>
      <span>Live pips <b class="${livePips == null ? '' : livePips >= 0 ? 'up' : 'down'}">${livePips == null ? '—' : (livePips >= 0 ? '+' : '') + livePips}</b></span>
    </div>
    <p class="unlocked-note">Unlocked — paid $20.</p>`;
  } else if (s.status === 'open') {
    body = `<p class="locked-note">Entry, take profit and stop loss are locked until paid.</p>
    <button class="btn btn-gold unlock-btn" data-signal="${s.id}">Unlock this signal — $20</button>
    <form class="order-form" data-signal="${s.id}" hidden>
      <input type="text" name="name" placeholder="Your name" required>
      <input type="email" name="email" placeholder="Your email" required>
      <button type="submit" class="btn btn-gold">Pay $20 with card</button>
      <p class="form-hint">You will be taken to secure Stripe Checkout. The signal unlocks automatically after payment and the details are emailed to you.</p>
    </form>`;
  } else {
    body = `<div class="sig-levels">
      <span>Entry <b>${esc(s.entry)}</b></span>
      <span>Take profit <b>${esc(s.take_profit)}</b></span>
      <span>Stop loss <b>${esc(s.stop_loss)}</b></span>
    </div>`;
  }
  return `<article class="signal-card ${dirCls}" id="signal-${s.id}" data-pair="${esc(s.pair)}" data-status="${s.status}">
    <div class="sig-head">
      <span class="sig-pair">${esc(s.pair)}</span>
      <span class="sig-dir ${dirCls}">${dirLabel}</span>
      ${statusBadge}
    </div>
    <p class="sig-posted">Posted: ${fmtTime(s.created_at)}</p>
    ${body}
  </article>`;
}

function publicPage({ prices, updatedAt, signals, summary, winLoss, newPairsToday, unlockedIds, priceByPair }) {
  const openSignals = signals.filter((s) => s.status === 'open');
  const history = signals.filter((s) => s.status !== 'open');
  const filterOptions = ['All pairs', ...PAIRS.map((p) => p.pair)]
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const priceRows = prices.map((p) => priceRow(p, newPairsToday.has(p.pair))).join('');
  const signalCards = openSignals.length
    ? openSignals.map((s) => signalCard(s, {
        unlocked: unlockedIds.has(s.id),
        livePips: pipsFor(s, priceByPair[s.pair]),
      })).join('')
    : '<p class="empty">No open signals right now. Check back after the 5:00 PM New York update.</p>';
  const historyCards = history.length
    ? history.map((s) => signalCard(s, { unlocked: true, livePips: null })).join('')
    : '<p class="empty">No finished signals yet.</p>';

  const todayNew = summary.newToday;
  const summaryNewList = todayNew.length
    ? `<ul>${todayNew.map((s) => `<li>${esc(s.pair)} — ${s.direction === 'BUY' ? 'BUY' : 'SELL'}</li>`).join('')}</ul>`
    : '<p>No new signals posted today yet.</p>';
  const summaryOpen = summary.openToday.length
    ? `<ul>${summary.openToday.map((s) => `<li>${esc(s.pair)} ${s.direction} — <b class="${s.pips == null ? '' : s.pips >= 0 ? 'up' : 'down'}">${s.pips == null ? '—' : (s.pips >= 0 ? '+' : '') + s.pips} pips</b></li>`).join('')}</ul>`
    : '<p>No open signals.</p>';
  const summaryResolved = summary.resolvedToday.length
    ? `<ul>${summary.resolvedToday.map((s) => `<li>${esc(s.pair)} ${s.direction} — ${s.status === 'won' ? 'Won' : 'Lost'}</li>`).join('')}</ul>`
    : '<p>Nothing won or lost today.</p>';

  return layout('Forex Pulse', `
<header class="site-head">
  <h1 class="brand">Forex Pulse</h1>
  <p class="tagline">Live prices &amp; daily D1 signals — $20 per signal</p>
</header>

<section class="card">
  <div class="section-head">
    <h2>Live prices</h2>
    <div class="price-meta">
      <span id="last-updated">Last updated: ${fmtTime(updatedAt)}</span>
      <button id="refresh-btn" class="btn btn-small">Refresh</button>
    </div>
  </div>
  <div id="price-list">${priceRows}</div>
  <p class="fine">Prices refresh every 30 minutes. Pairs marked “Daily rate” use the daily reference rate, not a live tick.</p>
  <p class="fine">Pairs flashing with a NEW badge have a new signal posted today — tap the flashing pair to view it.</p>
</section>

<section class="card">
  <h2>Forex Signals</h2>
  <p class="d1-note">This is a D1 signal — a day signal only. All trades must be made in the D1 signal trend. H4, H1, M30 or M15 entries must be made in the D1 signal trend.</p>
  <div class="signals-toolbar">
    <label>Filter by pair:
      <select id="pair-filter">${filterOptions}</select>
    </label>
    <span class="winloss">Past results — Won: ${winLoss.won} — Lost: ${winLoss.lost}</span>
  </div>
  <div id="signal-list">${signalCards}</div>
  <h3 class="subhead">Past results</h3>
  <div id="history-list">${historyCards}</div>
</section>

<section class="card summary-card">
  <h2>Today — ${esc(summary.dateLabel)}</h2>
  <p><b>${todayNew.length} new today</b> — ${summary.buysToday} buys, ${summary.sellsToday} sells</p>
  ${summaryNewList}
  <h3>Open signals</h3>
  ${summaryOpen}
  <h3>Won / lost today</h3>
  ${summaryResolved}
  <p class="d1-reminder">D1 day signals only — all entries must follow the D1 trend.</p>
</section>

<footer class="site-foot">
  <p class="risk-note">Trading involves risk. Signals are not guaranteed.</p>
  <p class="fine">Prices may be delayed. This app is for tracking your own signals — it is not financial advice.</p>
  <p class="owner-link"><a href="/owner">Owner</a></p>
</footer>`);
}

function ownerLoginPage(error) {
  return layout('Owner login', `
<header class="site-head"><h1 class="brand">Forex Pulse</h1></header>
<section class="card narrow">
  <h2>Owner access</h2>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/owner/login">
    <label>Passcode<br><input type="password" name="passcode" autocomplete="current-password" required></label>
    <button type="submit" class="btn btn-gold">Open Owner view</button>
  </form>
  <p><a href="/">← Back to storefront</a></p>
</section>`);
}

function ownerPage({ signals, orders, smtpConfigured, notice, error }) {
  const pairOptions = PAIRS.map((p) => `<option value="${esc(p.pair)}">${esc(p.pair)}</option>`).join('');
  const openSignals = signals.filter((s) => s.status === 'open');
  const history = signals.filter((s) => s.status !== 'open');
  const signalRow = (s, isOpen) => `<tr>
    <td>${esc(s.pair)}</td><td class="${s.direction === 'BUY' ? 'up' : 'down'}">${s.direction}</td>
    <td>${esc(s.entry)}</td><td>${esc(s.take_profit)}</td><td>${esc(s.stop_loss)}</td>
    <td>${s.status}</td><td>${fmtTime(s.created_at)}</td>
    <td>${isOpen ? `
      <form method="post" action="/owner/signals/${s.id}/close" style="display:inline"><button class="btn btn-small">Close</button></form>
      <form method="post" action="/owner/signals/${s.id}/won" style="display:inline"><button class="btn btn-small">Mark won</button></form>
      <form method="post" action="/owner/signals/${s.id}/lost" style="display:inline"><button class="btn btn-small">Mark lost</button></form>` : ''}
      <form method="post" action="/owner/signals/${s.id}/delete" style="display:inline" onsubmit="return confirm('Delete this signal?')"><button class="btn btn-small btn-danger">Delete</button></form>
    </td></tr>`;
  const orderRow = (o) => {
    const sig = signals.find((s) => s.id === o.signal_id);
    const emailCell = o.email_status === 'sent' ? 'Sent ✓'
      : o.email_status === 'not_configured' ? '<span class="error">Not sent — no email service connected</span>'
      : o.email_status === 'failed' ? `<span class="error">Failed: ${esc(o.email_error || '')}</span>`
      : 'Pending';
    const manual = (o.email_status === 'failed' || o.email_status === 'not_configured') && sig
      ? `<div class="manual-send"><b>Send manually:</b> To ${esc(o.buyer_email)} — ${esc(sig.pair)} ${sig.direction}, entry ${esc(sig.entry)}, TP ${esc(sig.take_profit)}, SL ${esc(sig.stop_loss)}, posted ${fmtTime(sig.created_at)}.</div>` : '';
    return `<tr>
      <td>#${o.id}</td><td>${esc(o.signal_pair)} ${esc(o.signal_direction)}</td>
      <td>${esc(o.buyer_name)}<br><span class="fine">${esc(o.buyer_email)}</span></td>
      <td>${o.status}</td><td>$${(o.amount_cents / 100).toFixed(2)}</td>
      <td>${emailCell}${manual}</td>
      <td>${fmtTime(o.created_at)}</td>
      <td>${o.status === 'paid' && o.email_status !== 'sent'
        ? `<form method="post" action="/owner/orders/${o.id}/resend"><button class="btn btn-small">Resend email</button></form>` : ''}</td>
    </tr>`;
  };
  return layout('Owner — Forex Pulse', `
<header class="site-head"><h1 class="brand">Forex Pulse</h1><p class="tagline">Owner view</p></header>
${notice ? `<p class="notice">${esc(notice)}</p>` : ''}
${error ? `<p class="error">${esc(error)}</p>` : ''}
${smtpConfigured ? '' : '<p class="error">Email is not configured (no SMTP settings). Buyer confirmation emails will NOT send automatically — use the manual details in Orders.</p>'}

<section class="card">
  <h2>New Buy Signal</h2>
  <form method="post" action="/owner/signals" class="signal-form">
    <input type="hidden" name="direction" value="BUY">
    <label>Pair <select name="pair">${pairOptions}</select></label>
    <label>Entry <input type="number" step="any" name="entry" required></label>
    <label>Take profit <input type="number" step="any" name="take_profit" required></label>
    <label>Stop loss <input type="number" step="any" name="stop_loss" required></label>
    <button type="submit" class="btn btn-buy">New Buy Signal</button>
  </form>
</section>

<section class="card">
  <h2>New Sell Signal</h2>
  <form method="post" action="/owner/signals" class="signal-form">
    <input type="hidden" name="direction" value="SELL">
    <label>Pair <select name="pair">${pairOptions}</select></label>
    <label>Entry <input type="number" step="any" name="entry" required></label>
    <label>Take profit <input type="number" step="any" name="take_profit" required></label>
    <label>Stop loss <input type="number" step="any" name="stop_loss" required></label>
    <button type="submit" class="btn btn-sell">New Sell Signal</button>
  </form>
</section>

<section class="card">
  <h2>Open signals (${openSignals.length})</h2>
  ${openSignals.length ? `<table class="tbl"><thead><tr><th>Pair</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th><th>Status</th><th>Posted</th><th>Actions</th></tr></thead><tbody>${openSignals.map((s) => signalRow(s, true)).join('')}</tbody></table>` : '<p class="empty">No open signals.</p>'}
  <h3 class="subhead">History</h3>
  ${history.length ? `<table class="tbl"><thead><tr><th>Pair</th><th>Dir</th><th>Entry</th><th>TP</th><th>SL</th><th>Status</th><th>Posted</th><th>Actions</th></tr></thead><tbody>${history.map((s) => signalRow(s, false)).join('')}</tbody></table>` : '<p class="empty">No finished signals yet.</p>'}
</section>

<section class="card">
  <h2>Orders</h2>
  ${orders.length ? `<table class="tbl"><thead><tr><th>Order</th><th>Signal</th><th>Buyer</th><th>Status</th><th>Amount</th><th>Confirmation email</th><th>Placed</th><th></th></tr></thead><tbody>${orders.map(orderRow).join('')}</tbody></table>` : '<p class="empty">No orders yet.</p>'}
</section>

<p><a href="/">← Back to storefront</a> · <a href="/owner/logout">Lock Owner view</a></p>`);
}

function successPage({ order, signal, emailSent }) {
  if (!order || !signal) {
    return layout('Payment', `<section class="card narrow"><h2>Payment</h2><p>We could not confirm this payment. If you paid, the unlock email is on its way — otherwise please try again from the signal page.</p><p><a href="/">← Back to Forex Pulse</a></p></section>`);
  }
  const dir = signal.direction === 'BUY' ? 'BUY signal' : 'SELL signal';
  return layout('Signal unlocked', `<section class="card narrow">
  <h2>Payment received — signal unlocked</h2>
  <p>Your $20 payment was received. Here is your unlocked signal:</p>
  <table class="tbl"><tbody>
    <tr><td><b>Pair</b></td><td>${esc(signal.pair)}</td></tr>
    <tr><td><b>Direction</b></td><td>${dir}</td></tr>
    <tr><td><b>Entry price</b></td><td>${esc(signal.entry)}</td></tr>
    <tr><td><b>Take profit</b></td><td>${esc(signal.take_profit)}</td></tr>
    <tr><td><b>Stop loss</b></td><td>${esc(signal.stop_loss)}</td></tr>
    <tr><td><b>Posted</b></td><td>${fmtTime(signal.created_at)}</td></tr>
  </tbody></table>
  <p>${emailSent ? 'A confirmation email with these details was sent to ' + esc(order.buyer_email) + '.' : 'Save this page — your unlock link was also emailed to you if email is configured.'}</p>
  <p>Your unlock link (bookmark it): <a href="/unlock/${esc(order.access_token)}">View this signal any time</a></p>
  <p class="risk-note">Trading involves risk. Signals are not guaranteed.</p>
  <p><a href="/">← Back to Forex Pulse</a></p>
</section>`);
}

function unlockPage({ order, signal }) {
  if (!order || !signal || order.status !== 'paid') {
    return layout('Unlock', `<section class="card narrow"><h2>Signal not unlocked</h2><p>This link does not match a paid order. If you paid $20 for this signal, check your confirmation email for the correct link.</p><p><a href="/">← Back to Forex Pulse</a></p></section>`);
  }
  const dir = signal.direction === 'BUY' ? 'BUY signal' : 'SELL signal';
  return layout('Your unlocked signal', `<section class="card narrow">
  <h2>Your unlocked signal</h2>
  <table class="tbl"><tbody>
    <tr><td><b>Pair</b></td><td>${esc(signal.pair)}</td></tr>
    <tr><td><b>Direction</b></td><td>${dir}</td></tr>
    <tr><td><b>Entry price</b></td><td>${esc(signal.entry)}</td></tr>
    <tr><td><b>Take profit</b></td><td>${esc(signal.take_profit)}</td></tr>
    <tr><td><b>Stop loss</b></td><td>${esc(signal.stop_loss)}</td></tr>
    <tr><td><b>Posted</b></td><td>${fmtTime(signal.created_at)}</td></tr>
  </tbody></table>
  <p class="risk-note">Trading involves risk. Signals are not guaranteed.</p>
  <p><a href="/">← Back to Forex Pulse</a></p>
</section>`);
}

module.exports = { layout, publicPage, ownerLoginPage, ownerPage, successPage, unlockPage, fmtTime, fmtDate, esc };
