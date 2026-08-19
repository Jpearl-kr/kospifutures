(function () {
  var K = window.KF;

  K.fetchJSON('/api/history?symbol=069500.KS&range=3mo').then(function (data) {
    var rows = data.rows || [];
    if (rows.length < 2) {
      K.setText('dsDateHeading', 'Data unavailable');
      K.setText('dsAsOf', 'Live data unavailable');
      return;
    }

    var today = rows[rows.length - 1];
    var prev = rows[rows.length - 2];
    var change = today.close - prev.close;
    var changePct = (change / prev.close) * 100;

    K.setText('dsDateHeading', 'KODEX 200 ETF — ' + K.formatDateLong(today.date));
    K.setText('dsOpen', K.fmtNumber(today.open));
    K.setText('dsHigh', K.fmtNumber(today.high));
    K.setText('dsLow', K.fmtNumber(today.low));
    K.setText('dsClose', K.fmtNumber(today.close));
    K.setText('dsChange', K.fmtChange(change) + ' (' + K.fmtPercent(changePct) + ')');
    K.setChangeClass('dsChange', change);
    K.setText('dsVolume', K.fmtVolume(today.volume));
    K.setText('dsAsOf', 'KOSPI 200 itself has a gap in its daily history on our data source, so this page uses KODEX 200 (069500.KS), an ETF that tracks the index almost 1:1. Data as of ' +
      K.formatTimestamp(new Date()) + ' — source: Yahoo Finance');

    var recent = rows.slice(-6).reverse(); // last 5 days + the one before, for change calc
    var body = document.getElementById('dsRecentBody');
    var html = '';
    for (var i = 0; i < recent.length - 1 && i < 5; i++) {
      var r = recent[i];
      var p = recent[i + 1];
      var c = r.close - p.close;
      var cls = c > 0 ? 'up' : c < 0 ? 'down' : '';
      html += '<tr><td>' + r.date + '</td><td>' + K.fmtNumber(r.open) + '</td><td>' +
        K.fmtNumber(r.high) + '</td><td>' + K.fmtNumber(r.low) + '</td><td>' + K.fmtNumber(r.close) +
        '</td><td class="' + cls + '">' + K.fmtPercent((c / p.close) * 100) + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="6">Not enough data</td></tr>';
  }).catch(function () {
    K.setText('dsDateHeading', 'Data unavailable');
    K.setText('dsAsOf', 'Live data unavailable');
  });
})();
