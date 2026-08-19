(function () {
  var K = window.KF;

  K.fetchJSON('/api/history?symbol=069500.KS&range=10y').then(function (data) {
    var rows = data.rows || [];
    if (rows.length < 2) {
      K.setText('recRangeNote', 'Data unavailable');
      return;
    }

    var high = rows[0], low = rows[0], gain = null, loss = null, vol = rows[0];
    var gainPct = -Infinity, lossPct = Infinity;

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var p = rows[i - 1];
      if (r.close > high.close) high = r;
      if (r.close < low.close) low = r;
      if (r.volume > vol.volume) vol = r;
      var pct = ((r.close - p.close) / p.close) * 100;
      if (pct > gainPct) { gainPct = pct; gain = r; }
      if (pct < lossPct) { lossPct = pct; loss = r; }
    }

    K.setText('recHighValue', K.fmtNumber(high.close) + ' KRW');
    K.setText('recHighDate', K.formatDateLong(high.date));
    K.setText('recLowValue', K.fmtNumber(low.close) + ' KRW');
    K.setText('recLowDate', K.formatDateLong(low.date));
    K.setText('recGainValue', K.fmtPercent(gainPct));
    K.setText('recGainDate', K.formatDateLong(gain.date));
    K.setText('recLossValue', K.fmtPercent(lossPct));
    K.setText('recLossDate', K.formatDateLong(loss.date));
    K.setText('recVolValue', K.fmtVolume(vol.volume));
    K.setText('recVolDate', K.formatDateLong(vol.date));

    K.setText('recRangeNote', 'KOSPI 200 itself has a gap in its daily history on our data source, so these records are computed from KODEX 200 (069500.KS), an ETF that tracks the index almost 1:1 — ' +
      rows.length + ' daily closes, ' + K.formatDateLong(rows[0].date) + ' – ' +
      K.formatDateLong(rows[rows.length - 1].date) +
      ' (source: Yahoo Finance). Note: extreme single-day % moves in an ETF series can reflect a distribution or price adjustment rather than an actual market move.');
  }).catch(function () {
    K.setText('recRangeNote', 'Live data unavailable');
  });
})();
