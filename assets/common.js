window.KF = (function () {
  function fmtNumber(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    digits = digits === undefined ? 2 : digits;
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtChange(change, digits) {
    if (change === null || change === undefined || isNaN(change)) return '—';
    var sign = change > 0 ? '+' : '';
    return sign + fmtNumber(change, digits);
  }

  function fmtPercent(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '—';
    var sign = pct > 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  function fmtVolume(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setChangeClass(id, change) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('up', 'down');
    if (change > 0) el.classList.add('up');
    else if (change < 0) el.classList.add('down');
  }

  function formatTimestamp(date) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'short', day: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    var map = {};
    parts.forEach(function (p) { map[p.type] = p.value; });
    return map.month + '/' + map.day + '/' + map.year + ' ' + map.hour + ':' + map.minute + ':' + map.second + ' KST';
  }

  function formatDateLong(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(d);
  }

  function fetchJSON(url) {
    return fetch(url).then(function (res) { return res.json(); });
  }

  return { fmtNumber, fmtChange, fmtPercent, fmtVolume, setText, setChangeClass, formatTimestamp, formatDateLong, fetchJSON };
})();
