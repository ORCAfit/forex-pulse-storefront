# Forex Pulse — Public Storefront

Public, server-backed version of Forex Pulse that can be marketed at
**https://4xpulse.com**. Same dark trading-terminal look as the private app:
live prices for the 10 pairs, D1 signals at **$20 each** via Stripe Checkout,
automatic unlock after payment, and a confirmation email to the buyer.

Layout order: dashboard header + headline → stat cards (total / buy /
sell / neutral, from real signals) → live prices → signal matrix (PAIR /
D1 / H4 / H1) with a Cards toggle → Forex signals ($20 each) → Performance
Log → Upcoming News Events (live economic calendar) → daily summary below
the signals → D1 note under the signals → risk note + Owner link only at
the bottom. Signals are D1 only, so the matrix H4/H1 columns stay empty; a
matrix cell shows a neutral “Signal” pill only where an open signal exists
for that pair.

## How it works

- **Prices** — Yahoo Finance chart API (free, no key) for all 10 pairs:
  EUR/USD, USD/JPY, GBP/USD, USD/CHF, AUD/USD, USD/CAD, NZD/USD, GBP/JPY,
  AUD/JPY, CHF/JPY. Live price, day change %, day high/low, prev close and a
  5-minute sparkline. Client refreshes every 30 minutes (plus a Refresh
  button); the server caches for 5 minutes. If Yahoo fails for a pair, the
  app falls back to Frankfurter (ECB daily reference rates) and labels that
  row **“Daily rate”** — a daily rate is never presented as a live tick.
- **Signals** — stored server-side in SQLite. The owner posts buy/sell
  signals from `/owner` (passcode from the `OWNER_PASSCODE` env var).
  Take-profit / stop-loss are validated (buy: TP above entry, SL below;
  sell: the reverse). Open signals show live pips; hitting TP marks them
  Won, hitting SL marks them Lost, automatically, on each price refresh.
  A signal posted today makes its pair flash with a **NEW** badge in the
  prices list; tapping the flashing pair scrolls straight to the signal.
  Tapping any pair — in the prices list, the matrix, or the Cards view —
  behaves the same way: a pair with a new signal today jumps to that
  signal, any other pair opens its price details (open / high / low / prev
  close, sparkline) in the Live prices list.
- **Economic calendar** — “Upcoming News Events” below the Performance Log,
  fed live from Forex Factory’s public weekly calendar feed (free, no key;
  `src/calendar.js`, 30-minute server cache). Shows the next 8 upcoming
  USD/EUR/GBP events: currency chip, impact pill (high red / medium amber
  / low muted), event name, time in UTC, forecast and previous. Values come
  from the feed only — never from sample data. If the feed cannot be read,
  the section says it is temporarily unavailable instead of showing stale
  numbers as if they were live.
- **Paywall** — a locked signal only says **“Signal available”** before
  purchase: no BUY/SELL direction, no green/red direction hint, and no
  entry, take profit, stop loss or RR anywhere on the public page. The
  Performance Log likewise shows pair + date + status only. Buyer enters
  name + email → Stripe Checkout ($20, card only, no sales tax) → on
  payment the signal unlocks automatically and a confirmation email with
  the full details + a durable unlock link is sent. The unlock is also
  verified on the `/success` return page, so a slow webhook cannot leave a
  buyer locked out. (A buyer who has paid sees their own unlocked signal
  with direction, entry, take profit, stop loss and live pips.)
- **Daily summary** — auto-built from the signals: today’s date, new
  signals today (buys vs sells), open signals with live pips, anything won
  or lost today, and the D1 reminder.
- **Owner area** — `/owner`, reached only through the small “Owner” link in
  the footer. Passcode login (12-hour session cookie). New Buy / New Sell
  signal forms, open + history lists, close / mark won / mark lost / delete,
  and an Orders table with payment status, email status, a Resend button,
  and — if email is not configured or failed — the buyer’s email and the
  unlocked details so it can be sent manually.

## Run locally

```bash
cp .env.example .env   # fill in your keys (see below)
npm install
npm start              # http://localhost:3000
```

Without `STRIPE_SECRET_KEY` the server still runs; checkout returns a
“payments not configured” message. Without SMTP settings, buyer emails are
not sent and Orders shows the manual-send notice.

## Deploy on Render

### 1. Create the Render account and service

1. Sign up at https://render.com (Demetrius will create this account).
2. Push this folder to a GitHub repo (or use Render’s “deploy from a
   public Git repository”). Do **not** commit `.env` or `data/*.db`.
3. In Render: **New → Web Service → Build and deploy from a Git
   repository** → pick the repo. Render detects `render.yaml` (Blueprint)
   and creates the service + 1 GB persistent disk.
   - Service type: **Web Service**, runtime **Node**, plan **Starter**
     (~$7/mo — required for the persistent disk; free instances cannot
     attach a disk). Disk adds ~$0.25/mo.
   - Build command: `npm install` · Start command: `npm start`
   - Health check path: `/healthz`

### 2. Environment variables (Render dashboard → Environment)

