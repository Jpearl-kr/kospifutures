const SYMBOLS = {
  kospi: '^KS11',
  kosdaq: '^KQ11',
  usdkrw: 'KRW=X',
  ussemi: '^SOX',
};

async function fetchSeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
  });
  if (!res.ok) throw new Error(`Upstream status ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close || []).filter(
    (c) => typeof c === 'number'
  );
  if (!closes.length) throw new Error('No data');

  // Downsample to at most ~80 points — plenty of resolution for a small
  // sparkline and keeps the payload light.
  const maxPoints = 80;
  if (closes.length <= maxPoints) return closes;
  const stride = closes.length / maxPoints;
  const sampled = [];
  for (let i = 0; i < maxPoints; i++) {
    sampled.push(closes[Math.floor(i * stride)]);
  }
  sampled.push(closes[closes.length - 1]);
  return sampled;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=180');
  res.setHeader('Content-Type', 'application/json');

  const entries = Object.entries(SYMBOLS);
  const results = await Promise.all(
    entries.map(async ([key, symbol]) => {
      try {
        return [key, await fetchSeries(symbol)];
      } catch (err) {
        return [key, []];
      }
    })
  );

  const series = Object.fromEntries(results);
  res.status(200).json({ asOf: new Date().toISOString(), series });
};
