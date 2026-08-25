(function () {
  var K = window.KF;

  function fmtOi(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(n).toLocaleString('en-US');
  }

  function fmtSession(ymd) {
    var s = String(ymd || '');
    if (s.length !== 8) return s;
    return K.formatDateLong(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8));
  }

  K.fetchJSON('/api/krx?include=index,options').then(function (data) {
    if (data.error) {
      K.setText('dvAsOf', 'Live data unavailable');
      return;
    }

    var idx = data.index || {};
    var opt = data.options;
    if (!opt) {
      K.setText('dvAsOf', 'No option data published for this session.');
      return;
    }

    var s = opt.summary || {};
    var chain = opt.chain || [];
    var spot = idx.close;

    // ---- headline stats -------------------------------------------------
    if (s.putCallOIRatio !== null && s.putCallOIRatio !== undefined) {
      K.setText('dvPcOi', s.putCallOIRatio.toFixed(2));
      K.setText(
        'dvPcOiNote',
        s.putCallOIRatio > 1.2
          ? 'defensive positioning'
          : s.putCallOIRatio < 0.8
          ? 'call-heavy positioning'
          : 'balanced positioning'
      );
    }

    if (s.putCallVolumeRatio !== null && s.putCallVolumeRatio !== undefined) {
      K.setText('dvPcVol', s.putCallVolumeRatio.toFixed(2));
    }

    if (s.maxPain !== null && s.maxPain !== undefined) {
      K.setText('dvMaxPain', K.fmtNumber(s.maxPain));
      if (spot) {
        var dist = ((s.maxPain - spot) / spot) * 100;
        K.setText('dvMaxPainNote', K.fmtPercent(dist) + ' from spot');
      }
    }

    K.setText('dvDte', opt.daysToExpiry !== null && opt.daysToExpiry !== undefined ? opt.daysToExpiry + ' days' : '—');
    if (spot) {
      K.setText('dvUnderlying', 'spot ' + K.fmtNumber(spot) + ' at close');
    }

    // ---- open interest chart --------------------------------------------
    var chartEl = document.getElementById('dvOiChart');
    if (chain.length) {
      // Center the view on strikes near spot so the walls that matter show,
      // in descending order to match the chain table beneath it.
      var near = chain.slice()
        .sort(function (a, b) { return Math.abs(a.strike - (spot || 0)) - Math.abs(b.strike - (spot || 0)); })
        .slice(0, 21)
        .sort(function (a, b) { return b.strike - a.strike; });

      var maxOi = 0;
      near.forEach(function (r) {
        maxOi = Math.max(maxOi, r.call ? r.call.openInterest || 0 : 0, r.put ? r.put.openInterest || 0 : 0);
      });

      chartEl.innerHTML = near.map(function (r) {
        var callOi = r.call ? r.call.openInterest || 0 : 0;
        var putOi = r.put ? r.put.openInterest || 0 : 0;
        var isSpot = spot && Math.abs(r.strike - spot) ===
          Math.min.apply(null, near.map(function (x) { return Math.abs(x.strike - spot); }));
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
    } else {
      chartEl.innerHTML = '<p class="ds-range-note">No open interest reported for this expiry.</p>';
    }

    // ---- option chain table ---------------------------------------------
    var chainBody = document.getElementById('dvChainBody');
    if (chain.length) {
      var nearChain = chain.slice()
        .sort(function (a, b) { return Math.abs(a.strike - (spot || 0)) - Math.abs(b.strike - (spot || 0)); })
        .slice(0, 15)
        .sort(function (a, b) { return b.strike - a.strike; });

      chainBody.innerHTML = nearChain.map(function (r) {
        var c = r.call || {};
        var p = r.put || {};
        var atm = spot && Math.abs(r.strike - spot) <= 2.5;
        return '<tr' + (atm ? ' class="dv-atm"' : '') + '>' +
          '<td>' + fmtOi(c.openInterest) + '</td>' +
          '<td>' + fmtOi(c.volume) + '</td>' +
          '<td>' + (c.iv ? c.iv.toFixed(1) + '%' : '—') + '</td>' +
          '<td>' + (c.close !== null && c.close !== undefined ? K.fmtNumber(c.close) : '—') + '</td>' +
          '<td class="dv-strike">' + K.fmtNumber(r.strike, 1) + '</td>' +
          '<td>' + (p.close !== null && p.close !== undefined ? K.fmtNumber(p.close) : '—') + '</td>' +
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
    var skewPoints = chain
      .filter(function (r) { return (r.call && r.call.iv) || (r.put && r.put.iv); })
      .sort(function (a, b) { return a.strike - b.strike; });

    if (skewPoints.length > 2 && spot) {
      var ivs = skewPoints.map(function (r) {
        // Use the OTM side on each wing — that's where the traded market lives.
        var iv = r.strike < spot
          ? (r.put && r.put.iv) || (r.call && r.call.iv)
          : (r.call && r.call.iv) || (r.put && r.put.iv);
        return { strike: r.strike, iv: iv };
      }).filter(function (x) { return x.iv; });

      var minIv = Math.min.apply(null, ivs.map(function (x) { return x.iv; }));
      var maxIv = Math.max.apply(null, ivs.map(function (x) { return x.iv; }));
      var range = maxIv - minIv || 1;

      skewEl.innerHTML = '<div class="dv-skew-bars">' + ivs.map(function (x) {
        var h = ((x.iv - minIv) / range) * 100;
        var side = x.strike < spot ? 'put-side' : 'call-side';
        return '<div class="dv-skew-col ' + side + '" title="' + K.fmtNumber(x.strike, 1) +
          ' · IV ' + x.iv.toFixed(1) + '%">' +
          '<span class="dv-skew-bar" style="height:' + Math.max(h, 4) + '%"></span>' +
          '</div>';
      }).join('') + '</div>';

      var putSide = ivs.filter(function (x) { return x.strike < spot; });
      var callSide = ivs.filter(function (x) { return x.strike > spot; });
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
    K.setText('dvCallOi', fmtOi(s.callOpenInterest));
    K.setText('dvPutOi', fmtOi(s.putOpenInterest));
    K.setText('dvPeakCall', s.maxCallOI ? K.fmtNumber(s.maxCallOI.strike, 1) + ' · ' + fmtOi(s.maxCallOI.oi) : '—');
    K.setText('dvPeakPut', s.maxPutOI ? K.fmtNumber(s.maxPutOI.strike, 1) + ' · ' + fmtOi(s.maxPutOI.oi) : '—');

    K.setText('dvCallIv', s.callIv ? s.callIv.toFixed(2) + '%' : '—');
    K.setText('dvPutIv', s.putIv ? s.putIv.toFixed(2) + '%' : '—');
    K.setText('dvAvgIv', s.averageIv ? s.averageIv.toFixed(2) + '%' : '—');
    K.setText('dvHistVol', s.atmIv ? s.atmIv.toFixed(2) + '% (ATM)' : '—');

    var covEl = document.getElementById('dvCoverage');
    if (covEl) {
      covEl.textContent =
        'This board is the ' + fmtSession(data.session) + ' close, published by the exchange the ' +
        'next morning — not a live quote. Both sides of the ' + (s.strikeCount || 0) +
        '-strike chain, including open interest, come from the same KRX Open API feed.';
    }

    K.setText('dvAsOf', fmtSession(data.session) + ' session close · source: KRX Open API');
  }).catch(function () {
    K.setText('dvAsOf', 'Live data unavailable');
  });
})();
