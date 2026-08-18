const SYMBOLS = {
  kospi: '^KS11',
  kosdaq: '^KQ11',
  kospi200: '^KS200',
  usdkrw: 'KRW=X',
  ussemi: '^SOX',
};

async function fetchQuote(symbol) {
  // A 10-day window (not 5d) so the previous-close lookup below still
  // finds a real prior trading day across long weekends/holidays.
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`;
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
  return {
    price,
    change,
    changePercent,
    dayHigh: meta.regularMarketDayHigh ?? null,
    dayLow: meta.regularMarketDayLow ?? null,
    weekHigh52: meta.fiftyTwoWeekHigh ?? null,
    weekLow52: meta.fiftyTwoWeekLow ?? null,
    volume: meta.regularMarketVolume ?? null,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json');

  const entries = Object.entries(SYMBOLS);
  const results = await Promise.all(
    entries.map(async ([key, symbol]) => {
      try {
        return [key, await fetchQuote(symbol)];
      } catch (err) {
        return [key, null];
      }
    })
  );

  const quotes = Object.fromEntries(results);
  res.status(200).json({ asOf: new Date().toISOString(), quotes });
};
