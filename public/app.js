'use strict';
/* Public storefront client JS: price refresh (30 min + manual), pair expand,
   NEW-pair tap-to-signal, pair filter, unlock order form. */
(function () {
  const DECIMALS = {
    'EUR/USD': 4, 'USD/JPY': 3, 'GBP/USD': 4, 'USD/CHF': 4, 'AUD/USD': 4,
    'USD/CAD': 4, 'NZD/USD': 4, 'GBP/JPY': 3, 'AUD/JPY': 3, 'CHF/JPY': 3,
  };

  function sparklineSvg(points, up) {
    if (!points || points.length < 2) return '<span class="spark-empty">—</span>';
    const w = 90, h = 28, min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    const range = max - min || 1;
    const step = w / (points.length - 1);
    const pts = points.map(function (v, i) {
      return (i * step).toFixed(1) + ',' + (h - 3 - ((v - min) / range) * (h - 6)).toFixed(1);
    }).join(' ');
    const color = up === null ? '#9aa4b2' : up ? '#22c55e' : '#ef4444';
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="1.5"/></svg>';
  }

  function fmt(pair, v) {
    if (typeof v !== 'number') return '—';
    return v.toFixed(DECIMALS[pair] || 4);
  }

  async function refreshPrices() {
    try {
      const res = await fetch('/api/prices');
      if (!res.ok) return;
      const data = await res.json();
      const updated = document.getElementById('last-updated');
      if (updated && data.updatedAt) {
        updated.textContent = 'Last updated: ' + new Date(data.updatedAt).toLocaleString();
      }
      data.prices.forEach(function (p) {
        const row = document.querySelector('.pair-row[data-pair="' + p.pair + '"]');
        if (!row) return;
        const up = p.changePct == null ? null : p.changePct >= 0;
        const priceEl = row.querySelector('.pair-price');
        if (priceEl) priceEl.textContent = fmt(p.pair, p.price);
        const chEl = row.querySelector('.pair-change');
        if (chEl) {
          chEl.textContent = p.changePct == null ? '—'
            : (up ? '▲ ' : '▼ ') + Math.abs(p.changePct).toFixed(2) + '%';
          chEl.className = 'pair-change ' + (up === null ? '' : up ? 'up' : 'down');
        }
        const spark = row.querySelector('.spark, .spark-empty');
        if (spark) spark.outerHTML = sparklineSvg(p.sparkline, up);
        const livePrice = document.querySelector('[data-live-price="' + p.pair + '"]');
        if (livePrice) livePrice.textContent = fmt(p.pair, p.price);
        const liveChange = document.querySelector('[data-live-change="' + p.pair + '"]');
        if (liveChange) {
          liveChange.textContent = p.changePct == null ? '—'
            : (up ? '▲ ' : '▼ ') + Math.abs(p.changePct).toFixed(2) + '%';
          liveChange.className = 'pair-change ' + (up === null ? '' : up ? 'up' : 'down');
        }
        const detail = row.querySelector('.pair-detail');
        if (detail && p.price != null) {
          const spans = detail.querySelectorAll('span');
          if (spans[0]) spans[0].innerHTML = 'Open <b>' + fmt(p.pair, p.open) + '</b>';
          if (spans[1]) spans[1].innerHTML = 'High <b>' + fmt(p.pair, p.dayHigh) + '</b>';
          if (spans[2]) spans[2].innerHTML = 'Low <b>' + fmt(p.pair, p.dayLow) + '</b>';
          if (spans[3]) spans[3].innerHTML = 'Prev close <b>' + fmt(p.pair, p.prevClose) + '</b>';
        }
      });
    } catch (e) {
      console.error('Price refresh failed', e);
    }
  }

  // Matrix row / pair card: tapping a pair behaves exactly like tapping
  // its price row — a pair with a new signal today jumps straight to that
  // signal; any other pair opens its price details (open / high / low /
  // prev close, sparkline) in the Live prices list.
  document.addEventListener('click', function (e) {
    const jump = e.target.closest('.card-unlock, .log-unlock');
    if (jump) {
      scrollToPairSignal(jump.getAttribute('data-pair'));
      return;
    }
    const el = e.target.closest('.mx-row, .pair-card');
    if (!el) return;
    const pair = el.getAttribute('data-pair');
    if (el.getAttribute('data-new') === '1') {
      scrollToPairSignal(pair);
      return;
    }
    const row = document.querySelector('.pair-row[data-pair="' + pair + '"]');
    if (!row) return;
    row.classList.add('open');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  // Matrix / Cards view toggle.
  document.querySelectorAll('.view-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.view-btn').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      const matrix = document.getElementById('matrix-view');
      const cards = document.getElementById('cards-view');
      const showCards = btn.getAttribute('data-view') === 'cards';
      if (matrix) matrix.hidden = showCards;
      if (cards) cards.hidden = !showCards;
      const target = showCards ? cards : matrix;
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  // Performance Log filters (by outcome: open / won / lost).
  document.querySelectorAll('.log-filters .pill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.log-filters .pill').forEach(function (p) { p.classList.remove('active'); });
      pill.classList.add('active');
      const f = pill.getAttribute('data-filter');
      document.querySelectorAll('.log-row').forEach(function (row) {
        row.style.display = (f === 'all' || row.getAttribute('data-status') === f) ? '' : 'none';
      });
    });
  });

  // Pair rows: tap a NEW pair to jump to its signal; otherwise expand day range.
  document.addEventListener('click', function (e) {
    const viewBtn = e.target.closest('.view-signal');
    if (viewBtn) {
      e.stopPropagation();
      scrollToPairSignal(viewBtn.getAttribute('data-pair'));
      return;
    }
    const row = e.target.closest('.pair-row');
    if (!row) return;
    if (e.target.closest('button, a, input, select')) return;
    if (row.getAttribute('data-new') === '1') {
      scrollToPairSignal(row.getAttribute('data-pair'));
    } else {
      row.classList.toggle('open');
    }
  });

  function scrollToPairSignal(pair) {
    const card = document.querySelector('.signal-card[data-pair="' + pair + '"][data-status="open"]');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash-target');
    setTimeout(function () { card.classList.remove('flash-target'); }, 2500);
  }

  // Pair filter for signals.
  const filter = document.getElementById('pair-filter');
  if (filter) {
    filter.addEventListener('change', function () {
      const val = filter.value;
      document.querySelectorAll('.signal-card').forEach(function (card) {
        card.style.display = (val === 'All pairs' || card.getAttribute('data-pair') === val) ? '' : 'none';
      });
    });
  }

  // Unlock: show order form, then create a Stripe Checkout session.
  document.addEventListener('click', function (e) {
    const btn = e.target.closest('.unlock-btn');
    if (!btn) return;
    const form = document.querySelector('.order-form[data-signal="' + btn.getAttribute('data-signal') + '"]');
    if (form) {
      form.hidden = false;
      btn.style.display = 'none';
      const first = form.querySelector('input');
      if (first) first.focus();
    }
  });

  document.addEventListener('submit', async function (e) {
    const form = e.target.closest('.order-form');
    if (!form) return;
    e.preventDefault();
    const signalId = form.getAttribute('data-signal');
    const name = form.querySelector('input[name="name"]').value.trim();
    const email = form.querySelector('input[name="email"]').value.trim();
    if (!name || !email || email.indexOf('@') < 0) {
      alert('Please enter your name and a valid email.');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Starting secure checkout…';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signal_id: Number(signalId), name: name, email: email }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else {
        alert(data.error || 'Could not start checkout. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Pay $20 with card';
      }
    } catch (err) {
      alert('Could not start checkout. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Pay $20 with card';
    }
  });

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshPrices);
  setInterval(refreshPrices, 30 * 60 * 1000); // auto-refresh every 30 minutes
})();