| Variable | Value |
|---|---|
| `BASE_URL` | `https://4xpulse.com` |
| `STRIPE_SECRET_KEY` | Live key `sk_live_...` (use `sk_test_...` first to test) |
| `STRIPE_PUBLISHABLE_KEY` | Matching `pk_live_...` / `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | From step 3 below (`whsec_...`) |
| `OWNER_PASSCODE` | Choose a passcode for `/owner` (not the private app’s passkey) |
| `SESSION_SECRET` | Auto-generated by render.yaml |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Any SMTP provider (e.g. Gmail with an app password, SendGrid). Leave unset and buyer emails fall back to manual send in Orders. |
| `DATABASE_PATH` | `/var/data/forex-pulse.db` (set by render.yaml) |

### 3. Stripe webhook

1. Stripe dashboard → **Developers → Webhooks → Add endpoint**:
   `https://4xpulse.com/webhooks/stripe`
2. Select event: **`checkout.session.completed`**.
3. Copy the **signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
4. Test with a test-mode card (`4242 4242 4242 4242`, any future date,
   any CVC) — the order should flip to Paid in `/owner` and the buyer
   email should arrive. Then switch the keys to live mode.

### 4. Custom domain — 4xpulse.com (Squarespace)

1. In Render: service → **Settings → Custom Domains → Add**
   `4xpulse.com` (and `www.4xpulse.com` if wanted). Render shows the
   DNS records to add (an `A` record to Render’s IP and/or a `CNAME`).
2. In Squarespace: **Settings → Domains → 4xpulse.com → DNS Settings** →
   add the records Render gave you (delete any conflicting A/CNAME for
   `@` / `www` first). DNS can take minutes to a few hours to propagate.
3. Render provisions the free HTTPS certificate automatically once DNS
   resolves. The domain is registered through Squarespace Domains until
   **2027-03-11**.

## Project layout

```
server.js            Express app: public pages, /api, Stripe, owner routes
src/db.js            SQLite (node:sqlite) — signals + orders
src/prices.js        Yahoo Finance live prices + Frankfurter daily fallback
src/calendar.js      Forex Factory weekly calendar feed → upcoming USD/EUR/GBP events
src/mail.js          Buyer confirmation email via SMTP (nodemailer)
src/auth.js          Owner passcode session (signed cookie)
src/views.js         Server-rendered HTML templates
public/style.css     Dark trading-terminal theme
public/app.js        Price refresh, pair expand, NEW tap-to-signal, filter, unlock form
render.yaml          Render Blueprint (service + persistent disk + env vars)
.env.example         Every env var, with no real secrets
```

## What was verified here (2026-11-24)

- Yahoo Finance chart API returns live quotes for **all 10 pairs**
  (tested with curl from this machine; e.g. EUR/USD 1.0936 +0.27%,
  AUD/JPY 105.647 +0.26%). Frankfurter daily rates also verified as
  fallback.
- App runs locally (`npm start`): homepage renders all 10 pairs live,
  `/api/prices` returns live data, `/healthz` OK.
- Owner login works (wrong passcode → 401); posting a BUY signal works;
  an invalid SELL (TP above entry) is rejected with a clear error;
  the new signal flashes NEW on its pair and shows “BUY signal” locked
  with a $20 unlock button; checkout without Stripe keys fails gracefully
  (503, no crash); `/unlock/<bad token>` and `/success` without a session
  show safe error pages; `/owner` redirects to login when logged out.

## What was NOT verified (needs Demetrius / live accounts)

- **Live Stripe payment end-to-end** — no Stripe keys exist yet. Test with
  test-mode keys first (card 4242…), then live keys. The webhook + the
  `/success` verification are both implemented, but neither has seen a
  real payment.
- **Buyer email delivery** — no SMTP account is configured. Nodemailer is
  wired; delivery depends on the SMTP credentials entered on Render.
- **Real price feed under load** — Yahoo Finance’s chart endpoint is
  unofficial (no SLA, no key). It worked consistently in testing, but if
  Yahoo rate-limits or blocks the Render IP, affected pairs fall back to
  Frankfurter daily rates (labelled “Daily rate”). If that becomes a
  problem, a paid feed (e.g. Twelve Data / Finnhub) can replace Yahoo in
  `src/prices.js` without touching anything else.
- **Render deploy itself** — no Render account exists yet. The
  `render.yaml` follows Render’s Blueprint format, but the first deploy
  has not been run.
- **DNS for 4xpulse.com** — the domain is confirmed registered through
  Squarespace (expires 2027-03-11), but no DNS records have been changed.

## Still needed from Demetrius

1. **Render account** — create it, then deploy this folder (steps above).
2. **Stripe keys** — test keys first, then live keys, plus the webhook
   secret (step 3).
3. **Owner passcode** — choose one for the public storefront’s `/owner`
   (different from the private app’s passkey).
4. **SMTP credentials** — for buyer confirmation emails (or accept the
   manual-send fallback in Orders).
5. **Squarespace DNS** — add Render’s records for 4xpulse.com once the
   service exists.
