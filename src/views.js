'use strict';
/**
 * Server-rendered HTML. Layout order (per the owner's spec):
 *   Dashboard header + headline → stat cards → live prices
 *   → signal matrix / cards → Forex signals ($20 each)
 *   → MT4 Indicators (intro, what each does, pricing, license)
 *   → Performance Log → Upcoming News Events (live economic calendar)
 *   → daily summary below the signals
 *   → D1 note under the signals → risk note + Owner link only
 *   at the bottom.
 *
 * Public rules (2026-11-26): a locked signal never shows its direction
 * (no BUY/SELL, no green/red direction hint) — it only says
 * "Signal available". Entry, take profit and stop loss stay hidden until
 * paid. The daily summary lists also hide direction for open signals.
 * Counts (total / buy / sell / neutral, won / lost) are aggregate only
 * and always computed from the real signals in the database.
 */
const { PAIRS, pipsFor } = require('./prices');
const indicators = require('./indicators');

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

const fmtLogTime = (iso) => new Date(iso).toLocaleString('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

// Two-letter code for a pair badge, from the base currency (EUR/USD -> EU).
const pairCode = (pair) => pair.split('/')[0].slice(0, 2).toUpperCase();

// --- Dashboard stat cards (counts from the real signals, never hardcoded) ---
function statCards(signals) {
  const total = signals.length;
  const buys = signals.filter((s) => s.direction === 'BUY').length;
  const sells = signals.filter((s) => s.direction === 'SELL').length;
  const neutral = signals.filter((s) => s.direction !== 'BUY' && s.direction !== 'SELL').length;
  const bolt = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>';
  const up = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>';
  const down = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/></svg>';
  const minus = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
  const card = (icon, iconCls, num, label) => `<div class="stat-card">
    <span class="stat-icon ${iconCls}">${icon}</span>
    <span class="stat-text"><span class="stat-num">${num}</span><span class="stat-label">${label}</span></span>
  </div>`;
  return `<section class="stat-grid">
    ${card(bolt, 'ic-green', total, 'TOTAL SIGNALS')}
    ${card(up, 'ic-green', buys, 'BUY')}
    ${card(down, 'ic-red', sells, 'SELL')}
    ${card(minus, 'ic-amber', neutral, 'NEUTRAL')}
  </section>`;
}

// --- Signal matrix: PAIR / D1 / H4 / H1. Only D1 ever has a signal (his
// signals are D1 only); H4/H1 always show "—". A D1 cell shows a neutral
// "Signal" pill only where an open signal exists for that pair — never a
// direction, never entry/TP/SL. Pairs with a signal posted today get a NEW tag.
function matrixSection(openByPair, newPairsToday) {
  const rows = PAIRS.map((p) => {
    const open = openByPair.get(p.pair);
    const isNew = newPairsToday.has(p.pair);
    const d1 = open
      ? '<span class="mx-pill"><span class="mx-dot"></span>Signal</span>'
      : '<span class="mx-empty">—</span>';
    const dash = '<span class="mx-empty">—</span>';
    return `<tr class="mx-row" data-pair="${esc(p.pair)}" data-has-signal="${open ? '1' : '0'}" data-new="${isNew ? '1' : ''}">
      <td><span class="mx-badge">${pairCode(p.pair)}</span><span class="mx-pair">${esc(p.pair)}</span>${isNew ? ' <span class="tag tag-new">NEW</span>' : ''}</td>
      <td>${d1}</td><td>${dash}</td><td>${dash}</td>
    </tr>`;
  }).join('');
  return `<section class="card matrix-card" id="matrix-view">
    <div class="matrix-wrap"><table class="matrix">
      <thead><tr><th>PAIR</th><th>D1</th><th>H4</th><th>H1</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="fine">D1 signals only — the H4 and H1 columns stay empty because every signal here is a daily (D1) signal. Tap a pair to open its price details; a pair with a NEW badge jumps straight to today's signal.</p>
  </section>`;
}

// --- Cards view: one card per pair, with live price and signal state.
function cardsSection(prices, openByPair, newPairsToday) {
  const priceByPair = Object.fromEntries(prices.map((p) => [p.pair, p]));
  const cards = PAIRS.map((p) => {
    const pr = priceByPair[p.pair];
    const open = openByPair.get(p.pair);
    const isNew = newPairsToday.has(p.pair);
    const up = pr && pr.changePct != null ? pr.changePct >= 0 : null;
    const change = pr && pr.changePct != null ? `${up ? '▲' : '▼'} ${Math.abs(pr.changePct).toFixed(2)}%` : '—';
    const state = open
      ? `<button class="btn btn-gold btn-small card-unlock" data-pair="${esc(p.pair)}">Signal available — $20</button>`
      : '<span class="card-nosig">No signal posted</span>';
    return `<div class="pair-card" data-pair="${esc(p.pair)}" data-new="${isNew ? '1' : ''}">
      <div class="pair-card-head"><span class="mx-badge">${pairCode(p.pair)}</span><span class="mx-pair">${esc(p.pair)}</span>${isNew ? ' <span class="tag tag-new">NEW</span>' : ''}</div>
      <div class="pair-card-price"><span data-live-price="${esc(p.pair)}">${fmtPrice(p.pair, pr ? pr.price : null)}</span>
      <span class="pair-change ${up === null ? '' : up ? 'up' : 'down'}" data-live-change="${esc(p.pair)}">${change}</span></div>
      ${state}
    </div>`;
  }).join('');
  return `<section class="card cards-card" id="cards-view" hidden><div class="cards-grid">${cards}</div></section>`;
}

// --- Performance Log: counts + one row per signal. Rows show pair, date and
// status only — never direction, entry, take profit, stop loss or RR.
// Open signals get an unlock button; finished signals show their outcome.
// Filter pills are by outcome (ALL / OPEN / WON / LOST): filtering by
// direction would reveal each pair's buy/sell, which stays hidden.
function logSection(signals) {
  const total = signals.length;
  const buys = signals.filter((s) => s.direction === 'BUY').length;
  const sells = signals.filter((s) => s.direction === 'SELL').length;
  const neutral = total - buys - sells;
  const shown = signals.slice(0, 50);
  const rows = shown.map((s, i) => {
    const isOpen = s.status === 'open';
    const statusTag = s.status === 'open' ? '<span class="tag tag-open">OPEN</span>'
      : s.status === 'won' ? '<span class="tag tag-won">WON</span>'
      : s.status === 'lost' ? '<span class="tag tag-lost">LOST</span>'
      : '<span class="tag tag-closed">CLOSED</span>';
    const action = isOpen
      ? `<button class="btn btn-gold btn-small log-unlock" data-pair="${esc(s.pair)}">Signal available — unlock for $20</button>`
      : '<span class="log-closed-note">Signal closed</span>';
    return `<div class="log-row" data-status="${s.status}">
      <span class="log-idx">${i + 1}</span>
      <span class="log-pair">${esc(s.pair)}</span>
      <span class="log-tf">D1</span>
      ${statusTag}
      <span class="log-date">${fmtLogTime(s.created_at)}</span>
      ${action}
    </div>`;
  }).join('');
  return `<section class="card log-card">
    <div class="log-head">
      <h2>Performance Log</h2>
      <span class="log-badge">${total} signal${total === 1 ? '' : 's'}</span>
      <div class="log-filters">
        <button class="pill active" data-filter="all">ALL</button>
        <button class="pill" data-filter="open">OPEN</button>
        <button class="pill" data-filter="won">WON</button>
        <button class="pill" data-filter="lost">LOST</button>
      </div>
    </div>
    <div class="log-tiles">
      <div class="log-tile"><span class="log-tile-num num-buy">${buys}</span><span class="log-tile-label">BUY SIGNALS</span></div>
      <div class="log-tile"><span class="log-tile-num num-sell">${sells}</span><span class="log-tile-label">SELL SIGNALS</span></div>
      <div class="log-tile"><span class="log-tile-num num-neutral">${neutral}</span><span class="log-tile-label">NEUTRAL</span></div>
    </div>
    ${shown.length ? `<div class="log-rows">${rows}</div>${total > shown.length ? `<p class="fine">Showing the ${shown.length} most recent signals.</p>` : ''}` : '<p class="empty">No signals posted yet.</p>'}
  </section>`;
}

// --- Upcoming News Events / Economic Calendar: live events from Forex
// Factory's public calendar feed (see src/calendar.js). Rows show currency
// chip, impact pill, event name, time in UTC, forecast and previous —
// values come from the feed, never from sample data. If the feed is down
// the section says so instead of showing stale numbers as if they were live.
function calendarSection(cal) {
  const news = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6Z"/></svg>';
  const clock = '<svg class="cal-clock" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  const flame = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';
  // Day + time in UTC (events span several days, so the weekday is shown).
  const fmtCalTime = (iso) => {
    const d = new Date(iso);
    const day = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    const hm = d.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false });
    return `${day} ${hm} UTC`;
  };
  const rows = cal.events.map((e) => {
    const impactCls = e.impact === 'High' ? 'impact-high' : e.impact === 'Medium' ? 'impact-medium' : 'impact-low';
    const impactIcon = e.impact === 'High' ? flame : '';
    const f = e.forecast ? esc(e.forecast) : '—';
    const p = e.previous ? esc(e.previous) : '—';
    return `<div class="cal-row">
      <div class="cal-top"><span class="cal-ccy">${esc(e.currency)}</span><span class="cal-impact ${impactCls}">${impactIcon}${e.impact.toLowerCase()}</span></div>
      <div class="cal-title">${esc(e.title)}</div>
      <div class="cal-meta">${clock} ${fmtCalTime(e.date)}&nbsp;&nbsp;F: ${f}&nbsp;&nbsp;P: ${p}</div>
    </div>`;
  }).join('');
  const body = !cal.ok
    ? '<p class="empty">Economic calendar temporarily unavailable — please check back shortly.</p>'
    : cal.events.length
      ? `<div class="cal-rows">${rows}</div>`
      : '<p class="empty">No USD, EUR or GBP events scheduled for the rest of this week.</p>';
  return `<h2 class="section-title">Upcoming News Events</h2>
<section class="card cal-card">
  <div class="cal-head"><span class="cal-head-title">${news} Economic Calendar</span><span class="cal-range">This week</span></div>
  ${body}
  <p class="fine">Source: Forex Factory economic calendar. Times in UTC.</p>
</section>`;
}

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
  // Locked signals never show direction (no BUY/SELL, no green/red hint).
  const locked = s.status === 'open' && !unlocked;
  const dirCls = locked ? '' : (s.direction === 'BUY' ? 'buy' : 'sell');
  const dirLabel = locked ? 'Signal available' : (s.direction === 'BUY' ? 'BUY signal' : 'SELL signal');
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

