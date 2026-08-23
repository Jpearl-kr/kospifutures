(function () {
  var K = window.KF;

  function fmtDateYmd(ymd) {
    var s = String(ymd);
    if (s.length !== 8) return s;
    return K.formatDateLong(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  }

  function fmtTime(hhmmss) {
    var s = String(hhmmss || '');
    if (s.length < 4) return '';
    return s.slice(0, 2) + ':' + s.slice(2, 4);
  }

  // Foreign/institution figures come through as net contract/share counts,
  // so keep them as plain signed integers rather than inventing a unit.
  function fmtNet(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    var sign = n > 0 ? '+' : '';
    return sign + Math.round(n).toLocaleString('en-US');
  }

  function netClass(n) {
    if (n > 0) return 'up';
    if (n < 0) return 'down';
    return '';
  }

  function setNet(id, n) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = fmtNet(n);
    el.classList.remove('up', 'down');
    var c = netClass(n);
    if (c) el.classList.add(c);
  }

  function positionMarker(id, low, high, value) {
    var el = document.getElementById(id);
    if (!el || low === null || high === null || value === null || high <= low) return null;
    var pct = ((value - low) / (high - low)) * 100;
    pct = Math.max(0, Math.min(100, pct));
    el.style.left = pct + '%';
    return pct;
  }

  K.fetchJSON('/api/ls').then(function (data) {
    if (data.error) {
      K.setText('dsDate', 'Data unavailable');
      K.setText('dsAsOf', 'Live data unavailable');
      return;
    }

    var idx = data.index || {};
    var hist = data.history || [];

    // ---- headline -------------------------------------------------------
    var todayRow = hist.length ? hist[0] : null;
    K.setText('dsDate', todayRow ? fmtDateYmd(todayRow.date) : '—');
    K.setText('dsClose', K.fmtNumber(idx.price));
    K.setText('dsChange', K.fmtChange(idx.change) + ' (' + K.fmtPercent(idx.changePercent) + ')');
    K.setChangeClass('dsChange', idx.change);

    K.setText('dsOpen', K.fmtNumber(idx.open));
    K.setText('dsHigh', K.fmtNumber(idx.high));
    K.setText('dsLow', K.fmtNumber(idx.low));
    K.setText('dsPrevClose', K.fmtNumber(idx.prevClose));
    K.setText('dsHighTime', fmtTime(idx.highTime));
    K.setText('dsLowTime', fmtTime(idx.lowTime));

    // ---- range positioning ---------------------------------------------
    K.setText('dsRangeLow', K.fmtNumber(idx.low));
    K.setText('dsRangeHigh', K.fmtNumber(idx.high));
    var dayPct = positionMarker('dsDayMarker', idx.low, idx.high, idx.price);
    if (dayPct !== null) {
      K.setText(
        'dsDayNote',
        'Closed ' + dayPct.toFixed(0) + '% of the way up the session range' +
          (dayPct >= 70 ? ' — near the highs.' : dayPct <= 30 ? ' — near the lows.' : '.')
      );
    }

    K.setText('dsYearLow', K.fmtNumber(idx.yearLow));
    K.setText('dsYearHigh', K.fmtNumber(idx.yearHigh));
    var yearPct = positionMarker('dsYearMarker', idx.yearLow, idx.yearHigh, idx.price);
    if (yearPct !== null && idx.yearHigh) {
      var fromHigh = ((idx.price - idx.yearHigh) / idx.yearHigh) * 100;
      K.setText(
        'dsYearNote',
        K.fmtPercent(fromHigh) + ' from the 52-week high (' + fmtDateYmd(idx.yearHighDate) + ')' +
          ', low set ' + fmtDateYmd(idx.yearLowDate) + '.'
      );
    }

    // ---- breadth --------------------------------------------------------
    // The live snapshot zeroes these out after the close, so fall back to
    // the most recent session in the daily history that actually has counts.
    var breadth = null;
    if ((idx.advancing || 0) + (idx.declining || 0) > 0) {
      breadth = { adv: idx.advancing, dec: idx.declining, unch: idx.unchanged, total: 200 };
    } else {
      for (var i = 0; i < hist.length; i++) {
        var h = hist[i];
        if ((h.advancing || 0) + (h.declining || 0) > 0) {
          breadth = {
            adv: h.advancing,
            dec: h.declining,
            unch: h.unchanged,
            total: h.totalIssues || 200,
            date: h.date,
          };
          break;
        }
      }
    }

    if (breadth) {
      var total = breadth.adv + breadth.dec + (breadth.unch || 0);
      if (total > 0) {
        document.getElementById('dsBreadthAdv').style.width = (breadth.adv / total) * 100 + '%';
        document.getElementById('dsBreadthUnch').style.width = ((breadth.unch || 0) / total) * 100 + '%';
        document.getElementById('dsBreadthDec').style.width = (breadth.dec / total) * 100 + '%';
      }
      K.setText('dsAdv', String(breadth.adv));
      K.setText('dsUnch', String(breadth.unch || 0));
      K.setText('dsDec', String(breadth.dec));
      var advShare = total ? (breadth.adv / total) * 100 : 0;
      K.setText(
        'dsBreadthNote',
        advShare >= 60
          ? 'Broad-based advance — most constituents rose with the index.'
          : advShare <= 40
          ? 'Broad-based decline — most constituents fell with the index.'
          : 'Mixed session — gains and losses were fairly evenly split.'
      );
    } else {
      K.setText('dsBreadthNote', 'Breadth counts are published once the session closes.');
    }

    // ---- flows ----------------------------------------------------------
    if (todayRow) {
      setNet('dsForeignToday', todayRow.foreignNet);
      setNet('dsInstToday', todayRow.instNet);
    }
    var last5 = hist.slice(0, 5);
    var sum = function (rows, key) {
      return rows.reduce(function (a, r) { return a + (r[key] || 0); }, 0);
    };
    setNet('dsForeign5d', sum(last5, 'foreignNet'));
    setNet('dsInst5d', sum(last5, 'instNet'));

    var flowBody = document.getElementById('dsFlowBody');
    var rowsHtml = hist.slice(0, 10).map(function (r) {
      var cls = r.change > 0 ? 'up' : r.change < 0 ? 'down' : '';
      return '<tr><td>' + fmtDateYmd(r.date) + '</td><td>' + K.fmtNumber(r.close) +
        '</td><td class="' + cls + '">' + K.fmtPercent(r.changePercent) +
        '</td><td class="' + netClass(r.foreignNet) + '">' + fmtNet(r.foreignNet) +
        '</td><td class="' + netClass(r.instNet) + '">' + fmtNet(r.instNet) + '</td></tr>';
    }).join('');
    flowBody.innerHTML = rowsHtml || '<tr><td colspan="5">No data</td></tr>';

    // ---- session activity ----------------------------------------------
    K.setText('dsVolume', K.fmtVolume(idx.volume));
    K.setText('dsTradingValue', K.fmtVolume(idx.tradingValue));
    if (idx.high !== null && idx.low !== null && idx.prevClose) {
      var width = idx.high - idx.low;
      K.setText(
        'dsRangeWidth',
        K.fmtNumber(width) + ' pts (' + ((width / idx.prevClose) * 100).toFixed(2) + '%)'
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
        streakEl.textContent = streak + (dir > 0 ? ' day' : ' day') + (streak > 1 ? 's' : '') +
          (dir > 0 ? ' up' : ' down');
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

    K.setText('dsAsOf', 'Data as of ' + K.formatTimestamp(new Date()) + ' — source: LS Securities Open API');
  }).catch(function () {
    K.setText('dsDate', 'Data unavailable');
    K.setText('dsAsOf', 'Live data unavailable');
  });
})();
