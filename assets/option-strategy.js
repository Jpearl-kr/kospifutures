(function () {
  var K = window.KF;

  // How many strikes to show either side of the money.
  var WINGS = 20;

  var board = null;      // parsed option-board.json
  var byStrike = {};     // strike -> board row, for looking up the last price
  var legs = [];         // [{ type:'C'|'P', strike, side:1|-1, qty, price }]
  var crossS = null;     // underlying level the crosshair is pinned to
  var canvas, ctx;

  function fmtPts(v) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    return v.toFixed(2);
  }

  function fmtKrw(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    return Math.round(v).toLocaleString('en-US');
  }

  function fmtCompact(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return String(Math.round(v));
  }

  function contractName(leg) {
    return leg.type + ' ' + board.expiry.slice(2) + ' ' + K.fmtNumber(leg.strike, 1);
  }

  // ---- payoff model ----------------------------------------------------
  // Each leg settles to its intrinsic value at expiry; the entry premium is
  // sunk either way. KOSPI 200 options are 250,000 KRW per index point.
  function intrinsic(leg, S) {
    return leg.type === 'C' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  }

  function payoffAt(S) {
    var mult = board.multiplier;
    var total = 0;
    for (var i = 0; i < legs.length; i++) {
      var leg = legs[i];
      total += leg.side * leg.qty * mult * (intrinsic(leg, S) - leg.price);
    }
    return total;
  }

  function netPremium() {
    var mult = board.multiplier;
    var total = 0;
    for (var i = 0; i < legs.length; i++) {
      // Buying pays the premium out, selling takes it in.
      total += -legs[i].side * legs[i].qty * mult * legs[i].price;
    }
    return total;
  }

  // Payoff is piecewise linear with kinks only at the strikes, so evaluating
  // the strikes plus the range ends is exact — no sampling error.
  //
  // The domain is the plotted range, not [0, ∞). Evaluating down to zero
  // would report "max profit" from a long put at an index level of 0 —
  // arithmetically true, financially meaningless, and it buries the numbers
  // that matter under a figure hundreds of times larger.
  function kinkPoints() {
    var r = chartRange();
    var pts = [r.lo, r.hi];
    for (var i = 0; i < legs.length; i++) {
      if (legs[i].strike > r.lo && legs[i].strike < r.hi) pts.push(legs[i].strike);
    }
    pts.sort(function (a, b) { return a - b; });
    return pts.filter(function (v, i, arr) { return i === 0 || v !== arr[i - 1]; });
  }

  // Slope beyond the highest strike: only calls still have delta up there.
  function rightSlope() {
    var mult = board.multiplier;
    var s = 0;
    for (var i = 0; i < legs.length; i++) {
      if (legs[i].type === 'C') s += legs[i].side * legs[i].qty * mult;
    }
    return s;
  }

  function chartRange() {
    var U = board.underlying || 1000;
    if (!legs.length) return { lo: U * 0.92, hi: U * 1.08 };
    var lo = U, hi = U;
    for (var i = 0; i < legs.length; i++) {
      lo = Math.min(lo, legs[i].strike);
      hi = Math.max(hi, legs[i].strike);
    }
    var span = Math.max(hi - lo, U * 0.06);
    return { lo: lo - span * 0.35, hi: hi + span * 0.35 };
  }

  // ---- board -----------------------------------------------------------
  function renderBoard() {
    var body = document.getElementById('sbBoardBody');
    var rows = board.strikes;
    var U = board.underlying;

    // Centre the ladder on the strike closest to the underlying.
    var atmIdx = 0, best = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var d = Math.abs(rows[i].k - U);
      if (d < best) { best = d; atmIdx = i; }
    }
    var from = Math.max(0, atmIdx - WINGS);
    var to = Math.min(rows.length, atmIdx + WINGS + 1);
    var view = rows.slice(from, to);

    var html = view.map(function (r) {
      var isAtm = r.k === rows[atmIdx].k;
      // The ladder steps in 2.5s; shading every 5 points keeps it readable.
      var band = (r.k % 5 === 0) ? ' sb-band' : '';
      function cell(side, field, val) {
        if (val === null || val === undefined) return '<td class="sb-dead">—</td>';
        return '<td class="sb-price" data-k="' + r.k + '" data-t="' + side +
          '" data-p="' + val + '" title="Add ' + (side === 'C' ? 'call' : 'put') +
          ' ' + r.k + ' at ' + val + '" tabindex="0" role="button">' + fmtPts(val) + '</td>';
      }
      return '<tr class="' + (isAtm ? 'sb-atm' : '') + band + '">' +
        cell('C', 'cb', r.cb) + cell('C', 'cc', r.cc) + cell('C', 'ca', r.ca) +
        '<td class="sb-strike">' + K.fmtNumber(r.k, 1) + '</td>' +
        cell('P', 'pb', r.pb) + cell('P', 'pc', r.pc) + cell('P', 'pa', r.pa) +
        '</tr>';
    }).join('');

    body.innerHTML = html || '<tr><td colspan="7">No strikes in range</td></tr>';

    // Bring the money into view rather than starting at the top wing.
    var scroller = document.getElementById('sbBoardScroll');
    var atmRow = body.querySelector('.sb-atm');
    if (scroller && atmRow) {
      scroller.scrollTop = atmRow.offsetTop - scroller.clientHeight / 2 + atmRow.offsetHeight / 2;
    }
  }

  function addLeg(type, strike, price) {
    for (var i = 0; i < legs.length; i++) {
      // Same contract twice reads as size, not as a second row.
      if (legs[i].type === type && legs[i].strike === strike) {
        legs[i].qty += 1;
        refresh();
        return;
      }
    }
    legs.push({ type: type, strike: strike, side: 1, qty: 1, price: price });
    refresh();
  }

  // ---- positions -------------------------------------------------------
  function renderPositions() {
    var body = document.getElementById('sbPosBody');
    if (!legs.length) {
      body.innerHTML = '<tr><td colspan="6" class="sb-empty">No legs yet — click a price on the board.</td></tr>';
      return;
    }

    body.innerHTML = legs.map(function (leg, i) {
      var row = byStrike[leg.strike] || {};
      var last = leg.type === 'C' ? row.cc : row.pc;
      return '<tr>' +
        '<td class="sb-contract">' + contractName(leg) + '</td>' +
        '<td><button type="button" class="sb-side ' + (leg.side === 1 ? 'buy' : 'sell') +
          '" data-i="' + i + '">' + (leg.side === 1 ? 'Buy' : 'Sell') + '</button></td>' +
        '<td><input class="sb-qty" type="number" min="1" step="1" value="' + leg.qty + '" data-i="' + i + '" aria-label="Quantity"></td>' +
        '<td><input class="sb-entry" type="number" min="0" step="0.01" value="' + leg.price + '" data-i="' + i + '" aria-label="Entry price"></td>' +
        '<td>' + (last === null || last === undefined ? '—' : fmtPts(last)) + '</td>' +
        '<td><button type="button" class="sb-remove" data-i="' + i + '" aria-label="Remove leg">&times;</button></td>' +
        '</tr>';
    }).join('');
  }

  // ---- summary ---------------------------------------------------------
  function renderSummary() {
    if (!legs.length) {
      ['sbNet', 'sbMaxProfit', 'sbMaxLoss', 'sbBreakeven'].forEach(function (id) {
        K.setText(id, '—');
      });
      return;
    }

    var net = netPremium();
    K.setText('sbNet', fmtKrw(net) + ' KRW ' + (net >= 0 ? '(credit)' : '(debit)'));

    var pts = kinkPoints();
    var vals = pts.map(payoffAt);
    var maxV = Math.max.apply(null, vals);
    var minV = Math.min.apply(null, vals);
    var slope = rightSlope();

    // Above the top strike the payoff keeps running in the direction of the
    // net call delta, so one side is genuinely unbounded.
    K.setText('sbMaxProfit', slope > 0 ? 'Unlimited' : fmtKrw(maxV) + ' KRW');
    K.setText('sbMaxLoss', slope < 0 ? 'Unlimited' : fmtKrw(minV) + ' KRW');

    var bes = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var a = vals[i], b = vals[i + 1];
      if (a === 0) bes.push(pts[i]);
      else if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
        bes.push(pts[i] + (pts[i + 1] - pts[i]) * (-a / (b - a)));
      }
    }
    K.setText('sbBreakeven', bes.length
      ? bes.map(function (v) { return K.fmtNumber(v, 2); }).join('  ·  ')
      : 'None in range');
  }

  // ---- chart -----------------------------------------------------------
  function themeColors() {
    var cs = getComputedStyle(document.body);
    return {
      text: cs.getPropertyValue('--text').trim() || '#1a1f2b',
      muted: cs.getPropertyValue('--text-muted').trim() || '#5a6472',
      border: cs.getPropertyValue('--border').trim() || '#dfe3e8',
      green: cs.getPropertyValue('--green').trim() || '#16a34a',
      red: cs.getPropertyValue('--red').trim() || '#d92d20',
      primary: cs.getPropertyValue('--primary').trim() || '#0b3d91',
    };
  }

  function sizeCanvas() {
    var wrap = canvas.parentElement;
    var w = wrap.clientWidth;
    var h = 320;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w: w, h: h };
  }

  function niceTicks(lo, hi, count) {
    var span = hi - lo;
    if (span <= 0) return [lo];
    var raw = span / count;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    var out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }

  function drawChart() {
    if (!canvas || !ctx || !board) return;
    var size = sizeCanvas();
    var c = themeColors();
    var W = size.w, H = size.h;
    var m = { l: 64, r: 14, t: 14, b: 30 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;

    ctx.clearRect(0, 0, W, H);

    if (!legs.length) {
      ctx.fillStyle = c.muted;
      ctx.font = '13px -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Add a leg from the board to see the payoff.', W / 2, H / 2);
      return;
    }

    var r = chartRange();
    var N = 240;
    var xs = [], ys = [];
    for (var i = 0; i <= N; i++) {
      var S = r.lo + (r.hi - r.lo) * (i / N);
      xs.push(S);
      ys.push(payoffAt(S));
    }
    // Kinks inside the window must be exact, not sampled past.
    kinkPoints().forEach(function (kx) {
      if (kx > r.lo && kx < r.hi) { xs.push(kx); ys.push(payoffAt(kx)); }
    });
    var order = xs.map(function (v, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; });
    xs = order.map(function (i) { return xs[i]; });
    ys = order.map(function (i) { return ys[i]; });

    var yMin = Math.min.apply(null, ys), yMax = Math.max.apply(null, ys);
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    var pad = (yMax - yMin) * 0.12;
    yMin -= pad; yMax += pad;
    if (yMin > 0) yMin = 0;
    if (yMax < 0) yMax = 0;

    function X(S) { return m.l + ((S - r.lo) / (r.hi - r.lo)) * pw; }
    function Y(v) { return m.t + (1 - (v - yMin) / (yMax - yMin)) * ph; }

    ctx.font = '11px -apple-system, "Segoe UI", Roboto, sans-serif';

    // grid
    ctx.strokeStyle = c.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    niceTicks(yMin, yMax, 5).forEach(function (v) {
      var y = Y(v);
      ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(m.l + pw, y); ctx.stroke();
      ctx.fillText(fmtCompact(v), m.l - 8, y);
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    niceTicks(r.lo, r.hi, 6).forEach(function (v) {
      var x = X(v);
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
      ctx.fillText(K.fmtNumber(v, 0), x, m.t + ph + 8);
    });

    // profit / loss fills, split at the zero line
    var zeroY = Y(0);
    function fillSide(above) {
      ctx.beginPath();
      ctx.moveTo(X(xs[0]), zeroY);
      for (var i = 0; i < xs.length; i++) {
        var yv = above ? Math.max(ys[i], 0) : Math.min(ys[i], 0);
        ctx.lineTo(X(xs[i]), Y(yv));
      }
      ctx.lineTo(X(xs[xs.length - 1]), zeroY);
      ctx.closePath();
      ctx.fillStyle = above ? c.green : c.red;
      ctx.globalAlpha = above ? 0.14 : 0.12;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    fillSide(true);
    fillSide(false);

    // zero line
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(m.l, zeroY); ctx.lineTo(m.l + pw, zeroY); ctx.stroke();

    // underlying marker
    var U = board.underlying;
    if (U > r.lo && U < r.hi) {
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = c.primary;
      ctx.beginPath(); ctx.moveTo(X(U), m.t); ctx.lineTo(X(U), m.t + ph); ctx.stroke();
      ctx.restore();
    }

    // payoff curve
    ctx.strokeStyle = c.green;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (var j = 0; j < xs.length; j++) {
      var px = X(xs[j]), py = Y(ys[j]);
      if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // crosshair
    if (crossS !== null && crossS >= r.lo && crossS <= r.hi) {
      var cx = X(crossS), cy = Y(payoffAt(crossS));
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = c.text;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, m.t); ctx.lineTo(cx, m.t + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(m.l, cy); ctx.lineTo(m.l + pw, cy); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = c.text;
      ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function setCrossFromEvent(e) {
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left;
    var m = { l: 64, r: 14 };
    var pw = rect.width - m.l - m.r;
    var r = chartRange();
    var S = r.lo + ((x - m.l) / pw) * (r.hi - r.lo);
    crossS = Math.max(r.lo, Math.min(r.hi, S));
    renderCrossReadout();
    drawChart();
  }

  function renderCrossReadout() {
    if (crossS === null || !legs.length) {
      K.setText('sbCrossX', '—');
      K.setText('sbCrossY', '—');
      return;
    }
    var v = payoffAt(crossS);
    K.setText('sbCrossX', K.fmtNumber(crossS, 2));
    K.setText('sbCrossY', fmtKrw(v) + ' KRW');
    var el = document.getElementById('sbCrossY');
    if (el) {
      el.classList.remove('up', 'down');
      if (v > 0) el.classList.add('up');
      else if (v < 0) el.classList.add('down');
    }
  }

  function refresh() {
    renderPositions();
    refreshCalc();
  }

  // Editing a Qty/Entry field must not rebuild the table under the cursor —
  // replacing the input mid-interaction kills focus and the spinner arrows.
  function refreshCalc() {
    renderSummary();
    renderCrossReadout();
    drawChart();
  }

  // ---- wiring ----------------------------------------------------------
  function bindEvents() {
    document.getElementById('sbBoardBody').addEventListener('click', function (e) {
      var td = e.target.closest('.sb-price');
      if (!td) return;
      addLeg(td.dataset.t, Number(td.dataset.k), Number(td.dataset.p));
    });

    document.getElementById('sbBoardBody').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var td = e.target.closest('.sb-price');
      if (!td) return;
      e.preventDefault();
      addLeg(td.dataset.t, Number(td.dataset.k), Number(td.dataset.p));
    });

    var posBody = document.getElementById('sbPosBody');
    posBody.addEventListener('click', function (e) {
      var side = e.target.closest('.sb-side');
      if (side) {
        var i = Number(side.dataset.i);
        legs[i].side = -legs[i].side;
        refresh();
        return;
      }
      var rm = e.target.closest('.sb-remove');
      if (rm) {
        legs.splice(Number(rm.dataset.i), 1);
        refresh();
      }
    });

    posBody.addEventListener('change', function (e) {
      var q = e.target.closest('.sb-qty');
      if (q) {
        var qi = Number(q.dataset.i);
        legs[qi].qty = Math.max(1, Math.round(Number(q.value) || 1));
        refreshCalc();
        return;
      }
      var p = e.target.closest('.sb-entry');
      if (p) {
        var pi = Number(p.dataset.i);
        legs[pi].price = Math.max(0, Number(p.value) || 0);
        refreshCalc();
      }
    });

    document.getElementById('sbClear').addEventListener('click', function () {
      legs = [];
      crossS = null;
      refresh();
    });

    canvas.addEventListener('click', setCrossFromEvent);

    var resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(drawChart, 120);
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', drawChart);
      else if (mq.addListener) mq.addListener(drawChart);
    }
  }

  // ---- init ------------------------------------------------------------
  canvas = document.getElementById('sbChart');
  ctx = canvas ? canvas.getContext('2d') : null;

  K.fetchJSON('assets/option-board.json').then(function (data) {
    board = data;
    for (var i = 0; i < board.strikes.length; i++) {
      byStrike[board.strikes[i].k] = board.strikes[i];
    }

    K.setText('sbUnderlying', K.fmtNumber(board.underlying, 2));
    K.setText('sbIndex', K.fmtNumber(board.indexPrice, 2));
    K.setText(
      'sbExpiry',
      board.daysToExpiry !== null && board.daysToExpiry !== undefined
        ? board.daysToExpiry + ' days'
        : '—'
    );
    K.setText('sbSnapshot', K.formatTimestamp(new Date(board.snapshot)));
    K.setText(
      'sbMultNote',
      'Contract multiplier ' + board.multiplier.toLocaleString('en-US') +
        ' KRW per index point. Payoff assumes every leg is held to expiry; ' +
        'max profit and loss are measured across the plotted range.'
    );

    renderBoard();
    bindEvents();
    refresh();

    K.setText(
      'sbAsOf',
      'Board snapshot ' + K.formatTimestamp(new Date(board.snapshot)) +
        ' · ' + board.strikes.length + ' strikes on file · source: exchange quote export'
    );
  }).catch(function () {
    K.setText('sbAsOf', 'Option board data unavailable — run tools/build_option_board.py to generate it.');
    document.getElementById('sbBoardBody').innerHTML =
      '<tr><td colspan="7">Board data not found.</td></tr>';
  });
})();