// --- MT4 Indicators: introduction, what each one does, and pricing.
// Copy follows the listing PDF (Forex Indicators — Listing & Pricing).
// Buy buttons are gated on the product's zip package being present in
// downloads/ — a product whose package is not published yet shows
// "Coming soon" and cannot start a checkout.
function indicatorsSection(avail) {
  const buyForm = (product) => {
    if (!avail[product.id]) {
      return `<p><button class="btn btn-gold" disabled>Coming soon — ${product.priceLabel}</button></p>
      <p class="fine">The download file for this indicator has not been published yet — check back soon.</p>`;
    }
    return `<form class="indicator-order-form" data-product="${product.id}">
      <input type="text" name="name" placeholder="Your name" required>
      <input type="email" name="email" placeholder="Your email" required>
      <button type="submit" class="btn btn-gold">Buy — ${product.priceLabel} with card</button>
      <p class="form-hint">One-time purchase, no expiration date. You will be taken to secure Stripe Checkout. After payment, your download link is emailed to you and shown on the confirmation page.</p>
    </form>`;
  };
  const flr = indicators.PRODUCTS.flr;
  const fbpi = indicators.PRODUCTS.fbpi;
  const bundle = indicators.PRODUCTS.bundle;
  return `<section class="card" id="indicators">
  <h2>MT4 Indicators</h2>
  <p class="dash-sub">Two original indicators by DEUS, built for MT4. FLR finds the level. FBPI tells you whether the bigger picture is worth trading at all. One-time purchase, no expiration date — one payment, one download, licensed for the buyer's own use only.</p>
  <p class="dash-sub">Built on institutional-grade analysis — the same methods professional trading desks rely on: session liquidity, key levels, volume profile, and top-down confirmation, engineered for MetaTrader 4.</p>
  <div class="ind-grid">
    <article class="ind-card">
      <h3>Forex Level Radar Pro</h3>
      <p class="fine">FLR-MT4-001 — Key Levels, Probabilities &amp; Session Dashboard</p>
      <img class="ind-shot" src="/flr-dashboard.png" alt="Forex Level Radar Pro dashboard box — key levels, touch probabilities and scoreboard" loading="lazy">
      <p>Forex Level Radar Pro puts the levels that matter on one dark, clean dashboard — so you can see where price is, what it has already touched, and which level is most likely to be tested next, without drawing lines by hand all morning. Built for MT4 across 15 pairs, FLR runs 7 engines at once: key levels, touch probability, session intelligence, liquidity sweeps vs. breakouts, candle analysis, and a Brier-score scoreboard that tracks how its own probabilities performed. It is analytical only — it never places, modifies, or closes a trade.</p>
      <h4>What FLR shows</h4>
      <ul class="ind-list">
        <li>Key levels: Previous Day High / Low / Close / Open (PDH / PDL / PDC / PDO), session highs and lows, opening range</li>
        <li>Touch probability for each level, with a scoreboard</li>
        <li>Session intelligence: Asian / London / New York, UTC-based</li>
        <li>Liquidity sweeps vs. real breakouts, plus candle analysis</li>
      </ul>
      <h4>FLR is good for</h4>
      <ul class="ind-list">
        <li>Intraday planning and level-based entries</li>
        <li>Traders who watch multiple pairs at once</li>
        <li>Anyone who wants levels plus probability, not just lines</li>
      </ul>
      <p class="fine">Includes: compiled .ex4, 8 documents, 3 presets, Sample_Scoreboard.csv, and install guide.</p>
      <p class="ind-price">${flr.priceLabel} <span class="ind-per">one-time · launch price</span></p>
      ${buyForm(flr)}
    </article>
    <article class="ind-card">
      <h3>Forex Bigger Picture Intelligence System</h3>
      <p class="fine">FBPI-MT4-001 — 23-Layer Top-Down Framework &amp; Risk Dashboard</p>
      <img class="ind-shot" src="/fbpi-dashboard.png" alt="Forex Bigger Picture Intelligence dashboard box — market structure, sessions, volume and execution readiness" loading="lazy">
      <p>Forex Bigger Picture Intelligence is the top-down companion to FLR. Where FLR answers “which level?”, FBPI answers “should I be looking to trade at all — and in which direction does the bigger picture point?” FBPI works through a 23-layer framework in a single 600px dashboard, with a built-in risk framework: $5,000 paper capital model, 0.5% risk per trade, 2% maximum daily loss, and a 1:2 minimum reward-to-risk. Like FLR, it is analytical only and never places a trade.</p>
      <h4>What FBPI does</h4>
      <ul class="ind-list">
        <li>23-layer top-down check, from context to execution readiness</li>
        <li>One clear bigger-picture view instead of scattered indicators</li>
        <li>Risk sizing and daily-loss guardrails in the workflow</li>
        <li>Single-file build — one file to install in MT4</li>
      </ul>
      <h4>FBPI is good for</h4>
      <ul class="ind-list">
        <li>Daily (D1) planning before the session</li>
        <li>Traders who overtrade and want a filter first</li>
        <li>Pairing with FLR: FBPI for direction, FLR for the level</li>
      </ul>
      <p class="fine">Includes: compiled .ex4 (single-file build), 11 documents, 3 presets, sample CSVs, and install guide.</p>
      <p class="ind-price">${fbpi.priceLabel} <span class="ind-per">one-time · launch price</span></p>
      ${buyForm(fbpi)}
    </article>
    <article class="ind-card ind-bundle">
      <h3>Bundle — Both Indicators</h3>
      <p class="fine">FLR-MT4-001 + FBPI-MT4-001</p>
      <p>Both indicators together: use FBPI for direction, FLR for the level. One payment, both downloads, licensed for your own use only.</p>
      <p class="ind-price">${bundle.priceLabel} <span class="ind-per">one-time · launch price</span> <span class="ind-save">Save $49 vs. buying separately</span></p>
      ${buyForm(bundle)}
    </article>
  </div>
  <div class="license-box">
    <h3>License terms</h3>
    <p>Copyright (C) 2026 DEUS. All rights reserved.</p>
    <p>Sold as a license for the buyer's own use only. The buyer may run the indicator on their own charts, but may NOT copy, share, repost, resell or redistribute it, in whole or in part, without DEUS's written permission. One-time purchase, no expiration date. Compiled .ex4 files only — the .mq4 source code is not included and is not for sale. Not public domain.</p>
  </div>
  <p class="fine"><b>Analytical only.</b> These tools analyse and display information. They do not place, modify, or close trades, and they are not financial advice.</p>
  <p class="fine"><b>MT4 only, history matters.</b> Requires MetaTrader 4. Load at least 100 days of H1 history; with too little history the dashboard correctly shows INSUFFICIENT DATA / DATA UNAVAILABLE.</p>
  <p class="fine"><b>Honest limits:</b> No live futures or economic-calendar feed; order book is unavailable in MT4, and order-flow figures are estimates.</p>
</section>`;
}

