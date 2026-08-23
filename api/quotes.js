const SYMBOLS = {
  kospi: '^KS11',
  kosdaq: '^KQ11',
  kospi200: '^KS200',
  usdkrw: 'KRW=X',
  ussemi: '^SOX',
};

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
