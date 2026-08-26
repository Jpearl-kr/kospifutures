// KRX Open API — official exchange data, published the morning after each
// trading day. Everything here describes a completed session, never
// intraday, so pages must label it as a close.

const BASE = 'https://data-dbg.krx.co.kr/svc/apis';

function ymd(d) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

async function callKrx(path, params) {
  const key = process.env.KRX_API_KEY;
  if (!key) throw new Error('KRX_API_KEY not configured');
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { AUTH_KEY: key } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`KRX ${res.status}: ${body.slice(0, 160)}`);
  }
  const json = await res.json();
  return json?.OutBlock_1 || [];
}

// KRX sends every number as a string and uses "" where a field has no
// value for the day (an untraded option's close, for instance).
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bare = (s) => String(s || '').replace(/\s/g, '');

// Product names drop the space the index name carries ("코스피200 선물" vs
// "코스피 200"). Weeklies and the mini contract are separate products and
// are excluded from the standard monthly board.
const isK200Fut = (n) => bare(n) === '코스피200선물';
const isK200Opt = (n) => bare(n) === '코스피200옵션';

// Instrument names end with a session marker — "(정규)" for the regular
// session, "(야간)" overnight, "(주간)" for futures' day session. The
// regular session is the one that matches the published index close.
const isNight = (r) => String(r.ISU_NM || '').includes('야간');

// Strip that trailing marker before reading the strike off the end of e.g.
// "코스피200 C 202609   335.0 (정규)".
function parseInstrument(isuNm) {
  const stripped = String(isuNm || '').replace(/\([^)]*\)\s*$/, '').trim();
  const strike = stripped.match(/([\d,]+\.?\d*)$/);
  const expiry = stripped.match(/\b(\d{6})\b/);
  return {
    strike: strike ? Number(strike[1].replace(/,/g, '')) : null,
    expiry: expiry ? expiry[1] : null,
  };
}

// KOSPI 200 derivatives expire on the second Thursday of the contract
// month, which is what "days to expiry" should count toward.
function secondThursday(yyyymm) {
  const y = Number(yyyymm.slice(0, 4));
  const m = Number(yyyymm.slice(4, 6)) - 1;
  const d = new Date(y, m, 1);
  let thursdays = 0;
  while (true) {
    if (d.getDay() === 4) {
      thursdays++;
      if (thursdays === 2) return d;
    }
    d.setDate(d.getDate() + 1);
  }
}

function daysBetween(fromYmd, to) {
  const from = new Date(
    Number(fromYmd.slice(0, 4)),
    Number(fromYmd.slice(4, 6)) - 1,
    Number(fromYmd.slice(6, 8))
  );
  return Math.round((to - from) / 86400000);
}

// Walk back day by day until the exchange has published a session — KRX
// returns an empty list, not an error, for weekends and holidays.
async function findLatestSession(maxLookback = 10) {
  const today = new Date();
  for (let offset = 1; offset <= maxLookback; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const basDd = ymd(d);
    const rows = await callKrx('/idx/kospi_dd_trd', { basDd });
    const k200 = rows.find((r) => bare(r.IDX_NM) === '코스피200');
    if (k200 && num(k200.CLSPRC_IDX) !== null) return { basDd, k200 };
  }
  throw new Error('No published KRX session found in the last 10 days');
}

function mapIndexRow(r) {
  return {
    date: r.BAS_DD,
    close: num(r.CLSPRC_IDX),
    change: num(r.CMPPREVDD_IDX),
    changePercent: num(r.FLUC_RT),
    open: num(r.OPNPRC_IDX),
    high: num(r.HGPRC_IDX),
    low: num(r.LWPRC_IDX),
    volume: num(r.ACC_TRDVOL),
    tradingValue: num(r.ACC_TRDVAL),
    marketCap: num(r.MKTCAP),
  };
}

