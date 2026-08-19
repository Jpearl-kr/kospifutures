module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('Content-Type', 'application/json');

  const q = req.query.q;
  if (!q || q.trim().length < 2) {
    res.status(200).json({ results: [] });
    return;
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
      q
    )}&lang=en-US&region=US&quotesCount=10&newsCount=0`;
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kospifutures-site/1.0)' },
    });
    if (!upstream.ok) throw new Error(`Upstream status ${upstream.status}`);
    const json = await upstream.json();
    const results = (json.quotes || [])
      .filter((r) => r.symbol && (r.shortname || r.longname))
      .map((r) => ({
        symbol: r.symbol,
        name: r.shortname || r.longname,
        exchange: r.exchange,
      }));
    res.status(200).json({ results });
  } catch (err) {
    res.status(200).json({ results: [], error: true });
  }
};
