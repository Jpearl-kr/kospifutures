(function () {
  var K = window.KF;

  function fmtDateYmd(ymd) {
    var s = String(ymd);
    if (s.length !== 8) return s;
    return K.formatDateLong(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  }

  function fmtNet(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + K.fmtNumber(n);
  }

  function netClass(n) {
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return '';
  }

  function positionMarker(id, low, high, value) {
    var el = document.getElementById(id);
    if (!el || low === null || high === null || value === null || high <= low) return null;
    var pct = ((value - low) / (high - low)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    el.style.left = pct + '%';
    return pct;
  }

  K.fetchJSON('/api/krx?include=index,history,breadth,futures').then(function (data) {
    if (data.error) {
      K.setText('dsDate', 'Data unavailable');
      K.setText('dsAsOf', 'Live data unavailable');
      return;
    }

    var idx = data.index || {};
    var hist = data.history || [];
    var breadth = data.breadth;
    var futures = data.futures || [];
    var prevClose = idx.close !== null && idx.change !== null ? idx.close - idx.change : null;

    // ---- headline --------------------------------------------------------
    K.setText('dsDate', fmtDateYmd(idx.date));
    K.setText('dsClose', K.fmtNumber(idx.close));
    K.setText('dsChange', K.fmtChange(idx.change) + ' (' + K.fmtPercent(idx.changePercent) + ')');
    K.setChangeClass('dsChange', idx.change);

    K.setText('dsOpen', K.fmtNumber(idx.open));
    K.setText('dsHigh', K.fmtNumber(idx.high));
    K.setText('dsLow', K.fmtNumber(idx.low));
    K.setText('dsPrevClose', K.fmtNumber(prevClose));

    // ---- range positioning -------------------------------------------
    K.setText('dsRangeLow', K.fmtNumber(idx.low));
    K.setText('dsRangeHigh', K.fmtNumber(idx.high));
    var dayPct = positionMarker('dsDayMarker', idx.low, idx.high, idx.close);
    if (dayPct !== null) {
      K.setText(
        'dsDayNote',
        'Closed ' + dayPct.toFixed(0) + '% of the way up the session range' +
          (dayPct >= 70 ? ' — near the highs.' : dayPct <= 30 ? ' — near the lows.' : '.')
      );
    }

    var week52 = data.week52;
    if (week52) {
      K.setText('dsYearLow', K.fmtNumber(week52.low));
      K.setText('dsYearHigh', K.fmtNumber(week52.high));
      var yearPct = positionMarker('dsYearMarker', week52.low, week52.high, idx.close);
      if (yearPct !== null && week52.high) {
        var fromHigh = ((idx.close - week52.high) / week52.high) * 100;
        K.setText('dsYearNote', K.fmtPercent(fromHigh) + ' from the 52-week high.');
      }
    }

    // ---- breadth ----------------------------------------------------------
    if (breadth) {
      var total = breadth.advancing + breadth.declining + (breadth.unchanged || 0);
      if (total > 0) {
        document.getElementById('dsBreadthAdv').style.width = (breadth.advancing / total) * 100 + '%';
        document.getElementById('dsBreadthUnch').style.width = ((breadth.unchanged || 0) / total) * 100 + '%';
        document.getElementById('dsBreadthDec').style.width = (breadth.declining / total) * 100 + '%';
      }
      K.setText('dsAdv', String(breadth.advancing));
      K.setText('dsUnch', String(breadth.unchanged || 0));
      K.setText('dsDec', String(breadth.declining));
      var advShare = total ? (breadth.advancing / total) * 100 : 0;
      K.setText(
        'dsBreadthNote',
        advShare >= 60
          ? 'Broad-based advance — most constituents rose with the index.'
          : advShare <= 40
          ? 'Broad-based decline — most constituents fell with the index.'
          : 'Mixed session — gains and losses were fairly evenly split.'
      );
    }

    // ---- futures & basis --------------------------------------------------
    var withDte = futures.filter(function (f) { return f.daysToExpiry !== null && f.daysToExpiry >= 0; });
    var frontMonth = withDte.slice().sort(function (a, b) { return a.daysToExpiry - b.daysToExpiry; })[0];

    if (frontMonth) {
      K.setText('dsFutFront', K.fmtNumber(frontMonth.close));
      if (frontMonth.basis !== null) {
        K.setText('dsFutBasis', fmtNet(frontMonth.basis));
        var basisEl = document.getElementById('dsFutBasis');
        basisEl.classList.remove('up', 'down');
        var bc = netClass(frontMonth.basis);
        if (bc) basisEl.classList.add(bc);
      }
      K.setText('dsFutOi', frontMonth.openInterest ? K.fmtNumber(frontMonth.openInterest) : '—');
      K.setText('dsFutDte', frontMonth.daysToExpiry + ' days');

      if (frontMonth.basis !== null && frontMonth.spot && frontMonth.daysToExpiry > 0) {
        var annualized = (frontMonth.basis / frontMonth.spot) * (365 / frontMonth.daysToExpiry) * 100;
        K.setText(
          'dsFutNote',
          frontMonth.basis > 0
            ? 'The front-month contract trades ' + K.fmtNumber(frontMonth.basis) +
              ' points above the index (contango) — an annualized carry of about ' +
              annualized.toFixed(1) + '%.'
            : frontMonth.basis < 0
            ? 'The front-month contract trades ' + K.fmtNumber(Math.abs(frontMonth.basis)) +
              ' points below the index (backwardation) — an annualized ' +
              Math.abs(annualized).toFixed(1) + '%, often a sign of near-term caution.'
            : 'The front-month contract is trading in line with the index.'
        );
      }
    }

    var futBody = document.getElementById('dsFutBody');
    var futRowsHtml = withDte.slice()
      .sort(function (a, b) { return a.daysToExpiry - b.daysToExpiry; })
      .slice(0, 4)
      .map(function (f) {
        var cls = f.change > 0 ? 'up' : f.change < 0 ? 'down' : '';
        return '<tr><td>' + (f.expiry || '—') + '</td><td>' + K.fmtNumber(f.close) +
          '</td><td class="' + cls + '">' + K.fmtChange(f.change) +
          '</td><td class="' + netClass(f.basis) + '">' + fmtNet(f.basis) +
          '</td><td>' + (f.openInterest ? K.fmtNumber(f.openInterest) : '—') + '</td></tr>';
      }).join('');
    futBody.innerHTML = futRowsHtml || '<tr><td colspan="5">No data</td></tr>';

    // ---- session activity ----------------------------------------------
    K.setText('dsVolume', K.fmtVolume(idx.volume));
    K.setText('dsTradingValue', K.fmtVolume(idx.tradingValue));
    if (idx.high !== null && idx.low !== null && prevClose) {
      var width = idx.high - idx.low;
      K.setText(
        'dsRangeWidth',
        K.fmtNumber(width) + ' pts (' + ((width / prevClose) * 100).toFixed(2) + '%)'
      );
    }
    var avgValue = hist.length
      ? hist.reduce(function (a, r) { return a + (r.tradingValue || 0); }, 0) / hist.length
      : 0;
    if (avgValue && idx.tradingValue) {
      var ratio = (idx.tradingValue / avgValue) * 100;
      K.setText(
        'dsValueVsAvg',
        ratio.toFixed(0) + '% of average' + (ratio >= 120 ? ' — heavier than usual' : ratio <= 80 ? ' — lighter than usual' : '')
      );
    }

    // ---- streak ---------------------------------------------------------
    if (hist.length) {
      var dir = hist[0].change > 0 ? 1 : hist[0].change < 0 ? -1 : 0;
      var streak = 0;
      if (dir !== 0) {
        for (var j = 0; j < hist.length; j++) {
          var d = hist[j].change > 0 ? 1 : hist[j].change < 0 ? -1 : 0;
          if (d !== dir) break;
          streak++;
        }
      }
      var streakEl = document.getElementById('dsStreak');
      if (streak > 0) {
        streakEl.textContent = streak + ' day' + (streak > 1 ? 's' : '') + (dir > 0 ? ' up' : ' down');
        streakEl.className = 'ds-streak ' + (dir > 0 ? 'up' : 'down');
        var cumulative = hist.slice(0, streak).reduce(function (a, r) { return a + (r.changePercent || 0); }, 0);
        K.setText('dsStreakNote', 'Cumulative move over the streak: ' + K.fmtPercent(cumulative) + '.');
      } else {
        streakEl.textContent = 'Flat';
        K.setText('dsStreakNote', 'The index closed unchanged.');
      }
    }

    // ---- 20-day context -------------------------------------------------
    var up = hist.filter(function (r) { return r.change > 0; }).length;
    var down = hist.filter(function (r) { return r.change < 0; }).length;
    K.setText('ds20Up', String(up));
    K.setText('ds20Down', String(down));
    var sorted = hist.slice().sort(function (a, b) { return (b.changePercent || 0) - (a.changePercent || 0); });
    if (sorted.length) {
      K.setText('ds20Best', K.fmtPercent(sorted[0].changePercent) + ' · ' + fmtDateYmd(sorted[0].date));
      var worst = sorted[sorted.length - 1];
      K.setText('ds20Worst', K.fmtPercent(worst.changePercent) + ' · ' + fmtDateYmd(worst.date));
    }

    K.setText('dsAsOf', fmtDateYmd(data.session) + ' session close · source: KRX Open API');
  }).catch(function () {
    K.setText('dsDate', 'Data unavailable');
    K.setText('dsAsOf', 'Live data unavailable');
  });
})();
