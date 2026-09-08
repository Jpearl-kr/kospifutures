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

  // Shared with the KRX fetch below, which resolves independently and
  // may land before or after this one.
  var latestKospi200 = null;

  fetch('/api/quotes')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      var q = data.quotes || {};
      var now = new Date();
      var stamp = formatTimestamp(now);
      latestKospi200 = q.kospi200 || null;

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

  // KRX never publishes intraday — its latest session is one full day
  // behind while the market is live. So this never asks KRX for "today's"
  // number: if KRX's session already matches the date Yahoo's live price
  // belongs to (market closed, both sources describe the same settled
  // day), its official change/% replaces Yahoo's — a more reliable
  // number than the mirror ticker that's produced wrong figures before.
  // If KRX is still a session behind (market open), its last published
  // close is exactly "yesterday's close" — used only as the reference
  // point to compute today's change against Yahoo's live price, never as
  // a substitute for it.
  function applyIndexOverride(index, session) {
    if (!index || index.close === null || index.close === undefined) return;
    var live = latestKospi200;

    if (live && live.quoteDate && session && live.quoteDate > session) {
      var change = live.price - index.close;
      var changePercent = index.close ? (change / index.close) * 100 : null;
      setText('mainChange', fmtChange(change, 2) + ' (' + fmtPercent(changePercent) + ')');
      setChangeClass('mainChange', change);
      return;
    }

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
      applyIndexOverride(data && data.index, data && data.session);
    })
    .catch(function () {});

  // ---- Implied vs. realized volatility, current option series ----------

  function ymdToDate(s) {
    s = String(s);
    return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  }

  function shortDate(ymd) {
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = ymdToDate(ymd);
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  // Two series on one volatility scale: realized as a continuous path (one
  // reading per session), implied as its three sampled sessions. The
  // implied line is dashed precisely because it is sampled, not daily —
  // it shouldn't read as a measured path between those points.
  function drawVolChart(vc) {
    var svg = document.getElementById('vcChart');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var rv = vc.rvPath || [];
    var iv = vc.ivPath || [];
    if (!rv.length && !iv.length) return;

    var W = 640, H = 210;
    var padL = 44, padR = 54, padT = 16, padB = 26;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    var t0 = ymdToDate(vc.cycleStart).getTime();
    var t1 = ymdToDate(vc.expiry).getTime();
    var span = t1 - t0 || 1;
    var x = function (ymd) { return padL + ((ymdToDate(ymd).getTime() - t0) / span) * plotW; };

    var vals = rv.map(function (p) { return p.vol; }).concat(iv.map(function (p) { return p.iv; }));
    var lo = Math.min.apply(null, vals);
    var hi = Math.max.apply(null, vals);
    var pad = Math.max((hi - lo) * 0.2, 1);
    lo = Math.max(0, lo - pad);
    hi = hi + pad;
    var y = function (v) { return padT + plotH - ((v - lo) / (hi - lo || 1)) * plotH; };

    // Horizontal guides, labelled in volatility points.
    [0, 0.5, 1].forEach(function (f) {
      var v = lo + (hi - lo) * f;
      var yy = y(v);
      svg.appendChild(svgEl('line', {
        x1: padL, x2: padL + plotW, y1: yy, y2: yy, class: 'vc-grid',
      }));
      var label = svgEl('text', { x: padL - 8, y: yy + 4, class: 'vc-axis', 'text-anchor': 'end' });
      label.textContent = v.toFixed(0) + '%';
      svg.appendChild(label);
    });

    // Expiry marker — shows how far through the series today sits.
    svg.appendChild(svgEl('line', {
      x1: padL + plotW, x2: padL + plotW, y1: padT, y2: padT + plotH, class: 'vc-expiry-line',
    }));
    var expLabel = svgEl('text', { x: padL + plotW + 6, y: padT + 10, class: 'vc-axis vc-expiry-label' });
    expLabel.textContent = 'expiry';
    svg.appendChild(expLabel);

    var line = function (pts, cls) {
      if (pts.length < 2) return;
      svg.appendChild(svgEl('polyline', {
        points: pts.map(function (p) { return p.x + ',' + p.y; }).join(' '),
        class: cls,
      }));
    };

    var rvPts = rv.map(function (p) { return { x: x(p.date), y: y(p.vol) }; });
    var ivPts = iv.map(function (p) { return { x: x(p.date), y: y(p.iv) }; });
    line(rvPts, 'vc-line-realized');
    line(ivPts, 'vc-line-implied');

    ivPts.forEach(function (p) {
      svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 3.5, class: 'vc-dot-implied' }));
    });

    // Label each series where it ends, so the chart reads without a key.
    var endLabel = function (pts, value, cls) {
      if (!pts.length || value === null || value === undefined) return;
      var p = pts[pts.length - 1];
      svg.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 3.5, class: cls + '-dot' }));
      var t = svgEl('text', { x: p.x + 7, y: p.y + 4, class: cls + '-label' });
      t.textContent = value.toFixed(1) + '%';
      svg.appendChild(t);
    };
    endLabel(rvPts, rv.length ? rv[rv.length - 1].vol : null, 'vc-end-realized');
    endLabel(ivPts, iv.length ? iv[iv.length - 1].iv : null, 'vc-end-implied');

    // X ends: the session the series became front month, and the last close.
    var startText = svgEl('text', { x: padL, y: H - 8, class: 'vc-axis' });
    startText.textContent = shortDate(vc.cycleStart);
    svg.appendChild(startText);
    var endText = svgEl('text', { x: padL + plotW, y: H - 8, class: 'vc-axis', 'text-anchor': 'end' });
    endText.textContent = shortDate(vc.expiry);
    svg.appendChild(endText);
  }

  function applyVolCycle(vc) {
    if (!vc) {
      setText('vcSub', 'Option series data unavailable');
      setText('vcRead', 'The volatility comparison needs KRX’s published option chain, which is not available right now.');
      return;
    }

    setText('vcSub',
      'Current series: ' + shortDate(vc.cycleStart) + ' → ' + shortDate(vc.expiry) +
      ' · ' + vc.sessions + ' sessions traded' +
      (vc.daysToExpiry !== null && vc.daysToExpiry !== undefined
        ? ' · ' + vc.daysToExpiry + (vc.daysToExpiry === 1 ? ' day' : ' days') + ' to expiry'
        : ''));

    drawVolChart(vc);

    var iv = vc.ivPath || [];
    var ivNow = iv.length ? iv[iv.length - 1].iv : null;
    var ivStart = iv.length ? iv[0].iv : null;
    var rvNow = vc.realized;

    if (ivNow !== null && ivNow !== undefined) {
      setText('vcIvNow', ivNow.toFixed(1) + '%');
      if (ivStart !== null && ivStart !== undefined && iv.length > 1) {
        var ivDelta = ivNow - ivStart;
        setText('vcIvDelta', fmtChange(ivDelta, 1) + ' pts since ' + shortDate(vc.cycleStart));
        setChangeClass('vcIvDelta', ivDelta);
      } else {
        setText('vcIvDelta', 'series start unavailable');
      }
    }

    if (rvNow !== null && rvNow !== undefined) {
      setText('vcRvNow', rvNow.toFixed(1) + '%');
      setText('vcRvNote', 'annualized from ' + vc.sessions + ' closes');
      if (vc.indexChangePercent !== null && vc.indexChangePercent !== undefined) {
        setText('vcRvNote', 'index ' + fmtPercent(vc.indexChangePercent) + ' over the series');
      }
    }

    if (ivNow !== null && ivNow !== undefined && rvNow !== null && rvNow !== undefined) {
      var spread = ivNow - rvNow;
      setText('vcSpread', fmtChange(spread, 1) + ' pts');
      setChangeClass('vcSpread', spread);
      setText('vcSpreadNote', spread > 0 ? 'options priced above delivered' : 'options priced below delivered');
      setText('vcRead',
        spread > 1
          ? 'Options are pricing ' + Math.abs(spread).toFixed(1) + ' points more volatility than the index has actually delivered since this series opened — protection carries a premium.'
          : spread < -1
          ? 'Realized volatility is running ' + Math.abs(spread).toFixed(1) + ' points above what options are pricing — the index has moved more than the chain expected.'
          : 'Implied and realized volatility are closely aligned — the option market and the index agree on how much this market is moving.');
    } else if (rvNow !== null && rvNow !== undefined) {
      // Realized landed but the option chain didn't — say so rather than
      // leaving the loading line sitting there.
      setText('vcRead',
        'The index has delivered ' + rvNow.toFixed(1) + '% annualized volatility since this series opened. ' +
        'KRX’s implied volatility for the chain is unavailable right now, so the two can’t be compared.');
    }
  }

  fetch('/api/krx?include=volcycle')
    .then(function (res) { return res.json(); })
    .then(function (data) { applyVolCycle(data && data.volCycle); })
    .catch(function () { applyVolCycle(null); });

})();