function publicPage({ prices, updatedAt, signals, summary, winLoss, newPairsToday, unlockedIds, priceByPair, calendar, indicatorAvailability }) {
  const openSignals = signals.filter((s) => s.status === 'open');
  const filterOptions = ['All pairs', ...PAIRS.map((p) => p.pair)]
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
  const priceRows = prices.map((p) => priceRow(p, newPairsToday.has(p.pair))).join('');
  const signalCards = openSignals.length
    ? openSignals.map((s) => signalCard(s, {
        unlocked: unlockedIds.has(s.id),
        livePips: pipsFor(s, priceByPair[s.pair]),
      })).join('')
    : '<p class="empty">No open signals right now. Check back after the 5:00 PM New York update.</p>';
  const openByPair = new Map();
  for (const s of openSignals) if (!openByPair.has(s.pair)) openByPair.set(s.pair, s);

  const todayNew = summary.newToday;
  const summaryNewList = todayNew.length
    ? `<ul>${todayNew.map((s) => `<li>${esc(s.pair)} — new signal</li>`).join('')}</ul>`
    : '<p>No new signals posted today yet.</p>';
  const summaryOpen = summary.openToday.length
    ? `<ul>${summary.openToday.map((s) => unlockedIds.has(s.id) ? `<li>${esc(s.pair)} ${s.direction} — <b class="${s.pips == null ? '' : s.pips >= 0 ? 'up' : 'down'}">${s.pips == null ? '—' : (s.pips >= 0 ? '+' : '') + s.pips} pips</b></li>` : `<li>${esc(s.pair)}</li>`).join('')}</ul>`
    : '<p>No open signals.</p>';
  const summaryResolved = summary.resolvedToday.length
    ? `<ul>${summary.resolvedToday.map((s) => `<li>${esc(s.pair)} — ${s.status === 'won' ? 'Won' : 'Lost'}</li>`).join('')}</ul>`
    : '<p>Nothing won or lost today.</p>';

  return layout('Forex Pulse', `
<header class="dash-head">
  <div class="dash-brand">
    <span class="logo-mark"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l3-8 4 16 3-8h6"/></svg></span>
    <span class="brand-text"><span class="brand-name">Forex Pulse</span><span class="brand-sub">SIGNAL</span></span>
  </div>
  <a class="dash-icon" href="#signals" aria-label="Go to signals"><svg width="22" height="22" viewBox="0 0 24 24" fill="#22c55e" aria-hidden="true"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg></a>
</header>

<section class="dash-intro">
  <p class="dash-label">Signal Dashboard</p>
  <h1 class="dash-title">Real-time forex signals across all major pairs</h1>
  <p class="dash-sub">Live prices &amp; daily D1 signals — $20 per signal</p>
  <div class="view-toggle">
    <button class="view-btn active" data-view="matrix">Matrix</button>
    <button class="view-btn" data-view="cards">Cards</button>
  </div>
</section>

${statCards(signals)}

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

${matrixSection(openByPair, newPairsToday)}
${cardsSection(prices, openByPair, newPairsToday)}

<section class="card" id="signals">
  <h2>Forex Signals</h2>
  <p class="d1-note">This is a D1 signal — a day signal only. All trades must be made in the D1 signal trend. H4, H1, M30 or M15 entries must be made in the D1 signal trend.</p>
  <div class="signals-toolbar">
    <label>Filter by pair:
      <select id="pair-filter">${filterOptions}</select>
    </label>
    <span class="winloss">Past results — Won: ${winLoss.won} — Lost: ${winLoss.lost}</span>
  </div>
  <div id="signal-list">${signalCards}</div>
</section>

${indicatorsSection(indicatorAvailability || {})}

${logSection(signals)}

${calendarSection(calendar || { events: [], ok: false })}

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

function indicatorOrderRow(o) {
  const product = indicators.PRODUCTS[o.product];
  const emailCell = o.email_status === 'sent' ? 'Sent ✓'
    : o.email_status === 'not_configured' ? '<span class="error">Not sent — no email service connected</span>'
    : o.email_status === 'failed' ? `<span class="error">Failed: ${esc(o.email_error || '')}</span>`
    : 'Pending';
  const manual = (o.email_status === 'failed' || o.email_status === 'not_configured') && o.status === 'paid'
    ? `<div class="manual-send"><b>Send manually:</b> download link — /download/${esc(o.access_token)} for ${esc(o.buyer_email)}.</div>` : '';
  return `<tr>
    <td>#${o.id}</td><td>${esc(product ? product.name : o.product)}</td>
    <td>${esc(o.buyer_name)}<br><span class="fine">${esc(o.buyer_email)}</span></td>
    <td>${o.status}</td><td>$${(o.amount_cents / 100).toFixed(2)}</td>
    <td>${emailCell}${manual}</td>
    <td>${fmtTime(o.created_at)}</td>
    <td>${o.status === 'paid' ? `<a href="/download/${esc(o.access_token)}">Download page</a>` : ''}${o.status === 'paid' && o.email_status !== 'sent'
      ? `<form method="post" action="/owner/indicator-orders/${o.id}/resend"><button class="btn btn-small">Resend email</button></form>` : ''}</td>
  </tr>`;
}

function ownerPage({ signals, orders, indicatorOrders, smtpConfigured, notice, error }) {
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

<section class="card">
  <h2>Indicator orders</h2>
  ${(indicatorOrders || []).length ? `<table class="tbl"><thead><tr><th>Order</th><th>Product</th><th>Buyer</th><th>Status</th><th>Amount</th><th>Download email</th><th>Placed</th><th></th></tr></thead><tbody>${(indicatorOrders || []).map(indicatorOrderRow).join('')}</tbody></table>` : '<p class="empty">No indicator orders yet.</p>'}
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

function indicatorSuccessPage({ order, emailSent }) {
  if (!order) {
    return layout('Payment', `<section class="card narrow"><h2>Payment</h2><p>We could not confirm this payment. If you paid, the download email is on its way — otherwise please try again from the indicators section.</p><p><a href="/">← Back to Forex Pulse</a></p></section>`);
  }
  const product = indicators.PRODUCTS[order.product];
  return layout('Indicator download', `<section class="card narrow">
  <h2>Payment received — your download is ready</h2>
  <p>Your $${(order.amount_cents / 100).toFixed(2)} payment was received for <b>${esc(product ? product.name : order.product)}</b>.</p>
  <p><a class="btn btn-gold" href="/download/${esc(order.access_token)}">Download your indicator</a></p>
  <p>${emailSent ? 'A confirmation email with your download link was sent to ' + esc(order.buyer_email) + '.' : 'Save this page — your download link was also emailed to you if email is configured.'}</p>
  <p>Your download link (bookmark it): <a href="/download/${esc(order.access_token)}">Download any time</a></p>
  <p class="fine">Copyright (C) 2026 DEUS. All rights reserved. Licensed for your own use only — you may run the indicator on your own charts, but may NOT copy, share, repost, resell or redistribute it.</p>
  <p><a href="/">← Back to Forex Pulse</a></p>
</section>`);
}

function indicatorDownloadPage({ order }) {
  if (!order) {
    return layout('Download', `<section class="card narrow"><h2>Download not found</h2><p>This link does not match a paid indicator order. If you paid, check your confirmation email for the correct link.</p><p><a href="/">← Back to Forex Pulse</a></p></section>`);
  }
  const product = indicators.PRODUCTS[order.product];
  const packages = product ? indicators.packageContents(product) : [];
  const blocks = packages.map((pkg) => {
    const items = pkg.items.map((it) => `<li>${esc(it)}</li>`).join('');
    return `<p><b><a href="/download/${esc(order.access_token)}/${pkg.productId}">${esc(pkg.filename)}</a></b></p><ul>${items}</ul>`;
  }).join('');
  return layout('Your indicator download', `<section class="card narrow">
  <h2>Your indicator download</h2>
  <p><b>${esc(product ? product.name : order.product)}</b> — paid $${(order.amount_cents / 100).toFixed(2)} on ${fmtTime(order.paid_at || order.created_at)}</p>
  ${blocks}
  <h3>Install in MetaTrader 4</h3>
  <ol>
    <li>Unzip the package, then copy the <b>.ex4</b> file into your MT4 <b>MQL4/Indicators</b> folder.</li>
    <li>Copy the preset files (<b>.set</b>) into your MT4 <b>MQL4/Presets</b> folder. In MT4, attach the indicator to a chart, click <b>Load</b> in the inputs window and pick a preset (Standard is a good start).</li>
  </ol>
  <p class="fine">Full steps are in the <b>Installation_Guide.md</b> inside the package. After copying the files, restart MT4 or refresh the Navigator.</p>
  <p class="fine">Copyright (C) 2026 DEUS. All rights reserved. Licensed for your own use only.</p>
  <p><a href="/">← Back to Forex Pulse</a></p>
</section>`);
}

module.exports = { layout, publicPage, ownerLoginPage, ownerPage, successPage, unlockPage, indicatorSuccessPage, indicatorDownloadPage, fmtTime, fmtDate, esc };
