if ('scrollRestoration' in history) {
  // Without this, some browsers reuse the scroll position from the last
  // visit to this URL (e.g. tab reuse, back/forward cache) instead of
  // starting a fresh load at the top.
  history.scrollRestoration = 'manual';
  if (!location.hash) window.scrollTo(0, 0);
}

(function () {
  var toggle = document.getElementById('navToggle');
  var sidebar = document.getElementById('sidebar');
  var overlay = document.getElementById('sidebarOverlay');

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
  }

  toggle.addEventListener('click', function () {
    var isOpen = sidebar.classList.contains('open');
    if (isOpen) { closeSidebar(); } else { openSidebar(); }
  });

  overlay.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', closeSidebar);
  });
})();

(function () {
  function fmtNumber(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtChange(change, digits) {
    if (change === null || change === undefined || isNaN(change)) return '—';
    var sign = change > 0 ? '+' : '';
    return sign + fmtNumber(change, digits);
  }

  function fmtPercent(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '—';
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setChangeClass(id, change) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('up', 'down');
    if (change > 0) el.classList.add('up');
    else if (change < 0) el.classList.add('down');
  }

  function formatTimestamp(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.month + '/' + map.day + '/' + map.year + ' ' + map.hour + ':' + map.minute + ':' + map.second + ' KST';
  }

  function applyQuote(prefix, quote, digits) {
    digits = digits || 2;
    if (!quote) {
      setText(prefix + 'Value', 'N/A');
      return;
    }
    setText(prefix + 'Value', fmtNumber(quote.price, digits));
    var changeEl = prefix + 'Change';
    var pctEl = prefix + 'Pct';
    var hasPctEl = !!document.getElementById(pctEl);
    if (document.getElementById(changeEl)) {
      // Table rows have a separate % column, so Change shows the point
      // move there; ticker items (no % column) show percent directly.
      setText(changeEl, hasPctEl ? fmtChange(quote.change, digits) : fmtPercent(quote.changePercent));
      setChangeClass(changeEl, quote.change);
    }
    if (hasPctEl) {
      setText(pctEl, fmtPercent(quote.changePercent));
      setChangeClass(pctEl, quote.change);
    }
  }

  fetch('/api/quotes')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var q = data.quotes || {};
      var now = new Date();
      var stamp = formatTimestamp(now);

      // Hero: KOSPI 200
      if (q.kospi200) {
        setText('mainPrice', fmtNumber(q.kospi200.price, 2));
        setText('mainChange', fmtChange(q.kospi200.change, 2) + ' (' + fmtPercent(q.kospi200.changePercent) + ')');
        setChangeClass('mainChange', q.kospi200.change);
      } else {
        setText('mainPrice', 'N/A');
      }
      setText('heroTimestamp', stamp);

      // Ticker row — fetched in the same request as the headline figure,
      // so call out that they're all in sync rather than repeating the
      // timestamp four more times.
      applyQuote('tKospi', q.kospi, 2);
      applyQuote('tKosdaq', q.kosdaq, 2);
      applyQuote('tUsdKrw', q.usdkrw, 2);
      applyQuote('tUsSemi', q.ussemi, 2);
      setText('tickerSync', stamp);

      // Range & volatility panel — filled from this same response rather
      // than a second call, so the home page makes one request in total.
      applyRangePanel(q.kospi200, stamp);

      // Signal cards: timestamp only, states remain a sample until the
      // signal methodology is implemented.
      var signalStamp = 'Updated ' + stamp;
      setText('signalUpdatedShort', signalStamp);
      setText('signalUpdatedMedium', signalStamp);
      setText('signalUpdatedLong', signalStamp);
    })
    .catch(function () {
      setText('heroTimestamp', 'Live data unavailable');
      setText('dataAsOf', 'Live data unavailable');
    });

  // Position the price along each range so the reader sees where it sits
  // without doing the arithmetic themselves.
  function placeOn(low, high, value, fillId, dotId) {
    if (!low || !high || !value || high <= low) return null;
    var pct = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
    var fill = document.getElementById(fillId);
    var dot = document.getElementById(dotId);
    if (fill) fill.style.width = pct + '%';
    if (dot) dot.style.left = pct + '%';
    return pct;
  }

  function applyRangePanel(k, stamp) {
    if (!k) {
      setText('dataAsOf', 'Live data unavailable');
      return;
    }

    setText('rvDayLow', fmtNumber(k.dayLow, 2));
    setText('rvDayHigh', fmtNumber(k.dayHigh, 2));
    placeOn(k.dayLow, k.dayHigh, k.price, 'rvDayFill', 'rvDayDot');

    if (k.changeSinceCycleStart !== null && k.changeSinceCycleStart !== undefined) {
      setText('rvCycleReturn', fmtPercent(k.changeSinceCycleStart));
      setChangeClass('rvCycleReturn', k.changeSinceCycleStart);
    }

    if (k.daysToExpiry !== null && k.daysToExpiry !== undefined) {
      setText('rvExpiry', k.daysToExpiry + (k.daysToExpiry === 1 ? ' day' : ' days'));
    }

    setText('dataAsOf', stamp);
  }

  // Basis and open interest come from KRX's own daily futures print
  // (the exchange publishes once per session, never intraday), fetched
  // separately from — and in parallel with — the Yahoo-based quote above
  // so this one extra request never blocks the hero price or ticker row.
  function applyFuturesPanel(front) {
    if (!front) return;
    if (front.basis !== null && front.basis !== undefined) {
      setText('rvBasis', fmtChange(front.basis, 2));
      setChangeClass('rvBasis', front.basis);
    }
    if (front.openInterest !== null && front.openInterest !== undefined) {
      setText('rvOpenInterest', Math.round(front.openInterest).toLocaleString('en-US'));
    }
  }

  // KRX's own published index change is the authoritative number for
  // KOSPI 200 — Yahoo's mirror ticker (^KS200) has repeatedly gone
  // stale or gappy for this specific symbol, which has produced wrong
  // hero change/% figures. Once this (already in-flight) response
  // lands, it overwrites whatever Yahoo showed first.
  function applyIndexOverride(index) {
    if (!index || index.close === null || index.close === undefined) return;
    setText('mainPrice', fmtNumber(index.close, 2));
    if (index.change !== null && index.change !== undefined) {
      setText('mainChange', fmtChange(index.change, 2) + ' (' + fmtPercent(index.changePercent) + ')');
      setChangeClass('mainChange', index.change);
    }
  }

  fetch('/api/krx?include=futures')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var futures = (data && data.futures) || [];
      applyFuturesPanel(futures[0] || null);
      applyIndexOverride(data && data.index);
    })
    .catch(function () {});

})();
