'use strict';
/**
 * Upcoming economic events for the homepage calendar.
 *
 * Source: Forex Factory's public weekly calendar feed
 * (https://nfs.faireconomy.media/ff_calendar_thisweek.json — free, no key).
 * Fetched server-side and cached for 30 minutes. Only USD/EUR/GBP events
 * are shown, soonest first. Forecast / previous come straight from the
 * feed and are never invented. If the feed cannot be fetched, getUpcoming
 * returns null and the page shows an "unavailable" note instead of stale
 * numbers presented as live.
 */
const CAL_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CACHE_MS = 30 * 60 * 1000;
const LIMIT = 8;
const CURRENCIES = new Set(['USD', 'EUR', 'GBP']);
const IMPACTS = new Set(['High', 'Medium', 'Low']);

let cache = { at: 0, raw: null };

async function fetchJson(url, timeoutMs = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ForexPulse/1.0)' }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function toEvents(raw) {
  const now = new Date();
  return (Array.isArray(raw) ? raw : [])
    .filter((e) => e && CURRENCIES.has(e.country) && IMPACTS.has(e.impact)
      && typeof e.title === 'string' && e.title.trim() !== ''
      && !Number.isNaN(Date.parse(e.date)) && new Date(e.date) > now)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, LIMIT)
    .map((e) => ({
      currency: e.country,
      impact: e.impact,
      title: e.title.trim(),
      date: e.date,
      forecast: typeof e.forecast === 'string' ? e.forecast : '',
      previous: typeof e.previous === 'string' ? e.previous : '',
    }));
}

/** Returns { events, ok } — ok is false when the feed could not be read. */
async function getUpcomingEvents() {
  if (cache.raw && Date.now() - cache.at < CACHE_MS) {
    // Re-filter the cache so an event that has since passed never shows.
    return { events: toEvents(cache.raw), ok: true };
  }
  try {
    const raw = await fetchJson(CAL_URL);
    const events = toEvents(raw);
    cache = { at: Date.now(), raw };
    return { events, ok: true };
  } catch (err) {
    console.error('Calendar fetch failed:', err.message);
    return { events: [], ok: false };
  }
}

module.exports = { getUpcomingEvents };
