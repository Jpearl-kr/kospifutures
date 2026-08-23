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

    if (which === 't8435') {
      // Master list of derivatives symbols — gubun: 0=futures, 1=options
      const result = await callTR(token, 't8435', '/futureoption/market-data', {
        t8435InBlock: { gubun: req.query.gubun || '0' },
      });
      const rows = result?.body?.t8435OutBlock || [];
      const filter = req.query.filter;
      const matched = filter
        ? rows.filter(
            (r) =>
              String(r.hname || '').includes(filter) ||
              String(r.shcode || '').includes(filter)
          )
        : rows;
      res.status(200).json({
        which,
        rspMsg: result?.body?.rsp_msg,
        total: rows.length,
        showing: matched.length,
        rows: matched.slice(0, 30),
      });
      return;
    }

    if (which === 't2101') {
      const result = await callTR(token, 't2101', '/futureoption/market-data', {
        t2101InBlock: { focode: req.query.focode || '' },
      });
      res.status(200).json({
        which,
        focode: req.query.focode,
        rspMsg: result?.body?.rsp_msg,
        data: result?.body?.t2101OutBlock || null,
      });
      return;
    }

    if (which === 't2301') {
      const result = await callTR(token, 't2301', '/futureoption/market-data', {
        t2301InBlock: { yyyymm: req.query.yyyymm || '', gubun: req.query.gubun || '0' },
      });
      const rows = result?.body?.t2301OutBlock2 || [];
      res.status(200).json({
        which,
        rspMsg: result?.body?.rsp_msg,
        header: result?.body?.t2301OutBlock || null,
        strikeCount: rows.length,
        sample: rows.slice(0, 4),
      });
      return;
    }

    if (which === 't8434') {
      // Multi-quote by code list — the way to price the call side, whose
      // codes come from the t8433 master.
      const r = await callTR(token, 't8434', '/futureoption/market-data', {
        t8434InBlock: {
          qrycnt: Number(req.query.qrycnt || 5),
          focode: req.query.focode || '',
        },
      });
      res.status(200).json({
        which,
        msg: r?.body?.rsp_msg,
        sent: req.query.focode,
        rows: r?.body?.t8434OutBlock1 || [],
      });
      return;
    }

    if (which === 'calloi') {
      // Can t2101 give us open interest + greeks for a call code?
      // Pick front-month calls near spot from the master and query a few.
      const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
      const master = await callTR(token, 't8433', '/futureoption/market-data', {
        t8433InBlock: { dummy: '' },
      });
      const rows = master?.body?.t8433OutBlock || [];
      const parsed = rows
        .map((x) => {
          const m = String(x.hname || '').match(/^([CP])\s+(\d+)\s+([\d,.]+)/);
          return m
            ? { shcode: x.shcode, side: m[1], expiry: m[2], strike: Number(m[3].replace(/,/g, '')) }
            : null;
        })
        .filter(Boolean);

      const expiry = req.query.expiry || '2609';
      const spot = Number(req.query.spot || 1099.7);
      const calls = parsed
        .filter((x) => x.side === 'C' && x.expiry === expiry)
        .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
        .slice(0, 4);

      const results = [];
      for (const c of calls) {
        const r = await callTR(token, 't2101', '/futureoption/market-data', {
          t2101InBlock: { focode: c.shcode },
        });
        const b = r?.body?.t2101OutBlock;
        results.push({
          shcode: c.shcode,
          strike: c.strike,
          msg: r?.body?.rsp_msg,
          hname: b?.hname,
          price: b?.price,
          openInterest: b?.mgjv,
          volume: b?.volume,
          iv: b?.impv,
          delta: b?.delt,
        });
        await sleep2(400);
      }
      res.status(200).json({ which, expiry, spot, results });
      return;
    }

    if (which === 'mastersample') {
      // Look at raw values with escaping so hidden whitespace shows up.
      const r = await callTR(token, 't8433', '/futureoption/market-data', {
        t8433InBlock: { dummy: '' },
      });
      const rows = r?.body?.t8433OutBlock || [];
      const step = Math.max(1, Math.floor(rows.length / 8));
      const picks = [];
      for (let i = 0; i < rows.length && picks.length < 8; i += step) {
        const x = rows[i];
        picks.push({
          i,
          shcode: JSON.stringify(x.shcode),
          hname: JSON.stringify(x.hname),
          expcode: JSON.stringify(x.expcode),
        });
      }
      res.status(200).json({ which, total: rows.length, picks });
      return;
    }

    if (which === 'callcodes') {
      // Pull the master and report the call (BO…) entries for the
      // front-month expiry, with their strikes parsed from hname.
      const r = await callTR(token, 't8433', '/futureoption/market-data', {
        t8433InBlock: { dummy: '' },
      });
      const rows = r?.body?.t8433OutBlock || [];
      const calls = rows.filter((x) => String(x.shcode || '').startsWith('BO'));
      const parse = (x) => {
        const m = String(x.hname || '').match(/^([CP])\s+(\d+)\s+([\d.]+)/);
        return m
          ? { shcode: x.shcode, side: m[1], expiry: m[2], strike: Number(m[3]) }
          : { shcode: x.shcode, hname: x.hname };
      };
      const parsed = calls.map(parse).filter((x) => x.expiry);
      const expiries = {};
      parsed.forEach((x) => { expiries[x.expiry] = (expiries[x.expiry] || 0) + 1; });
      res.status(200).json({
        which,
        totalCalls: calls.length,
        expiryCounts: expiries,
        sample: parsed.slice(0, 5),
      });
      return;
    }

    if (which === 't8433') {
      // Option master list — hopefully carries both call and put codes.
      const r = await callTR(token, 't8433', '/futureoption/market-data', {
        t8433InBlock: { dummy: req.query.dummy || '' },
      });
      const rows = r?.body?.t8433OutBlock || [];
      const prefixes = {};
      rows.forEach((x) => {
        const p = String(x.shcode || '').slice(0, 2);
        prefixes[p] = (prefixes[p] || 0) + 1;
      });
      res.status(200).json({
        which,
        msg: r?.body?.rsp_msg,
        count: rows.length,
        codePrefixCounts: prefixes,
        samples: rows.slice(0, 6).map((x) => ({
          shcode: x.shcode, hname: x.hname, expcode: x.expcode,
        })),
      });
      return;
    }

    if (which === 'findcalls') {
      // Every gubun tried so far returns puts (all deltas negative).
      // Sweep a wider set and report the delta sign, which is the only
      // reliable call/put tell in this response.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const values = (req.query.vals || '0,1,2,3,4,5,C,P,1,2').split(',');
      const results = [];
      for (const g of values) {
        const r = await callTR(token, 't2301', '/futureoption/market-data', {
          t2301InBlock: { yyyymm: '', gubun: g },
        });
        const rows = r?.body?.t2301OutBlock2 || [];
        const deltas = rows.map((x) => Number(x.delt)).filter(Number.isFinite);
        results.push({
          gubun: g,
          msg: r?.body?.rsp_msg,
          count: rows.length,
          pos: deltas.filter((d) => d > 0).length,
          neg: deltas.filter((d) => d < 0).length,
        });
        await sleep(700);
      }
      res.status(200).json({ which, results });
      return;
    }

    if (which === 'scan2301') {
      // Walk the whole board and report how codes, strikes and deltas
      // relate — is the call side present at all?
      const r = await callTR(token, 't2301', '/futureoption/market-data', {
        t2301InBlock: { yyyymm: '', gubun: '0' },
      });
      const rows = r?.body?.t2301OutBlock2 || [];
      const spot = Number(r?.body?.t2301OutBlock?.gmprice);
      const prefixes = {};
      let posDelta = 0, negDelta = 0, zeroDelta = 0;
      rows.forEach((x) => {
        const p = String(x.optcode || '').slice(0, 2);
        prefixes[p] = (prefixes[p] || 0) + 1;
        const d = Number(x.delt);
        if (d > 0) posDelta++;
        else if (d < 0) negDelta++;
        else zeroDelta++;
      });
      // Sample a deep ITM strike and a deep OTM strike relative to spot.
      const sorted = rows.slice().sort((a, b) => Number(a.actprice) - Number(b.actprice));
      const pick = (row) => row && {
        strike: row.actprice, code: row.optcode, price: row.price,
        delta: row.delt, iv: row.iv, oi: row.mgjv,
      };
      res.status(200).json({
        which,
        spot,
        totalRows: rows.length,
        codePrefixCounts: prefixes,
        deltaSigns: { positive: posDelta, negative: negDelta, zero: zeroDelta },
        lowestStrike: pick(sorted[0]),
        highestStrike: pick(sorted[sorted.length - 1]),
        duplicateStrikes: sorted.length - new Set(sorted.map((x) => x.actprice)).size,
      });
      return;
    }

    if (which === 'raw2301') {
      // Dump one full row so we can see every field the board carries —
      // the put side may be columns on the same row rather than a
      // separate query.
      const r = await callTR(token, 't2301', '/futureoption/market-data', {
        t2301InBlock: { yyyymm: '', gubun: '0' },
      });
      const rows = r?.body?.t2301OutBlock2 || [];
      const idx = Number(req.query.i || 0);
      res.status(200).json({
        which,
        msg: r?.body?.rsp_msg,
        header: r?.body?.t2301OutBlock || null,
        totalRows: rows.length,
        row: rows[idx] || null,
      });
      return;
    }

    if (which === 'sweep2301p') {
      // Every row so far came back CO… (calls). Find the input that
      // returns the put side.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const attempts = [
        { label: 'gubun=3', block: { yyyymm: '', gubun: '3' } },
        { label: 'gubun=P', block: { yyyymm: '', gubun: 'P' } },
        { label: 'gubun=1,jgubun=1', block: { yyyymm: '', gubun: '1', jgubun: '1' } },
        { label: 'gubun=0,cpgubun=3', block: { yyyymm: '', gubun: '0', cpgubun: '3' } },
      ];
      const results = [];
      for (const a of attempts) {
        const r = await callTR(token, 't2301', '/futureoption/market-data', {
          t2301InBlock: a.block,
        });
        const rows = r?.body?.t2301OutBlock2 || [];
        results.push({
          attempt: a.label,
          msg: r?.body?.rsp_msg,
          count: rows.length,
          codePrefixes: [...new Set(rows.slice(0, 40).map((x) => String(x.optcode || '').slice(0, 3)))],
        });
        await sleep(700);
      }
      res.status(200).json({ which, results });
      return;
    }

    if (which === 'sweep2301g') {
      // Does gubun select call vs put? Compare delta signs per value.
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const results = [];
      for (const g of ['0', '1', '2']) {
        const r = await callTR(token, 't2301', '/futureoption/market-data', {
          t2301InBlock: { yyyymm: '', gubun: g },
        });
        const rows = r?.body?.t2301OutBlock2 || [];
        const deltas = rows.map((x) => Number(x.delt)).filter((n) => Number.isFinite(n));
        results.push({
          gubun: g,
          msg: r?.body?.rsp_msg,
          count: rows.length,
          negativeDeltas: deltas.filter((d) => d < 0).length,
          positiveDeltas: deltas.filter((d) => d > 0).length,
          sampleCodes: rows.slice(0, 3).map((x) => x.optcode),
          sampleStrikes: rows.slice(0, 3).map((x) => x.actprice),
        });
        await sleep(700);
      }
      res.status(200).json({ which, results });
      return;
    }

    if (which === 'sweepfut') {
      // KOSPI 200 futures codes follow 101 + <month letter> + <year digit>.
      // Front month rolls quarterly (Mar/Jun/Sep/Dec => H/M/U/Z).
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const candidates = (req.query.codes || '101U6,101Z6,101H7,101M7,101QC000,105U6')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const results = [];
      for (const code of candidates) {
        const r = await callTR(token, 't2101', '/futureoption/market-data', {
          t2101InBlock: { focode: code },
        });
        const b = r?.body?.t2101OutBlock;
        results.push({
          focode: code,
          msg: r?.body?.rsp_msg,
          hname: b?.hname || null,
          price: b?.price ?? null,
          basis: b?.basis ?? null,
          openInterest: b?.mgjv ?? null,
        });
        await sleep(300);
      }
      res.status(200).json({ which, results });
      return;
    }

    if (which === 'sweep2301') {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const months = (req.query.months || ',202609,202610,202612')
        .split(',')
        .map((s) => s.trim());
      const results = [];
      for (const m of months) {
        const r = await callTR(token, 't2301', '/futureoption/market-data', {
          t2301InBlock: { yyyymm: m, gubun: '0' },
        });
        const rows = r?.body?.t2301OutBlock2 || [];
        results.push({
          yyyymm: m || '(blank)',
          msg: r?.body?.rsp_msg,
          strikeCount: rows.length,
          sample: rows.slice(0, 2),
        });
        await sleep(600);
      }
      res.status(200).json({ which, results });
      return;
    }

    if (which === 'sweep8435') {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const results = [];
      for (const g of ['0', '1', '2', '3', '4', 'F', 'O']) {
        const r = await callTR(token, 't8435', '/futureoption/market-data', {
          t8435InBlock: { gubun: g },
        });
        const rows = r?.body?.t8435OutBlock || [];
        results.push({
          gubun: g,
          msg: r?.body?.rsp_msg,
          count: rows.length,
          samples: rows.slice(0, 3).map((x) => ({ shcode: x.shcode, hname: x.hname, expcode: x.expcode })),
        });
        await sleep(600);
      }
      res.status(200).json({ which, results });
      return;
    }

    res.status(400).json({ error: 'unknown which=' + which });
  } catch (err) {
    res.status(200).json({ error: true, message: String(err && err.message || err) });
  }
};
