async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=3mo`;
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

  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
    (c) => typeof c === 'number'
  );
  const prevClose =
    closes.length >= 2 ? closes[closes.length - 2] : meta.chartPreviousClose ?? meta.previousClose ?? null;
  const change = prevClose ? price - prevClose : null;
  const changePercent = prevClose ? (change / prevClose) * 100 : null;

  // Yahoo sometimes reports 0 (not null/undefined) for these fields on
  // less liquid symbols, which isn't a real day-high/low/volume — treat
  // it as missing too.
  const orNull = (v) => (typeof v === 'number' && v > 0 ? v : null);

  return {
    symbol: meta.symbol,
    longName: meta.longName || meta.shortName || meta.symbol,
    currency: meta.currency,
    price,
    change,
    changePercent,
    dayHigh: orNull(meta.regularMarketDayHigh),
    dayLow: orNull(meta.regularMarketDayLow),
    weekHigh52: orNull(meta.fiftyTwoWeekHigh),
    weekLow52: orNull(meta.fiftyTwoWeekLow),
    volume: orNull(meta.regularMarketVolume),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.setHeader('Content-Type', 'application/json');

  const symbol = req.query.symbol;
  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' });
    return;
  }

  try {
    const quote = await fetchQuote(symbol);
    res.status(200).json(quote);
  } catch (err) {
    res.status(200).json({ error: true, symbol });
  }
};
