module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=3600');
  res.setHeader('Content-Type', 'application/json');

  const symbol = req.query.symbol || '^KS200';
  const range = req.query.range || '1y';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?interval=1d&range=${encodeURIComponent(range)}`;
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
    });
    if (!upstream.ok) throw new Error(`Upstream status ${upstream.status}`);
    const json = await upstream.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('No data');

    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const rows = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
        close: q.close?.[i] ?? null,
        volume: q.volume?.[i] ?? null,
      }))
      .filter((r) => typeof r.close === 'number');

    res.status(200).json({ symbol, range, rows });
  } catch (err) {
    res.status(200).json({ symbol, range, rows: [], error: true });
  }
};
