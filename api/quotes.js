const SYMBOLS = {
  kospi: '^KS11',
  kosdaq: '^KQ11',
  kospi200: '^KS200',
  usdkrw: 'KRW=X',
  nikkei225: '^N225',
};

async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
  });
  if (!res.ok) throw new Error(`Upstream status ${res.status}`);
  const json = await res.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error('No data');
  }
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
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
