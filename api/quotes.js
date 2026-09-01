const SYMBOLS = {
  kospi: '^KS11',
  kosdaq: '^KQ11',
  kospi200: '^KS200',
  usdkrw: 'KRW=X',
  ussemi: '^SOX',
};

// KOSPI 200 futures roll quarterly (Mar/Jun/Sep/Dec) on the second
// Thursday of the contract month — mirrors the same rule in api/krx.js.
function secondThursday(year, monthIndex0) {
  const d = new Date(year, monthIndex0, 1);
  let count = 0;
  while (true) {
    if (d.getDay() === 4) {
      count++;
      if (count === 2) return d;
    }
    d.setDate(d.getDate() + 1);
  }
}

// Where "today" sits inside the current quarterly cycle: the expiry that
// started the front-month contract now trading, and the one that ends it.
function quarterlyCycle(today) {
  const y = today.getFullYear();
  const months = [2, 5, 8, 11]; // Mar, Jun, Sep, Dec
  const dates = [];
  for (const yy of [y - 1, y, y + 1]) {
    for (const m of months) dates.push(secondThursday(yy, m));
  }
  dates.sort((a, b) => a - b);
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const nextExpiry = dates.find((d) => d >= todayMid) || null;
  const idx = nextExpiry ? dates.indexOf(nextExpiry) : -1;
  const cycleStart = idx > 0 ? dates[idx - 1] : null;
  return { cycleStart, nextExpiry, todayMid };
}

