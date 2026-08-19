(function () {
  var K = window.KF;
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pct(up, down) {
    var total = up + down;
    if (!total) return '—';
    return ((up / total) * 100).toFixed(1) + '%';
  }

  K.fetchJSON('/api/history?symbol=069500.KS&range=10y').then(function (data) {
    var rows = data.rows || [];
    if (rows.length < 2) {
      K.setText('wrRangeNote', 'Data unavailable');
      return;
    }

    var weekday = {}, month = {};
    WEEKDAYS.forEach(function (d) { weekday[d] = { up: 0, down: 0 }; });
    MONTHS.forEach(function (m) { month[m] = { up: 0, down: 0 }; });

    var totalUp = 0, totalDown = 0;

    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var p = rows[i - 1];
      var isUp = r.close > p.close;
      var isDown = r.close < p.close;
      if (!isUp && !isDown) continue;

      var d = new Date(r.date + 'T00:00:00Z');
      var wd = WEEKDAYS[d.getUTCDay()];
      var mo = MONTHS[d.getUTCMonth()];

      if (isUp) { weekday[wd].up++; month[mo].up++; totalUp++; }
      else { weekday[wd].down++; month[mo].down++; totalDown++; }
    }

    K.setText('wrOverall', pct(totalUp, totalDown) + ' of days closed up (' + totalUp + ' up / ' + totalDown + ' down)');

    var wdBody = document.getElementById('wrWeekdayBody');
    var wdHtml = '';
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(function (d) {
      var s = weekday[d];
      wdHtml += '<tr><td>' + d + '</td><td>' + s.up + '</td><td>' + s.down + '</td><td>' + pct(s.up, s.down) + '</td></tr>';
    });
    wdBody.innerHTML = wdHtml;

    var moBody = document.getElementById('wrMonthBody');
    var moHtml = '';
    MONTHS.forEach(function (m) {
      var s = month[m];
      moHtml += '<tr><td>' + m + '</td><td>' + s.up + '</td><td>' + s.down + '</td><td>' + pct(s.up, s.down) + '</td></tr>';
    });
    moBody.innerHTML = moHtml;

    K.setText('wrRangeNote', 'KOSPI 200 itself has a gap in its daily history on our data source, so this is computed from KODEX 200 (069500.KS), an ETF that tracks the index almost 1:1 — ' +
      rows.length + ' daily closes, ' + K.formatDateLong(rows[0].date) + ' – ' +
      K.formatDateLong(rows[rows.length - 1].date) + ' (source: Yahoo Finance).');
  }).catch(function () {
    K.setText('wrRangeNote', 'Live data unavailable');
  });
})();
