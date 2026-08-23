(function () {
  var K = window.KF;
  var TRADING_DAYS = 252;

  function fmtDateYmd(ymd) {
    var s = String(ymd);
    if (s.length !== 8) return s;
    return K.formatDateLong(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  }

  // Annualized stdev of daily log returns over the most recent `window` days.
  function realizedVol(rows, window) {
    var closes = rows.slice(0, window + 1).map(function (r) { return r.close; })
      .filter(function (c) { return typeof c === 'number' && c > 0; });
    if (closes.length < 3) return null;

    var returns = [];
    // rows come newest-first, so step backwards for chronological returns.
    for (var i = closes.length - 1; i > 0; i--) {
      returns.push(Math.log(closes[i - 1] / closes[i]));
    }
    var mean = returns.reduce(function (a, b) { return a + b; }, 0) / returns.length;
    var variance = returns.reduce(function (a, b) {
      return a + Math.pow(b - mean, 2);
    }, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100;
  }

  function avgAbsMove(rows, window) {
    var slice = rows.slice(0, window).filter(function (r) {
      return typeof r.changePercent === 'number';
    });
    if (!slice.length) return null;
    return slice.reduce(function (a, r) { return a + Math.abs(r.changePercent); }, 0) / slice.length;
  }

  Promise.all([
    K.fetchJSON('/api/ls'),
    K.fetchJSON('/api/options').catch(function () { return { error: true }; }),
  ]).then(function (results) {
    var data = results[0];
    var opt = results[1];

    if (data.error) {
      K.setText('rvAsOf', 'Live data unavailable');
      return;
    }

    var idx = data.index || {};
    var hist = data.history || [];

    // ---- realized vs implied -------------------------------------------
    var rv20 = realizedVol(hist, 20);
    K.setText('rvRealized20', rv20 !== null ? rv20.toFixed(1) + '%' : '—');

    var iv = null;
    if (!opt.error && opt.summary) {
      iv = opt.summary.averageIv;
      // Prefer the board's own call/put IV headline when present.
      var u = opt.underlying || {};
      if (u.callIv && u.putIv) iv = (u.callIv + u.putIv) / 2;
    }
    K.setText('rvImplied', iv !== null && iv !== undefined ? iv.toFixed(1) + '%' : '—');

    if (rv20 !== null && iv) {
      var spread = iv - rv20;
      K.setText('rvVsOp', spread > 0 ? '<' : '>');
      K.setText(
        'rvVerdict',
        spread > 2
          ? 'Options are pricing in more movement than the index has actually delivered — a ' +
            spread.toFixed(1) + ' point premium. Volatility sellers get paid more here; buyers pay up.'
          : spread < -2
          ? 'The index has been moving more than options are pricing — implied sits ' +
            Math.abs(spread).toFixed(1) + ' points below realized. Protection looks comparatively cheap.'
          : 'Implied and realized volatility are closely aligned — the options market and recent price action agree on how much this index moves.'
      );
    }

    // ---- realized vol by horizon ---------------------------------------
    var horizons = [
      { label: '5-day', window: 5 },
      { label: '10-day', window: 10 },
      { label: '20-day', window: 20 },
    ];
    var horizonHtml = horizons.map(function (h) {
      var vol = realizedVol(hist, h.window);
      var move = avgAbsMove(hist, h.window);
      var rel = vol !== null && rv20 ? ((vol / rv20 - 1) * 100) : null;
      var relCls = rel === null ? '' : rel > 0 ? 'up' : rel < 0 ? 'down' : '';
      return '<tr><td>' + h.label + '</td><td>' +
        (vol !== null ? vol.toFixed(1) + '%' : '—') + '</td><td>' +
        (move !== null ? move.toFixed(2) + '%' : '—') + '</td><td class="' + relCls + '">' +
        (rel === null || h.window === 20 ? '—' : (rel > 0 ? '+' : '') + rel.toFixed(0) + '%') +
        '</td></tr>';
    }).join('');
    document.getElementById('rvHorizonBody').innerHTML = horizonHtml;

    // ---- daily range table ---------------------------------------------
    var rangeRows = hist.filter(function (r) {
      return typeof r.high === 'number' && typeof r.low === 'number' && r.high > r.low;
    });

    var rangeHtml = rangeRows.slice(0, 15).map(function (r) {
      var width = r.high - r.low;
      var widthPct = r.close ? (width / r.close) * 100 : null;
      var pos = ((r.close - r.low) / width) * 100;
      var posCls = pos >= 70 ? 'up' : pos <= 30 ? 'down' : '';
      return '<tr><td>' + fmtDateYmd(r.date) + '</td><td>' +
        K.fmtNumber(r.low) + ' – ' + K.fmtNumber(r.high) + '</td><td>' +
        K.fmtNumber(width) + '</td><td>' +
        (widthPct !== null ? widthPct.toFixed(2) + '%' : '—') + '</td><td class="' + posCls + '">' +
        pos.toFixed(0) + '%</td></tr>';
    }).join('');
    document.getElementById('rvRangeBody').innerHTML =
      rangeHtml || '<tr><td colspan="5">No data</td></tr>';

    // ---- expected move --------------------------------------------------
    if (iv && idx.price) {
      var dailySigma = (iv / 100) / Math.sqrt(TRADING_DAYS);
      var oneDay = idx.price * dailySigma;
      var oneWeek = idx.price * dailySigma * Math.sqrt(5);
      K.setText('rvExp1d', '±' + K.fmtNumber(oneDay) + ' pts (' + (dailySigma * 100).toFixed(2) + '%)');
      K.setText('rvExp1w', '±' + K.fmtNumber(oneWeek) + ' pts (' + (dailySigma * Math.sqrt(5) * 100).toFixed(2) + '%)');

      var dte = opt.underlying && opt.underlying.daysToExpiry;
      if (dte) {
        var toExpiry = idx.price * dailySigma * Math.sqrt(dte);
        K.setText('rvExpExpiry', '±' + K.fmtNumber(toExpiry) + ' pts');
        K.setText('rvDte', dte + ' days');
      }
    }

    // ---- range statistics -----------------------------------------------
    if (rangeRows.length) {
      var widths = rangeRows.map(function (r) {
        return { date: r.date, width: r.high - r.low, close: r.close };
      });
      var avgWidth = widths.reduce(function (a, w) { return a + w.width; }, 0) / widths.length;
      K.setText('rvAvgRange', K.fmtNumber(avgWidth) + ' pts');

      var sorted = widths.slice().sort(function (a, b) { return b.width - a.width; });
      K.setText('rvWidest', K.fmtNumber(sorted[0].width) + ' · ' + fmtDateYmd(sorted[0].date));
      var narrow = sorted[sorted.length - 1];
      K.setText('rvNarrowest', K.fmtNumber(narrow.width) + ' · ' + fmtDateYmd(narrow.date));

      var above = widths.filter(function (w) { return w.width > avgWidth; }).length;
      K.setText('rvAboveAvg', above + ' of ' + widths.length);
    }

    // ---- 52-week position ------------------------------------------------
    K.setText('rvYearLow', K.fmtNumber(idx.yearLow));
    K.setText('rvYearHigh', K.fmtNumber(idx.yearHigh));
    if (idx.yearLow && idx.yearHigh && idx.yearHigh > idx.yearLow && idx.price) {
      var yp = ((idx.price - idx.yearLow) / (idx.yearHigh - idx.yearLow)) * 100;
      yp = Math.max(0, Math.min(100, yp));
      document.getElementById('rvYearMarker').style.left = yp + '%';
      var fromHigh = ((idx.price - idx.yearHigh) / idx.yearHigh) * 100;
      K.setText(
        'rvYearNote',
        yp.toFixed(0) + '% of the way up the 52-week range · ' +
          K.fmtPercent(fromHigh) + ' from the high'
      );
    }

    K.setText(
      'rvAsOf',
      'Data as of ' + K.formatTimestamp(new Date()) +
        ' — source: LS Securities Open API. Realized volatility is annualized from daily closes (252 trading days).'
    );
  }).catch(function () {
    K.setText('rvAsOf', 'Live data unavailable');
  });
})();