async function fetchQuote(symbol, range = '3mo') {
  // 3mo (not 10d) so the previous-close lookup below reliably finds a
  // real prior trading day — some symbols (e.g. ^KS200) only return a
  // single candle from this endpoint for short ranges like 5d/10d/1mo.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
  });
  if (!res.ok) throw new Error(`Upstream status ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error('No data');
  }
  const price = meta.regularMarketPrice;

  // meta.chartPreviousClose/previousClose are unreliable for some symbols
  // (e.g. can reflect a close from several trading days back rather than
  // the prior session), which produced bogus % changes. Instead, derive
  // the real previous close from the daily candle series: the last two
  // non-null closes are today's and the prior trading day's.
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
    (c) => typeof c === 'number'
  );
  // Some symbols (e.g. ^KS200) only ever return a single daily candle from
  // this endpoint regardless of the range requested, so the candle-diff
  // approach can't apply there — fall back to Yahoo's own previous-close
  // field in that case.
  const prevClose =
    closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = prevClose ? price - prevClose : null;
  const changePercent = prevClose ? (change / prevClose) * 100 : null;

  // meta.fiftyTwoWeekHigh/Low are wrong for ^KS200 — they mirror the
  // session's own range. Derive the window from the candles instead, and
  // drop zeros, which Yahoo emits for the odd malformed bar.
  const q = result?.indicators?.quote?.[0] || {};
  const highs = (q.high || []).filter((v) => typeof v === 'number' && v > 0);
  const lows = (q.low || []).filter((v) => typeof v === 'number' && v > 0);
  const candleHigh = highs.length ? Math.max(...highs) : null;
  const candleLow = lows.length ? Math.min(...lows) : null;

  // Only a full year of candles describes a 52-week window; for shorter
  // ranges fall back to Yahoo's own fields.
  const isYear = range === '1y';
  // Guard against a stale history leaving the live price outside the range.
  const weekHigh52 = isYear && candleHigh !== null
    ? Math.max(candleHigh, price)
    : meta.fiftyTwoWeekHigh ?? null;
  const weekLow52 = isYear && candleLow !== null
    ? Math.min(candleLow, price)
    : meta.fiftyTwoWeekLow ?? null;

  // Outside trading hours Yahoo reports 0 for the session fields, so fall
  // back to the most recent candle — which is the last session's range,
  // i.e. exactly what "today" should show once the market has closed.
  const lastIdx = (q.close || []).reduce(
    (acc, c, i) => (typeof c === 'number' ? i : acc),
    -1
  );
  const fromLastCandle = (arr) => {
    if (lastIdx < 0) return null;
    const v = (arr || [])[lastIdx];
    return typeof v === 'number' && v > 0 ? v : null;
  };
  const orCandle = (metaVal, arr) =>
    typeof metaVal === 'number' && metaVal > 0 ? metaVal : fromLastCandle(arr);

  // Momentum stats below reuse the same year of candles already fetched
  // for the 52-week range, at no extra request — only computed when a
  // full year was actually requested, since a 3mo window can't reach
  // back to the start of a quarterly futures cycle or fill a 20-day
  // realized-vol window.
  let streakDays = null;
  let changeSinceCycleStart = null;
  let daysToExpiry = null;
  let realizedVol20 = null;

  if (isYear) {
    const ts = result?.timestamp || [];
    const rows = [];
    for (let i = 0; i < ts.length; i++) {
      const c = q.close?.[i];
      if (typeof c !== 'number') continue;
      rows.push({ date: ts[i] * 1000, close: c });
    }
    // Today's own price (from meta, not the possibly-stale last candle)
    // is the true "latest" point for these comparisons.
    if (rows.length) rows[rows.length - 1] = { ...rows[rows.length - 1], close: price };

    if (rows.length >= 2) {
      let dir = 0, run = 0;
      for (let i = rows.length - 1; i > 0; i--) {
        const d = rows[i].close > rows[i - 1].close ? 1 : rows[i].close < rows[i - 1].close ? -1 : 0;
        if (i === rows.length - 1) {
          dir = d;
          if (d === 0) break;
          run = 1;
        } else {
          if (d !== dir) break;
          run++;
        }
      }
      streakDays = dir === 0 ? 0 : dir * run;
    }

    // KOSPI 200 futures roll quarterly — measure the index against the
    // day the current front-month contract's cycle began, and count
    // down to the day it ends.
    const { cycleStart, nextExpiry, todayMid } = quarterlyCycle(new Date());
    if (nextExpiry) {
      daysToExpiry = Math.round((nextExpiry.getTime() - todayMid.getTime()) / 86400000);
    }
    if (cycleStart) {
      const startRow = rows.find((r) => r.date >= cycleStart.getTime());
      if (startRow && startRow.close) {
        changeSinceCycleStart = ((price - startRow.close) / startRow.close) * 100;
      }
    }

    // 20-day realized volatility, annualized — the same measure the full
    // Range & Volatility page breaks out by horizon, condensed to one
    // number as a teaser here.
    if (rows.length > 21) {
      const window = rows.slice(-21).map((r) => r.close);
      const logReturns = [];
      for (let i = 1; i < window.length; i++) {
        if (window[i - 1] > 0 && window[i] > 0) {
          logReturns.push(Math.log(window[i] / window[i - 1]));
        }
      }
      if (logReturns.length > 1) {
        const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
        const variance =
          logReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / (logReturns.length - 1);
        realizedVol20 = Math.sqrt(variance) * Math.sqrt(252) * 100;
      }
    }
  }

  return {
    price,
    change,
    changePercent,
    dayHigh: orCandle(meta.regularMarketDayHigh, q.high),
    dayLow: orCandle(meta.regularMarketDayLow, q.low),
    weekHigh52,
    weekLow52,
    prevClose,
    volume: orCandle(meta.regularMarketVolume, q.volume),
    streakDays,
    changeSinceCycleStart,
    daysToExpiry,
    realizedVol20,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json');

  const entries = Object.entries(SYMBOLS);
  const results = await Promise.all(
    entries.map(async ([key, symbol]) => {
      try {
        // KOSPI 200 drives the home page's range panel, so it needs a
        // year of candles. The rest only need enough for a prior close.
        // These run in parallel, so the wider range costs no extra time.
        return [key, await fetchQuote(symbol, key === 'kospi200' ? '1y' : '3mo')];
      } catch (err) {
        return [key, null];
      }
    })
  );

  const quotes = Object.fromEntries(results);
  res.status(200).json({ asOf: new Date().toISOString(), quotes });
};
