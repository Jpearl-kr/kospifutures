// KRX Open API — official exchange data, published the morning after each
// trading day. Everything here is therefore last-close, not intraday.

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

// KRX returns every numeric as a string, and uses "" for a field that has
// no value on the day (e.g. an untraded option's close).
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Product names drop the space the index name carries ("코스피200 선물"
// vs "코스피 200"), so compare with whitespace removed. Weekly options are
// separate products and are excluded from the standard monthly chain.
const bare = (s) => String(s || '').replace(/\s/g, '');
const isK200Fut = (name) => bare(name) === '코스피200선물';
const isK200Opt = (name) => bare(name) === '코스피200옵션';
// The feed carries both the day and overnight sessions; the regular
// session is the one that matches the published index close.
const isRegular = (r) => !(r.ISU_NM || '').includes('야간') && r.MKT_NM !== '야간';

// Walk back day by day until the exchange has published a session. KRX
// returns an empty list (not an error) for weekends and holidays.
async function findLatestSession(maxLookback = 10) {
  const today = new Date();
  for (let offset = 1; offset <= maxLookback; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() - offset);
    const basDd = ymd(d);
    const rows = await callKrx('/idx/kospi_dd_trd', { basDd });
    const k200 = rows.find((r) => (r.IDX_NM || '').replace(/\s/g, '') === '코스피200');
    if (k200 && num(k200.CLSPRC_IDX) !== null) return { basDd, k200, rows };
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

module.exports = async (req, res) => {
  // Data only changes once a day, so cache hard — this keeps us far inside
  // the 10,000 calls/day quota no matter how much traffic the site sees.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'application/json');

  try {
    const { basDd, k200 } = await findLatestSession();
    const include = String(req.query.include || 'index');

    const payload = {
      asOf: new Date().toISOString(),
      // The session this data describes — pages must label it as a close,
      // never as "today".
      session: basDd,
      source: 'KRX Open API',
      index: mapIndexRow(k200),
    };

    if (include.includes('history')) {
      // One call per session is the only way KRX exposes history, so keep
      // the window modest and fetch in parallel.
      const days = Math.min(Number(req.query.days) || 20, 40);
      const dates = [];
      const cursor = new Date(
        Number(basDd.slice(0, 4)),
        Number(basDd.slice(4, 6)) - 1,
        Number(basDd.slice(6, 8))
      );
      // Ask for more calendar days than sessions needed to cover weekends.
      for (let i = 0; i < days * 1.6; i++) {
        dates.push(ymd(cursor));
        cursor.setDate(cursor.getDate() - 1);
      }

      const settled = await Promise.all(
        dates.map(async (d) => {
          try {
            const rows = await callKrx('/idx/kospi_dd_trd', { basDd: d });
            const row = rows.find((r) => (r.IDX_NM || '').replace(/\s/g, '') === '코스피200');
            return row && num(row.CLSPRC_IDX) !== null ? mapIndexRow(row) : null;
          } catch (err) {
            return null;
          }
        })
      );

      payload.history = settled
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, days);
    }

    if (include.includes('futures')) {
      const rows = await callKrx('/drv/fut_bydd_trd', { basDd });
      payload.futures = rows
        .filter((r) => isK200Fut(r.PROD_NM) && isRegular(r))
        .map((r) => ({
          code: r.ISU_CD,
          name: r.ISU_NM,
          close: num(r.TDD_CLSPRC),
          change: num(r.CMPPREVDD_PRC),
          open: num(r.TDD_OPNPRC),
          high: num(r.TDD_HGPRC),
          low: num(r.TDD_LWPRC),
          spot: num(r.SPOT_PRC),
          settlement: num(r.SETL_PRC),
          volume: num(r.ACC_TRDVOL),
          tradingValue: num(r.ACC_TRDVAL),
          openInterest: num(r.ACC_OPNINT_QTY),
        }))
        .sort((a, b) => (b.openInterest || 0) - (a.openInterest || 0));
    }

    if (include.includes('options')) {
      const rows = await callKrx('/drv/opt_bydd_trd', { basDd });
      const chain = rows
        .filter((r) => isK200Opt(r.PROD_NM) && isRegular(r))
        .map((r) => {
          // Strike is the trailing number in "코스피200 C 202609 400.0".
          const m = String(r.ISU_NM || '').match(/([\d,]+\.?\d*)\s*$/);
          return {
            code: r.ISU_CD,
            name: r.ISU_NM,
            right: r.RGHT_TP_NM,
            strike: m ? Number(m[1].replace(/,/g, '')) : null,
            close: num(r.TDD_CLSPRC),
            change: num(r.CMPPREVDD_PRC),
            iv: num(r.IMP_VOLT),
            nextBase: num(r.NXTDD_BAS_PRC),
            volume: num(r.ACC_TRDVOL),
            tradingValue: num(r.ACC_TRDVAL),
            openInterest: num(r.ACC_OPNINT_QTY),
          };
        })
        .filter((r) => r.strike !== null);

      payload.options = chain;
    }

    res.status(200).json(payload);
  } catch (err) {
    res.status(200).json({ error: true, message: String((err && err.message) || err) });
  }
};