// KRX only answers one session per call, so pulling N days of history
// there means N individual round trips — the slowest thing this endpoint
// could do. Yahoo's chart API returns a year of daily candles in one
// request and (candle series, not the broken meta summary fields) has
// already proven accurate for ^KS200 elsewhere on this site, so history
// comes from there instead. Today's own row is still the authoritative
// KRX close, spliced in so the hero numbers and this table always agree.
//
// The same year of candles also covers the 52-week high/low, so it's
// computed here too rather than as a second, separate Yahoo request —
// this endpoint used to call Yahoo once for history and the page would
// call /api/quotes again just for the 52-week figure, doubling the
// number of requests hitting Yahoo's unofficial API for no reason.
async function fetchYahooHistoryAndWeek52(days, todayRow) {
  const empty = { history: todayRow ? [todayRow] : [], week52: null };
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EKS200?interval=1d&range=1y';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
  });
  if (!res.ok) return empty;

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp || [];
  const q = result?.indicators?.quote?.[0] || {};

  const rows = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q.close?.[i];
    if (typeof close !== 'number') continue;
    rows.push({
      date: ymd(new Date(ts[i] * 1000)),
      close,
      open: typeof q.open?.[i] === 'number' ? q.open[i] : null,
      high: typeof q.high?.[i] === 'number' && q.high[i] > 0 ? q.high[i] : null,
      low: typeof q.low?.[i] === 'number' && q.low[i] > 0 ? q.low[i] : null,
      volume: typeof q.volume?.[i] === 'number' ? q.volume[i] : null,
    });
  }
  if (!rows.length) return empty;

  const highs = rows.map((r) => r.high).filter((v) => v !== null);
  const lows = rows.map((r) => r.low).filter((v) => v !== null);
  const week52 = {
    high: highs.length && todayRow ? Math.max(Math.max(...highs), todayRow.close) : highs.length ? Math.max(...highs) : null,
    low: lows.length && todayRow ? Math.min(Math.min(...lows), todayRow.close) : lows.length ? Math.min(...lows) : null,
  };

  // Yahoo returns oldest-first; compute day-over-day change chronologically.
  const withChange = rows.map((r, i) => {
    const prev = rows[i - 1];
    const change = prev ? r.close - prev.close : null;
    const changePercent = prev && prev.close ? (change / prev.close) * 100 : null;
    return {
      date: r.date, close: r.close, change, changePercent,
      open: r.open, high: r.high, low: r.low, volume: r.volume,
      tradingValue: null, marketCap: null,
    };
  });

  // Yahoo's "1y daily" series includes today's still-open session as its
  // last bar — a partial candle, not a completed one, and it can be dated
  // a day ahead of KRX's own session if fetched while Korea is mid-session.
  // Drop anything on or after today's KRX date; that date's row always
  // comes from the authoritative KRX close instead.
  const priorOnly = todayRow ? withChange.filter((r) => r.date < todayRow.date) : withChange;
  let history = priorOnly.slice(-(todayRow ? days - 1 : days)).reverse();

  if (todayRow) history = [todayRow, ...history].slice(0, days);
  return { history, week52 };
}

async function fetchFutures(basDd) {
  const rows = await callKrx('/drv/fut_bydd_trd', { basDd });
  return rows
    .filter((r) => isK200Fut(r.PROD_NM) && !isNight(r))
    // Calendar spreads ("코스피200 SP 2609-2612") trade as their own
    // instrument and carry no open interest; keep outright futures only.
    .filter((r) => / F /.test(r.ISU_NM || ''))
    .map((r) => {
      const { expiry } = parseInstrument(r.ISU_NM);
      const close = num(r.TDD_CLSPRC);
      const spot = num(r.SPOT_PRC);
      return {
        code: r.ISU_CD,
        name: r.ISU_NM,
        expiry,
        daysToExpiry: expiry ? daysBetween(basDd, secondThursday(expiry)) : null,
        close,
        change: num(r.CMPPREVDD_PRC),
        open: num(r.TDD_OPNPRC),
        high: num(r.TDD_HGPRC),
        low: num(r.TDD_LWPRC),
        spot,
        settlement: num(r.SETL_PRC),
        // Basis is the headline number on a Korean futures board: how far
        // the contract sits above or below the cash index.
        basis: close !== null && spot !== null ? close - spot : null,
        volume: num(r.ACC_TRDVOL),
        tradingValue: num(r.ACC_TRDVAL),
        openInterest: num(r.ACC_OPNINT_QTY),
      };
    })
    .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0));
}

