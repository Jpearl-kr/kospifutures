(function () {
  var K = window.KF;

  function fmtOi(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  // Max pain: the strike at which the combined intrinsic value owed to option
  // holders is smallest — i.e. where the most open contracts expire worthless.
  function maxPain(chain) {
    var strikes = chain.map(function (r) { return r.strike; });
    var best = null;
    strikes.forEach(function (settle) {
      var total = 0;
      chain.forEach(function (row) {
        if (row.call && row.call.openInterest && settle > row.strike) {
          total += (settle - row.strike) * row.call.openInterest;
        }
        if (row.put && row.put.openInterest && settle < row.strike) {
          total += (row.strike - settle) * row.put.openInterest;
        }
      });
      if (best === null || total < best.total) best = { strike: settle, total: total };
    });
    return best;
  }

  K.fetchJSON('/api/options').then(function (data) {
    if (data.error) {
      K.setText('dvAsOf', 'Live data unavailable');
      return;
    }

    var u = data.underlying || {};
    var s = data.summary || {};
    var chain = data.chain || [];

    // Restrict to strikes with actual open interest — the far wings are noise.
    var active = chain.filter(function (r) {
      return (r.call && r.call.openInterest) || (r.put && r.put.openInterest);
    });

    // Our data source publishes open interest and greeks on the put side
    // only, so anything derived from call OI can't be computed honestly.
    var cov = data.coverage || {};
    var hasCallOI = cov.callsHaveOpenInterest !== false;

    // ---- headline stats -------------------------------------------------
    if (hasCallOI && s.putCallOIRatio !== null && s.putCallOIRatio !== undefined) {
      K.setText('dvPcOi', s.putCallOIRatio.toFixed(2));
      K.setText(
        'dvPcOiNote',
        s.putCallOIRatio > 1.2
          ? 'defensive positioning'
          : s.putCallOIRatio < 0.8
          ? 'call-heavy positioning'
          : 'balanced positioning'
      );
    } else {
      K.setText('dvPcOi', 'n/a');
      K.setText('dvPcOiNote', 'call open interest not published on this feed');
    }

    if (s.putCallVolumeRatio !== null && s.putCallVolumeRatio !== undefined) {
      K.setText('dvPcVol', s.putCallVolumeRatio.toFixed(2));
    } else {
      K.setText('dvPcVol', 'n/a');
    }

    // Max pain needs both sides to mean anything — with puts alone it
    // would just point at the lowest strike.
    var mp = hasCallOI && active.length ? maxPain(active) : null;
    if (mp) {
      K.setText('dvMaxPain', K.fmtNumber(mp.strike));
      if (u.price) {
        var dist = ((mp.strike - u.price) / u.price) * 100;
        K.setText('dvMaxPainNote', K.fmtPercent(dist) + ' from spot');
      }
    } else {
      K.setText('dvMaxPain', 'n/a');
      K.setText('dvMaxPainNote', 'needs call and put open interest');
    }

    K.setText('dvDte', u.daysToExpiry !== null && u.daysToExpiry !== undefined ? u.daysToExpiry + ' days' : '—');
    if (u.price) {
      K.setText('dvUnderlying', 'spot ' + K.fmtNumber(u.price));
    }

    // ---- open interest chart --------------------------------------------
    var chartEl = document.getElementById('dvOiChart');
    if (active.length) {
      // Center the view on strikes near spot so the walls that matter show.
      var sorted = active.slice().sort(function (a, b) {
        return Math.abs(a.strike - (u.price || 0)) - Math.abs(b.strike - (u.price || 0));
      });
      var near = sorted.slice(0, 21).sort(function (a, b) { return a.strike - b.strike; });

      var maxOi = 0;
      near.forEach(function (r) {
        maxOi = Math.max(maxOi, r.call ? r.call.openInterest || 0 : 0, r.put ? r.put.openInterest || 0 : 0);
      });

      var rowsHtml = near.map(function (r) {
        var callOi = r.call ? r.call.openInterest || 0 : 0;
        var putOi = r.put ? r.put.openInterest || 0 : 0;
        var isSpot = u.price && Math.abs(r.strike - u.price) ===
          Math.min.apply(null, near.map(function (x) { return Math.abs(x.strike - u.price); }));

        // Without call OI a mirrored layout would be half empty, so fall
        // back to a single-sided bar chart of put open interest.
        if (!hasCallOI) {
          return '<div class="dv-oi-row single' + (isSpot ? ' spot' : '') + '">' +
            '<div class="dv-oi-strike">' + K.fmtNumber(r.strike, 1) + '</div>' +
            '<div class="dv-oi-side right"><span class="dv-oi-bar put" style="width:' +
              (maxOi ? (putOi / maxOi) * 100 : 0) + '%"></span>' +
              '<span class="dv-oi-num">' + (putOi ? fmtOi(putOi) : '') + '</span></div>' +
            '</div>';
        }

        return '<div class="dv-oi-row' + (isSpot ? ' spot' : '') + '">' +
          '<div class="dv-oi-side left"><span class="dv-oi-bar call" style="width:' +
            (maxOi ? (callOi / maxOi) * 100 : 0) + '%"></span>' +
            '<span class="dv-oi-num">' + (callOi ? fmtOi(callOi) : '') + '</span></div>' +
          '<div class="dv-oi-strike">' + K.fmtNumber(r.strike, 1) + '</div>' +
          '<div class="dv-oi-side right"><span class="dv-oi-bar put" style="width:' +
            (maxOi ? (putOi / maxOi) * 100 : 0) + '%"></span>' +
            '<span class="dv-oi-num">' + (putOi ? fmtOi(putOi) : '') + '</span></div>' +
          '</div>';
      }).join('');
      chartEl.innerHTML = rowsHtml;

      // Keep the legend honest about which series is actually drawn.
      var legend = document.querySelector('.dv-oi-legend');
      if (legend && !hasCallOI) {
        legend.innerHTML = '<span><i class="dot down"></i> Put OI</span>' +
          '<span><i class="dot spot"></i> Nearest spot</span>';
      }
    } else {
      chartEl.innerHTML = '<p class="ds-range-note">No open interest reported for this expiry.</p>';
    }

    // ---- option chain table ---------------------------------------------
    var chainBody = document.getElementById('dvChainBody');
    if (active.length) {
      var nearChain = active.slice().sort(function (a, b) {
        return Math.abs(a.strike - (u.price || 0)) - Math.abs(b.strike - (u.price || 0));
      }).slice(0, 15).sort(function (a, b) { return b.strike - a.strike; });

      chainBody.innerHTML = nearChain.map(function (r) {
        var c = r.call || {};
        var p = r.put || {};
        var atm = u.price && Math.abs(r.strike - u.price) <= 2.5;
        return '<tr' + (atm ? ' class="dv-atm"' : '') + '>' +
          '<td>' + fmtOi(c.openInterest) + '</td>' +
          '<td>' + fmtOi(c.volume) + '</td>' +
          '<td>' + (c.iv ? c.iv.toFixed(1) + '%' : '—') + '</td>' +
          '<td>' + (c.price !== null && c.price !== undefined ? K.fmtNumber(c.price) : '—') + '</td>' +
          '<td class="dv-strike">' + K.fmtNumber(r.strike, 1) + '</td>' +
          '<td>' + (p.price !== null && p.price !== undefined ? K.fmtNumber(p.price) : '—') + '</td>' +
          '<td>' + (p.iv ? p.iv.toFixed(1) + '%' : '—') + '</td>' +
          '<td>' + fmtOi(p.volume) + '</td>' +
          '<td>' + fmtOi(p.openInterest) + '</td>' +
          '</tr>';
      }).join('');
    } else {
      chainBody.innerHTML = '<tr><td colspan="9">No chain data</td></tr>';
    }

    // ---- volatility skew --------------------------------------------------
    var skewEl = document.getElementById('dvSkew');
    var skewPoints = active
      .filter(function (r) { return (r.call && r.call.iv) || (r.put && r.put.iv); })
      .sort(function (a, b) { return a.strike - b.strike; });

    if (skewPoints.length > 2 && u.price) {
      var ivs = skewPoints.map(function (r) {
        // Use OTM side on each wing — that's where the traded market lives.
        var iv = r.strike < u.price
          ? (r.put && r.put.iv) || (r.call && r.call.iv)
          : (r.call && r.call.iv) || (r.put && r.put.iv);
        return { strike: r.strike, iv: iv };
      }).filter(function (x) { return x.iv; });

      var minIv = Math.min.apply(null, ivs.map(function (x) { return x.iv; }));
      var maxIv = Math.max.apply(null, ivs.map(function (x) { return x.iv; }));
      var range = maxIv - minIv || 1;

      skewEl.innerHTML = '<div class="dv-skew-bars">' + ivs.map(function (x) {
        var h = ((x.iv - minIv) / range) * 100;
        var side = x.strike < u.price ? 'put-side' : 'call-side';
        return '<div class="dv-skew-col ' + side + '" title="' + K.fmtNumber(x.strike, 1) +
          ' · IV ' + x.iv.toFixed(1) + '%">' +
          '<span class="dv-skew-bar" style="height:' + Math.max(h, 4) + '%"></span>' +
          '</div>';
      }).join('') + '</div>';

      // Compare average OTM put IV against average OTM call IV.
      var putSide = ivs.filter(function (x) { return x.strike < u.price; });
      var callSide = ivs.filter(function (x) { return x.strike > u.price; });
      if (putSide.length && callSide.length) {
        var avgPut = putSide.reduce(function (a, x) { return a + x.iv; }, 0) / putSide.length;
        var avgCall = callSide.reduce(function (a, x) { return a + x.iv; }, 0) / callSide.length;
        var skewGap = avgPut - avgCall;
        K.setText(
          'dvSkewNote',
          skewGap > 3
            ? 'Downside strikes carry ' + skewGap.toFixed(1) + ' points more implied volatility than upside — the market is paying up for protection.'
            : skewGap < -3
            ? 'Upside strikes carry ' + Math.abs(skewGap).toFixed(1) + ' points more implied volatility than downside — unusual, and often seen in melt-up conditions.'
            : 'Skew is relatively flat — no strong directional bid for protection on either side.'
        );
      }
    } else {
      skewEl.innerHTML = '<p class="ds-range-note">Not enough quoted volatility to plot a skew.</p>';
    }

    // ---- aside tables -----------------------------------------------------
    K.setText('dvCallOi', hasCallOI ? fmtOi(s.callOpenInterest) : 'n/a');
    K.setText('dvPutOi', fmtOi(s.putOpenInterest));
    K.setText(
      'dvPeakCall',
      s.maxCallOI ? K.fmtNumber(s.maxCallOI.strike, 1) + ' · ' + fmtOi(s.maxCallOI.oi) : 'n/a'
    );
    if (s.maxPutOI) K.setText('dvPeakPut', K.fmtNumber(s.maxPutOI.strike, 1) + ' · ' + fmtOi(s.maxPutOI.oi));

    K.setText('dvCallIv', u.callIv ? u.callIv.toFixed(2) + '%' : '—');
    K.setText('dvPutIv', u.putIv ? u.putIv.toFixed(2) + '%' : '—');
    K.setText('dvAvgIv', s.averageIv ? s.averageIv.toFixed(2) + '%' : '—');
    K.setText('dvHistVol', u.histVol ? u.histVol.toFixed(2) + '%' : '—');

    // Say plainly how far the call-side data reaches.
    var covEl = document.getElementById('dvCoverage');
    if (covEl) {
      covEl.textContent = hasCallOI
        ? 'Puts come from the full option board (' + (s.strikeCount || 0) +
          ' strikes). Calls are quoted individually, so the call side — and the ' +
          'put/call ratio and max pain derived from it — covers the ' +
          (cov.callStrikesCovered || cov.callsPriced || 0) +
          ' strikes nearest spot, where almost all activity sits.'
        : 'Call-side quotes are unavailable right now, so figures that need both ' +
          'sides — put/call ratio on open interest, and max pain — are marked n/a ' +
          'rather than computed from puts alone.';
    }

    K.setText(
      'dvAsOf',
      'Data as of ' + K.formatTimestamp(new Date()) +
        ' — source: LS Securities Open API · ' + (s.strikeCount || 0) + ' strikes on the board'
    );
  }).catch(function () {
    K.setText('dvAsOf', 'Live data unavailable');
  });
})();
