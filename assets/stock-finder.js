(function () {
  var K = window.KF;
  var form = document.getElementById('sfForm');
  var input = document.getElementById('sfQuery');
  var resultsEl = document.getElementById('sfResults');
  var card = document.getElementById('sfQuoteCard');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value.trim();
    if (q.length < 2) return;
    resultsEl.innerHTML = '<li>Searching…</li>';
    card.style.display = 'none';

    K.fetchJSON('/api/search?q=' + encodeURIComponent(q)).then(function (data) {
      var results = data.results || [];
      if (!results.length) {
        resultsEl.innerHTML = '<li>No matches found.</li>';
        return;
      }
      resultsEl.innerHTML = '';
      results.forEach(function (r) {
        var li = document.createElement('li');
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'search-result-btn';
        btn.textContent = r.name + ' (' + r.symbol + ') — ' + (r.exchange || '');
        btn.addEventListener('click', function () { showQuote(r.symbol, r.name); });
        li.appendChild(btn);
        resultsEl.appendChild(li);
      });
    }).catch(function () {
      resultsEl.innerHTML = '<li>Search failed — try again.</li>';
    });
  });

  function showQuote(symbol, name) {
    document.getElementById('sfQuoteName').textContent = 'Loading…';
    card.style.display = 'block';

    K.fetchJSON('/api/quote?symbol=' + encodeURIComponent(symbol)).then(function (q) {
      if (q.error) {
        document.getElementById('sfQuoteName').textContent = 'Could not load quote for ' + symbol;
        return;
      }
      document.getElementById('sfQuoteName').textContent = (q.longName || name) + ' (' + q.symbol + ')';
      K.setText('sfQuotePrice', K.fmtNumber(q.price) + (q.currency ? ' ' + q.currency : ''));
      K.setText('sfQuoteChange', K.fmtChange(q.change) + ' (' + K.fmtPercent(q.changePercent) + ')');
      K.setChangeClass('sfQuoteChange', q.change);
      K.setText('sfQuoteDayRange', K.fmtNumber(q.dayLow) + ' – ' + K.fmtNumber(q.dayHigh));
      K.setText('sfQuoteWeekRange', K.fmtNumber(q.weekLow52) + ' – ' + K.fmtNumber(q.weekHigh52));
      K.setText('sfQuoteVolume', K.fmtVolume(q.volume));
    }).catch(function () {
      document.getElementById('sfQuoteName').textContent = 'Could not load quote for ' + symbol;
    });
  }
})();
