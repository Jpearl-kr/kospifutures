// Scratch diagnostic for mapping the real KRX Open API surface — endpoint
// paths, exact field names — before building the real integration. Not
// linked from any page. Delete once api/krx.js is built and confirmed.

const BASE = 'https://data-dbg.krx.co.kr/svc/apis';

function ymd(d) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

function recentBizDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return ymd(d);
}

async function callKrx(path, params) {
  const key = process.env.KRX_API_KEY;
  if (!key) throw new Error('KRX_API_KEY not configured');
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}?${qs}`;
  const res = await fetch(url, { headers: { AUTH_KEY: key } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // leave json null, return raw text below
  }
  return { status: res.status, json, rawSnippet: json ? null : text.slice(0, 300) };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const which = req.query.which;

  try {
    if (which === 'k200prods') {
      // Confirm the exact PROD_NM strings and session split (정규 vs 야간)
      // for KOSPI 200 futures/options before filtering on them for real.
      const basDd = req.query.basDd || recentBizDate(3);
      const [fut, opt] = await Promise.all([
        callKrx('/drv/fut_bydd_trd', { basDd }),
        callKrx('/drv/opt_bydd_trd', { basDd }),
      ]);
      const futRows = fut.json?.OutBlock_1 || [];
      const optRows = opt.json?.OutBlock_1 || [];

      const futK200 = futRows.filter((r) => (r.PROD_NM || '').includes('코스피 200') && !(r.PROD_NM || '').includes('미니'));
      const optK200 = optRows.filter((r) => (r.PROD_NM || '').includes('코스피 200') && !(r.PROD_NM || '').includes('미니'));

      res.status(200).json({
        which,
        basDd,
        allFutProdNames: [...new Set(futRows.map((r) => r.PROD_NM))],
        allOptProdNames: [...new Set(optRows.map((r) => r.PROD_NM))],
        futK200Count: futK200.length,
        futK200Sample: futK200.slice(0, 5),
        optK200Count: optK200.length,
        optK200Sample: optK200.slice(0, 6),
        optK200SessionSplit: [...new Set(optK200.map((r) => r.MKT_NM))],
      });
      return;
    }

    if (which === 'env') {
      const key = process.env.KRX_API_KEY;
      res.status(200).json({
        which,
        present: !!key,
        length: key ? key.length : 0,
        vercelEnv: process.env.VERCEL_ENV || null,
      });
      return;
    }

    if (which === 'idxkospi') {
      // The one endpoint confirmed from public write-ups. If basDd is
      // explicitly given, use it as-is; otherwise walk back from
      // yesterday until a non-empty trading day turns up (weekends /
      // holidays return an empty OutBlock_1, not an error).
      let basDd = req.query.basDd;
      let r, rows, triedDates = [];
      if (basDd) {
        r = await callKrx('/idx/kospi_dd_trd', { basDd });
        rows = r.json?.OutBlock_1 || [];
      } else {
        for (let offset = 1; offset <= 7; offset++) {
          basDd = recentBizDate(offset);
          triedDates.push(basDd);
          r = await callKrx('/idx/kospi_dd_trd', { basDd });
          rows = r.json?.OutBlock_1 || [];
          if (rows.length) break;
        }
      }
      res.status(200).json({
        which,
        basDd,
        triedDates,
        status: r.status,
        errorBody: r.status !== 200 ? r.json : undefined,
        rawSnippet: r.rawSnippet,
        rowCount: rows.length,
        allNames: [...new Set(rows.map((x) => x.IDX_NM))],
        kospi200Row: rows.find((x) => (x.IDX_NM || '').replace(/\s/g, '') === '코스피200') || null,
        sampleRow: rows[0] || null,
        sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
      });
      return;
    }

    if (which === 'idxsweep') {
      // Try a handful of plausible index-group paths in case kospi_dd_trd
      // isn't the only or right one (e.g. a dedicated multi-index path).
      const basDd = req.query.basDd || recentBizDate(3);
      const paths = ['/idx/kospi_dd_trd', '/idx/kosdaq_dd_trd', '/idx/krx_dd_trd', '/idx/bon_dd_trd'];
      const results = [];
      for (const p of paths) {
        try {
          const r = await callKrx(p, { basDd });
          const rows = r.json?.OutBlock_1 || [];
          results.push({ path: p, status: r.status, rowCount: rows.length, sampleKeys: rows[0] ? Object.keys(rows[0]) : [], rawSnippet: r.rawSnippet });
        } catch (e) {
          results.push({ path: p, error: String(e.message || e) });
        }
      }
      res.status(200).json({ which, basDd, results });
      return;
    }

    if (which === 'drvsweep') {
      // Guessing derivatives endpoint names based on common KRX Open API
      // naming conventions (drv/<product>_bydd_trd). Default to 3 days
      // back so a weekend basDd doesn't come back empty across the board.
      const basDd = req.query.basDd || recentBizDate(3);
      const paths = [
        '/drv/fut_bydd_trd',
        '/drv/opt_bydd_trd',
        '/drv/eqsfu_stk_bydd_trd',
        '/drv/eqsopt_stk_bydd_trd',
        '/drv/idxfu_bydd_trd',
        '/drv/idxopt_bydd_trd',
        '/drv/eqkfu_bydd_trd',
        '/drv/eqkopt_bydd_trd',
      ];
      const results = [];
      for (const p of paths) {
        try {
          const r = await callKrx(p, { basDd });
          const rows = r.json?.OutBlock_1 || [];
          results.push({
            path: p,
            status: r.status,
            rowCount: rows.length,
            sampleKeys: rows[0] ? Object.keys(rows[0]) : [],
            sampleRow: rows[0] || null,
            rawSnippet: r.rawSnippet,
          });
        } catch (e) {
          results.push({ path: p, error: String(e.message || e) });
        }
      }
      res.status(200).json({ which, basDd, results });
      return;
    }

    if (which === 'raw') {
      // Free-form probe: ?path=/idx/kospi_dd_trd&basDd=20260821
      const path = req.query.path;
      if (!path) throw new Error('pass ?path=/idx/...');
      const params = { ...req.query };
      delete params.which;
      delete params.path;
      const r = await callKrx(path, params);
      res.status(200).json({ which, path, params, status: r.status, json: r.json, rawSnippet: r.rawSnippet });
      return;
    }

    res.status(400).json({ error: 'unknown which=' + which, options: ['idxkospi', 'idxsweep', 'drvsweep', 'raw'] });
  } catch (err) {
    res.status(200).json({ error: true, message: String((err && err.message) || err) });
  }
};
