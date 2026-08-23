const REST_BASE = 'https://openapi.ls-sec.co.kr:8080';

async function getToken() {
  const appkey = process.env.LS_APP_KEY;
  const appsecretkey = process.env.LS_APP_SECRET;
  if (!appkey || !appsecretkey) {
    throw new Error('LS_APP_KEY / LS_APP_SECRET not set');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    appkey,
    appsecretkey,
    scope: 'oob',
  });
  const res = await fetch(REST_BASE + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error('Token response not JSON: ' + text.slice(0, 300));
  }
  if (!res.ok || !json.access_token) {
    throw new Error('Token error: ' + JSON.stringify(json));
  }
  return json.access_token;
}

async function callTR(token, trCode, accessUrl, inBlock) {
  const res = await fetch(REST_BASE + accessUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      authorization: 'Bearer ' + token,
      tr_cd: trCode,
      tr_cont: 'N',
      tr_cont_key: '',
    },
    body: JSON.stringify(inBlock),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { httpStatus: res.status, raw: text.slice(0, 500) };
  }
  return { httpStatus: res.status, body: json };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const which = req.query.which || 't8424';

  if (which === 'env') {
    // Diagnostic only — reports presence/shape, never the values themselves.
    const k = process.env.LS_APP_KEY;
    const s = process.env.LS_APP_SECRET;
    res.status(200).json({
      which: 'env',
      LS_APP_KEY: { present: !!k, length: k ? k.length : 0 },
      LS_APP_SECRET: { present: !!s, length: s ? s.length : 0 },
      lsKeysSeen: Object.keys(process.env).filter((n) => n.startsWith('LS_')),
      vercelEnv: process.env.VERCEL_ENV || null,
      gitBranch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const gubun1 = req.query.gubun1 ?? '';
  const upcode = req.query.upcode ?? '';

  try {
    const token = await getToken();

    if (which === 't8424') {
      const result = await callTR(token, 't8424', '/indtp/market-data', {
        t8424InBlock: { gubun1 },
      });
      const list = result?.body?.t8424OutBlock || [];
      const filter = req.query.filter;
      const rows = filter
        ? list.filter(
            (r) =>
              String(r.hname || '').includes(filter) ||
              String(r.upcode || '').includes(filter)
          )
        : list;
      res.status(200).json({
        which,
        gubun1,
        total: list.length,
        showing: rows.length,
        rows: rows.slice(0, 60),
      });
      return;
    }

    if (which === 't1511') {
      const result = await callTR(token, 't1511', '/indtp/market-data', {
        t1511InBlock: { upcode },
      });
      res.status(200).json({ which, upcode, result });
      return;
    }

    if (which === 't1516') {
      const result = await callTR(token, 't1516', '/indtp/market-data', {
        t1516InBlock: { upcode, gubun: '0', shcode: '' },
      });
      const list = result?.body?.t1516OutBlock1 || [];
      res.status(200).json({
        which,
        upcode,
        rspMsg: result?.body?.rsp_msg,
        header: result?.body?.t1516OutBlock,
        constituentCount: list.length,
        sample: list.slice(0, 5),
      });
      return;
    }

    if (which === 't1514') {
      const result = await callTR(token, 't1514', '/indtp/market-data', {
        t1514InBlock: {
          upcode,
          gubun1: '1',
          gubun2: '0',
          cts_date: '',
          cnt: 5,
          rate_gbn: '0',
        },
      });
      res.status(200).json({
        which,
        upcode,
        rspMsg: result?.body?.rsp_msg,
        rows: (result?.body?.t1514OutBlock1 || []).slice(0, 5),
      });
      return;
    }

    if (which === 't8419') {
      const today = new Date();
      const kst = new Date(today.getTime() + 9 * 3600 * 1000);
      const ymd =
        kst.getUTCFullYear() +
        String(kst.getUTCMonth() + 1).padStart(2, '0') +
        String(kst.getUTCDate()).padStart(2, '0');
      const past = new Date(kst.getTime() - 7 * 24 * 3600 * 1000);
      const ymdPast =
        past.getUTCFullYear() +
        String(past.getUTCMonth() + 1).padStart(2, '0') +
        String(past.getUTCDate()).padStart(2, '0');

      const result = await callTR(token, 't8419', '/indtp/chart', {
        t8419InBlock: {
          shcode: upcode,
          gubun: req.query.gubun || '1',
          qrycnt: 500,
          sdate: req.query.sdate || ymdPast,
          edate: req.query.edate || ymd,
          cts_date: '',
          comp_yn: 'N',
        },
      });
      const rows = result?.body?.t8419OutBlock1 || [];
      res.status(200).json({
        which,
        upcode,
        rspMsg: result?.body?.rsp_msg,
        count: rows.length,
        first: rows.slice(0, 3),
        last: rows.slice(-3),
      });
      return;
    }

    if (which === 'sweep1514') {
      // Try several gubun1/gubun2/rate_gbn combos to find which one the
      // index-history TR actually accepts for this upcode.
      const combos = [];
      for (const g1 of ['0', '1', '2']) {
        for (const g2 of ['0', '1']) {
          combos.push({ gubun1: g1, gubun2: g2, rate_gbn: '0' });
        }
      }
      const results = [];
      for (const c of combos) {
        const r = await callTR(token, 't1514', '/indtp/market-data', {
          t1514InBlock: { upcode, cts_date: '', cnt: 3, ...c },
        });
        const rows = r?.body?.t1514OutBlock1 || [];
        results.push({
          ...c,
          msg: r?.body?.rsp_msg,
          rowCount: rows.length,
          firstRow: rows[0] || null,
        });
      }
      res.status(200).json({ which, upcode, results });
      return;
    }

    if (which === 'sweep8419') {
      // t1514/t8419 are rate-limited to ~1 req/sec, so space the probes out
      // — earlier sweeps failed on quota, not on bad params.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const combos = ['0', '1', '2', '3'];
      const results = [];
      for (const g of combos) {
        const r = await callTR(token, 't8419', '/indtp/chart', {
          t8419InBlock: {
            shcode: upcode,
            gubun: g,
            qrycnt: 10,
            sdate: '',
            edate: '',
            cts_date: '',
            comp_yn: 'N',
          },
        });
        const rows = r?.body?.t8419OutBlock1 || [];
        results.push({
          gubun: g,
          msg: r?.body?.rsp_msg,
          rowCount: rows.length,
          firstRow: rows[0] || null,
        });
        await sleep(1200);
      }
      res.status(200).json({ which, upcode, results });
      return;
    }

    res.status(400).json({ error: 'unknown which=' + which });
  } catch (err) {
    res.status(200).json({ error: true, message: String(err && err.message || err) });
  }
};
