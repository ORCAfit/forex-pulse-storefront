'use strict';
/**
 * Live prices.
 *
 * Primary source: Yahoo Finance chart API (query1.finance.yahoo.com) — free,
 * no API key. Verified 2026-11-24 from this machine for all 10 pairs: returns
 * regularMarketPrice, regularMarketChangePercent, regularMarketDayHigh/Low and
 * chartPreviousClose plus 5-minute closes for the sparkline.
 *
 * Fallback source: Frankfurter (api.frankfurter.dev, ECB daily reference
 * rates) — free, no key. Rates from here are daily reference rates, so any
 * pair served from Frankfurter is labelled "Daily rate" and never presented
 * as a live tick.
 *
 * Server-side cache: 5 minutes, so the 30-minute client refresh and many
 * concurrent visitors do not hammer Yahoo.
 */
const PAIRS = [
  { pair: 'EUR/USD', symbol: 'EURUSD=X', pip: 0.0001, decimals: 4 },
  { pair: 'USD/JPY', symbol: 'JPY=X', pip: 0.01, decimals: 3 },
  { pair: 'GBP/USD', symbol: 'GBPUSD=X', pip: 0.0001, decimals: 4 },
  { pair: 'USD/CHF', symbol: 'CHF=X', pip: 0.0001, decimals: 4 },
  { pair: 'AUD/USD', symbol: 'AUDUSD=X', pip: 0.0001, decimals: 4 },
  { pair: 'USD/CAD', symbol: 'CAD=X', pip: 0.0001, decimals: 4 },
  { pair: 'NZD/USD', symbol: 'NZDUSD=X', pip: 0.0001, decimals: 4 },
  { pair: 'GBP/JPY', symbol: 'GBPJPY=X', pip: 0.01, decimals: 3 },
  { pair: 'AUD/JPY', symbol: 'AUDJPY=X', pip: 0.01, decimals: 3 },
  { pair: 'CHF/JPY', symbol: 'CHFJPY=X', pip: 0.01, decimals: 3 },
];

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; ForexPulse/1.0)' };
const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, data: null };

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchYahoo(p) {
  const j = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(p.symbol)}?range=1d&interval=5m`
  );
  const result = j && j.chart && j.chart.result && j.chart.result[0];
  if (!result || !result.meta || typeof result.meta.regularMarketPrice !== 'number') {
    throw new Error(`No Yahoo quote for ${p.symbol}`);
  }
  const m = result.meta;
  const closes = (result.timestamp || [])
    .map((ts, i) => (result.indicators && result.indicators.quote && result.indicators.quote[0].close || [])[i])
    .filter((v) => typeof v === 'number');
  return {
    pair: p.pair,
    price: m.regularMarketPrice,
    changePct: typeof m.regularMarketChangePercent === 'number' ? m.regularMarketChangePercent : null,
    dayHigh: typeof m.regularMarketDayHigh === 'number' ? m.regularMarketDayHigh : null,
    dayLow: typeof m.regularMarketDayLow === 'number' ? m.regularMarketDayLow : null,
    prevClose: typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : null,
    open: typeof m.chartPreviousClose === 'number' ? m.chartPreviousClose : null,
    source: 'live',
    sparkline: closes.slice(-60),
  };
}

// --- Frankfurter fallback (ECB daily reference rates, base USD) ---
// rate(p) converts a USD-base Frankfurter rates map into the pair price.
function crossRate(rates, pair) {
  const r = (ccy) => (ccy === 'USD' ? 1 : rates[ccy]);
  switch (pair) {
    case 'EUR/USD': return 1 / r('EUR');
    case 'USD/JPY': return r('JPY');
    case 'GBP/USD': return 1 / r('GBP');
    case 'USD/CHF': return r('CHF');
    case 'AUD/USD': return 1 / r('AUD');
    case 'USD/CAD': return r('CAD');
    case 'NZD/USD': return 1 / r('NZD');
    case 'GBP/JPY': return r('JPY') / r('GBP');
    case 'AUD/JPY': return r('JPY') / r('AUD');
    case 'CHF/JPY': return r('JPY') / r('CHF');
    default: return null;
  }
}

function prevBusinessDay(d) {
  const x = new Date(d);
  do { x.setDate(x.getDate() - 1); } while (x.getDay() === 0 || x.getDay() === 6);
  return x.toISOString().slice(0, 10);
}

async function fetchFrankfurter() {
  const today = await fetchJson('https://api.frankfurter.dev/v1/latest?base=USD');
  if (!today || !today.rates) throw new Error('Frankfurter returned no rates');
  let prev = null;
  let date = prevBusinessDay(new Date(today.date + 'T12:00:00Z'));
  for (let i = 0; i < 5 && !prev; i++) {
    try {
      const j = await fetchJson(`https://api.frankfurter.dev/v1/${date}?base=USD`);
      if (j && j.rates) prev = j;
    } catch (_) { /* try an earlier day */ }
    date = prevBusinessDay(new Date(date + 'T12:00:00Z'));
  }
  return PAIRS.map((p) => {
    const price = crossRate(today.rates, p.pair);
    const prevPrice = prev ? crossRate(prev.rates, p.pair) : null;
    return {
      pair: p.pair,
      price,
      changePct: prevPrice ? ((price - prevPrice) / prevPrice) * 100 : null,
      dayHigh: null,
      dayLow: null,
      prevClose: prevPrice,
      open: prevPrice,
      source: 'daily',
      sparkline: [],
    };
  });
}

async function getPrices() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;
  const results = await Promise.allSettled(PAIRS.map((p) => fetchYahoo(p)));
  const live = results.map((r, i) => (r.status === 'fulfilled' ? r.value : null));
  const missing = live.some((v) => v === null);
  let fallback = null;
  if (missing) {
    try { fallback = await fetchFrankfurter(); } catch (e) { console.error('Frankfurter fallback failed:', e.message); }
  }
  const prices = PAIRS.map((p, i) => {
    if (live[i]) return live[i];
    if (fallback) return fallback[i];
    return {
      pair: p.pair, price: null, changePct: null, dayHigh: null, dayLow: null,
      prevClose: null, open: null, source: 'unavailable', sparkline: [],
    };
  });
  const data = { prices, updatedAt: new Date().toISOString() };
  cache = { at: Date.now(), data };
  return data;
}

/** Mark open signals won/lost when the live price touches TP or SL. */
function evaluateSignals(db, prices) {
  const byPair = Object.fromEntries(prices.map((p) => [p.pair, p.price]));
  const open = db.listSignals('open');
  for (const s of open) {
    const price = byPair[s.pair];
    if (typeof price !== 'number') continue;
    let won = false;
    let lost = false;
    if (s.direction === 'BUY') {
      won = price >= s.take_profit;
      lost = price <= s.stop_loss;
    } else {
      won = price <= s.take_profit;
      lost = price >= s.stop_loss;
    }
    if (won) db.setSignalStatus(s.id, 'won');
    else if (lost) db.setSignalStatus(s.id, 'lost');
  }
}

/** Live pips for an open signal at the given price (positive = in profit). */
function pipsFor(signal, price) {
  if (typeof price !== 'number') return null;
  const pip = PAIRS.find((p) => p.pair === signal.pair)?.pip || 0.0001;
  const diff = signal.direction === 'BUY' ? price - signal.entry : signal.entry - price;
  return Math.round((diff / pip) * 10) / 10;
}

module.exports = { PAIRS, getPrices, evaluateSignals, pipsFor };