async function fetchOptions(basDd, spot) {
  const rows = await callKrx('/drv/opt_bydd_trd', { basDd });
  const legs = rows
    .filter((r) => isK200Opt(r.PROD_NM) && !isNight(r))
    .map((r) => {
      const { strike, expiry } = parseInstrument(r.ISU_NM);
      return {
        code: r.ISU_CD,
        right: r.RGHT_TP_NM,
        strike,
        expiry,
        close: num(r.TDD_CLSPRC),
        change: num(r.CMPPREVDD_PRC),
        iv: num(r.IMP_VOLT),
        nextBase: num(r.NXTDD_BAS_PRC),
        volume: num(r.ACC_TRDVOL),
        tradingValue: num(r.ACC_TRDVAL),
        openInterest: num(r.ACC_OPNINT_QTY),
      };
    })
    .filter((r) => r.strike !== null && r.expiry !== null);

  if (!legs.length) return null;

  // Front month = the nearest expiry that still carries open interest.
  const byExpiry = new Map();
  for (const leg of legs) {
    if (!byExpiry.has(leg.expiry)) byExpiry.set(leg.expiry, 0);
    byExpiry.set(leg.expiry, byExpiry.get(leg.expiry) + (leg.openInterest || 0));
  }
  const expiry = [...byExpiry.entries()]
    .filter(([, oi]) => oi > 0)
    .map(([e]) => e)
    .sort()[0];
  if (!expiry) return null;

  const byStrike = new Map();
  for (const leg of legs) {
    if (leg.expiry !== expiry) continue;
    if (!byStrike.has(leg.strike)) {
      byStrike.set(leg.strike, { strike: leg.strike, call: null, put: null });
    }
    const side = leg.right === 'CALL' ? 'call' : 'put';
    byStrike.get(leg.strike)[side] = leg;
  }

  const chain = [...byStrike.values()].sort((a, b) => a.strike - b.strike);

  let callOI = 0, putOI = 0, callVol = 0, putVol = 0;
  let callIvSum = 0, callIvN = 0, putIvSum = 0, putIvN = 0;
  let maxCallOI = null, maxPutOI = null;

  for (const row of chain) {
    for (const side of ['call', 'put']) {
      const leg = row[side];
      if (!leg) continue;
      const oi = leg.openInterest || 0;
      const vol = leg.volume || 0;
      if (side === 'call') {
        callOI += oi; callVol += vol;
        if (leg.iv) { callIvSum += leg.iv; callIvN++; }
        if (oi && (!maxCallOI || oi > maxCallOI.oi)) maxCallOI = { strike: row.strike, oi };
      } else {
        putOI += oi; putVol += vol;
        if (leg.iv) { putIvSum += leg.iv; putIvN++; }
        if (oi && (!maxPutOI || oi > maxPutOI.oi)) maxPutOI = { strike: row.strike, oi };
      }
    }
  }

  // Max pain: the settlement strike at which the least intrinsic value is
  // owed to option holders.
  let maxPain = null;
  for (const candidate of chain) {
    let total = 0;
    for (const row of chain) {
      if (row.call?.openInterest && candidate.strike > row.strike) {
        total += (candidate.strike - row.strike) * row.call.openInterest;
      }
      if (row.put?.openInterest && candidate.strike < row.strike) {
        total += (row.strike - candidate.strike) * row.put.openInterest;
      }
    }
    if (maxPain === null || total < maxPain.total) {
      maxPain = { strike: candidate.strike, total };
    }
  }

  const atm = spot
    ? chain.reduce((best, r) =>
        !best || Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best, null)
    : null;

  return {
    expiry,
    daysToExpiry: daysBetween(basDd, secondThursday(expiry)),
    chain,
    summary: {
      strikeCount: chain.length,
      callOpenInterest: callOI,
      putOpenInterest: putOI,
      putCallOIRatio: callOI ? putOI / callOI : null,
      callVolume: callVol,
      putVolume: putVol,
      putCallVolumeRatio: callVol ? putVol / callVol : null,
      callIv: callIvN ? callIvSum / callIvN : null,
      putIv: putIvN ? putIvSum / putIvN : null,
      averageIv:
        callIvN + putIvN ? (callIvSum + putIvSum) / (callIvN + putIvN) : null,
      atmIv: atm
        ? [atm.call?.iv, atm.put?.iv].filter(Boolean).reduce((a, b, _, arr) => a + b / arr.length, 0) || null
        : null,
      atmStrike: atm ? atm.strike : null,
      maxCallOI,
      maxPutOI,
      maxPain: maxPain ? maxPain.strike : null,
    },
  };
}

async function fetchBreadth(basDd) {
  const rows = await callKrx('/sto/stk_bydd_trd', { basDd });
  const kospi = rows.filter((r) => r.MKT_NM === 'KOSPI');
  let advancing = 0, declining = 0, unchanged = 0;
  for (const r of kospi) {
    const pct = num(r.FLUC_RT);
    if (pct === null) continue;
    if (pct > 0) advancing++;
    else if (pct < 0) declining++;
    else unchanged++;
  }
  return { advancing, declining, unchanged, totalIssues: kospi.length };
}

module.exports = async (req, res) => {
  // The data only changes once a day, so cache hard. This keeps us far
  // inside the 10,000 calls/day quota regardless of site traffic.
  res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'application/json');

  try {
    const { basDd, k200 } = await findLatestSession();
    const include = String(req.query.include || 'index');
    const index = mapIndexRow(k200);

    const payload = {
      asOf: new Date().toISOString(),
      session: basDd,
      source: 'KRX Open API',
      index,
    };

    const jobs = [];
    if (include.includes('history')) {
      const days = Math.min(Number(req.query.days) || 20, 40);
      jobs.push(
        fetchYahooHistoryAndWeek52(days, index).then(({ history, week52 }) => {
          payload.history = history;
          payload.week52 = week52;
        })
      );
    }
    if (include.includes('futures')) {
      jobs.push(fetchFutures(basDd).then((f) => { payload.futures = f; }));
    }
    if (include.includes('options')) {
      jobs.push(fetchOptions(basDd, index.close).then((o) => { payload.options = o; }));
    }
    if (include.includes('breadth')) {
      jobs.push(fetchBreadth(basDd).then((b) => { payload.breadth = b; }));
    }
    await Promise.all(jobs);

    res.status(200).json(payload);
  } catch (err) {
    res.status(200).json({ error: true, message: String((err && err.message) || err) });
  }
};
