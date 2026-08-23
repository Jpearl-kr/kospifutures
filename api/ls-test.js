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
          cnt: '5',
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
      const result = await callTR(token, 't8419', '/indtp/chart', {
        t8419InBlock: {
          shcode: upcode,
          gubun: '1',
          qrycnt: 500,
          sdate: '',
          edate: '',
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

    res.status(400).json({ error: 'unknown which=' + which });
  } catch (err) {
    res.status(200).json({ error: true, message: String(err && err.message || err) });
  }
};
