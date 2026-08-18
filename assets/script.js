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

  function applyRelated(id, quote, digits) {
    digits = digits || 2;
    var el = document.getElementById(id);
    if (!el) return;
    if (!quote) { el.textContent = 'N/A'; return; }
    el.textContent = fmtNumber(quote.price, digits) + ' (' + fmtPercent(quote.changePercent) + ')';
    el.classList.remove('up', 'down');
    if (quote.change > 0) el.classList.add('up');
    else if (quote.change < 0) el.classList.add('down');
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
      applyQuote('tNikkei', q.nikkei225, 2);
      setText('tickerSync', 'KOSPI, KOSDAQ, USD/KRW & Nikkei 225 refreshed together with the figure above');

      // Range & volatility context for KOSPI 200
      if (q.kospi200) {
        var k = q.kospi200;
        setText('rvDayRange', fmtNumber(k.dayLow, 2) + ' – ' + fmtNumber(k.dayHigh, 2));
        setText('rvWeekRange', fmtNumber(k.weekLow52, 2) + ' – ' + fmtNumber(k.weekHigh52, 2));
        setText('rvVolume', k.volume ? Math.round(k.volume).toLocaleString('en-US') : '—');
        if (k.weekHigh52) {
          var fromHigh = ((k.price - k.weekHigh52) / k.weekHigh52) * 100;
          setText('rvFromHigh', fmtPercent(fromHigh) + ' from 52-wk high');
        }
      }
      setText('dataAsOf', 'Data as of ' + stamp + ' — source: Yahoo Finance');

      // Related indices
      applyRelated('riKospi', q.kospi, 2);
      applyRelated('riKosdaq', q.kosdaq, 2);
      applyRelated('riNikkei', q.nikkei225, 2);
      applyRelated('riSp500', q.sp500, 2);

      // Signal cards: timestamp only, states remain a sample until the
      // signal methodology is implemented.
      var signalStamp = 'Updated ' + stamp + ' (sample signal)';
      setText('signalUpdatedShort', signalStamp);
      setText('signalUpdatedMedium', signalStamp);
      setText('signalUpdatedLong', signalStamp);
    })
    .catch(function () {
      setText('heroTimestamp', 'Live data unavailable');
      setText('dataAsOf', 'Live data unavailable');
    });
})();
