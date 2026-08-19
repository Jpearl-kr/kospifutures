(function () {
  var K = window.KF;
  var allRows = [];

  K.fetchJSON('/api/history?symbol=069500.KS&range=1y').then(function (data) {
    allRows = data.rows || [];
    if (!allRows.length) {
      document.getElementById('histTableBody').innerHTML = '<tr><td colspan="7">Data unavailable</td></tr>';
      K.setText('histAsOf', 'Live data unavailable');
      return;
    }

    var recent = allRows.slice(-61).reverse(); // last 60 days + one prior for change calc
    var body = document.getElementById('histTableBody');
    var html = '';
    for (var i = 0; i < recent.length - 1 && i < 60; i++) {
      var r = recent[i];
      var p = recent[i + 1];
      var c = r.close - p.close;
      var cls = c > 0 ? 'up' : c < 0 ? 'down' : '';
      html += '<tr><td>' + r.date + '</td><td>' + K.fmtNumber(r.open) + '</td><td>' +
        K.fmtNumber(r.high) + '</td><td>' + K.fmtNumber(r.low) + '</td><td>' + K.fmtNumber(r.close) +
        '</td><td class="' + cls + '">' + K.fmtPercent((c / p.close) * 100) + '</td><td>' +
        K.fmtVolume(r.volume) + '</td></tr>';
    }
    body.innerHTML = html || '<tr><td colspan="7">Not enough data</td></tr>';
    K.setText('histAsOf', 'KOSPI 200 itself has a gap in its daily history on our data source, so this table uses KODEX 200 (069500.KS), an ETF that tracks the index almost 1:1. Showing ' +
      (recent.length - 1) + ' of ' + allRows.length + ' trading days available · Data as of ' +
      K.formatTimestamp(new Date()) + ' — source: Yahoo Finance');
  }).catch(function () {
    document.getElementById('histTableBody').innerHTML = '<tr><td colspan="7">Data unavailable</td></tr>';
    K.setText('histAsOf', 'Live data unavailable');
  });

  document.getElementById('histDownloadBtn').addEventListener('click', function () {
    if (!allRows.length) return;
    var lines = ['Date,Open,High,Low,Close,Volume'];
    allRows.forEach(function (r) {
      lines.push([r.date, r.open, r.high, r.low, r.close, r.volume].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'kospi200-historical.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
})();
