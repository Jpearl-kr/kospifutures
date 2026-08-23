const REST_BASE = 'https://openapi.ls-sec.co.kr:8080';

let cachedToken = null;
let cachedTokenExpiry = 0;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) return cachedToken;

  const appkey = process.env.LS_APP_KEY;
  const appsecretkey = process.env.LS_APP_SECRET;
  if (!appkey || !appsecretkey) throw new Error('LS credentials not configured');

  const res = await fetch(REST_BASE + '/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      appkey,
      appsecretkey,
      scope: 'oob',
    }).toString(),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error('LS token error: ' + JSON.stringify(json).slice(0, 200));
  }
  cachedToken = json.access_token;
  cachedTokenExpiry = now + Math.max((json.expires_in || 3600) - 60, 60) * 1000;
  return cachedToken;
}

async function callTR(token, trCode, accessUrl, body) {
  const res = await fetch(REST_BASE + accessUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      authorization: 'Bearer ' + token,
      tr_cd: trCode,
      tr_cont: 'N',
      tr_cont_key: '',
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Master rows name themselves like "C 2609   335.0" / "P 2610 1,012.5".
function parseMasterName(hname) {
  const m = String(hname || '').match(/^([CP])\s+(\d+)\s+([\d,.]+)/);
  if (!m) return null;
  return {
    side: m[1] === 'C' ? 'call' : 'put',
    expiry: m[2],
    strike: Number(m[3].replace(/,/g, '')),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'application/json');

  try {
    const token = await getToken();

    // The option board (t2301) only ever answers with the put side no
    // matter what gubun is passed, so the calls come from the symbol
    // master (t8433) priced through the multi-quote TR (t8434).
    const board = await callTR(token, 't2301', '/futureoption/market-data', {
      t2301InBlock: { yyyymm: req.query.yyyymm || '', gubun: '0' },
    });

    const header = board?.t2301OutBlock || {};
    const putRows = board?.t2301OutBlock2 || [];
    const spot = num(header.gmprice);

    const byStrike = new Map();
    const ensure = (strike) => {
      if (!byStrike.has(strike)) byStrike.set(strike, { strike, call: null, put: null });
      return byStrike.get(strike);
    };

    for (const r of putRows) {
      const strike = num(r.actprice);
      if (strike === null) continue;
      ensure(strike).put = {
        code: r.optcode,
        price: num(r.price),
        change: num(r.change),
        changePercent: num(r.diff),
        volume: num(r.volume),
        openInterest: num(r.mgjv),
        openInterestChange: num(r.mgjvupdn),
        iv: num(r.iv),
        impliedVol: num(r.impv),
        theoryPrice: num(r.theoryprice),
        timeValue: num(r.timevl),
        delta: num(r.delt),
        gamma: num(r.gama),
        vega: num(r.vega),
        theta: num(r.ceta),
        rho: num(r.rhox),
      };
    }

    // Work out which expiry the board is showing, then pull the matching
    // calls. Codes are B0… for calls and C0… for puts — that's a zero,
    // not the letter O.
    let callsFetched = 0;
    try {
      const master = await callTR(token, 't8433', '/futureoption/market-data', {
        t8433InBlock: { dummy: '' },
      });
      const masterRows = master?.t8433OutBlock || [];

      // Match the board's expiry by finding the put expiry that covers
      // the same strikes we already have.
      const boardStrikes = new Set(Array.from(byStrike.keys()));
      const expiryScore = new Map();
      for (const row of masterRows) {
        const parsed = parseMasterName(row.hname);
        if (!parsed || parsed.side !== 'put') continue;
        if (!boardStrikes.has(parsed.strike)) continue;
        expiryScore.set(parsed.expiry, (expiryScore.get(parsed.expiry) || 0) + 1);
      }
      let expiry = null, best = 0;
      for (const [exp, score] of expiryScore) {
        if (score > best) { best = score; expiry = exp; }
      }

      if (expiry) {
        // Only price the strikes near spot — the multi-quote TR takes a
        // bounded list, and the far wings are noise anyway.
        const calls = masterRows
          .map((row) => ({ row, parsed: parseMasterName(row.hname) }))
          .filter((x) => x.parsed && x.parsed.side === 'call' && x.parsed.expiry === expiry)
          .sort((a, b) =>
            Math.abs(a.parsed.strike - (spot || 0)) - Math.abs(b.parsed.strike - (spot || 0))
          )
          .slice(0, 40);

        // t8434 takes codes as one concatenated string of fixed-width
        // symbols, in batches.
        const BATCH = 20;
        for (let i = 0; i < calls.length; i += BATCH) {
          const batch = calls.slice(i, i + BATCH);
          const focode = batch.map((x) => x.row.shcode).join('');
          const quote = await callTR(token, 't8434', '/futureoption/market-data', {
            t8434InBlock: { qrycnt: batch.length, focode },
          });
          const quoteRows = quote?.t8434OutBlock1 || [];
          const byCode = new Map(quoteRows.map((q) => [String(q.focode || '').trim(), q]));

          for (const { row, parsed } of batch) {
            const q = byCode.get(String(row.shcode).trim());
            if (!q) continue;
            ensure(parsed.strike).call = {
              code: row.shcode,
              price: num(q.price),
              change: num(q.change),
              changePercent: num(q.diff),
              volume: num(q.volume),
              // The multi-quote TR carries price and volume only — no
              // open interest or greeks on this route.
              openInterest: null,
              iv: null,
            };
            callsFetched++;
          }
          if (i + BATCH < calls.length) await sleep(250);
        }
      }
    } catch (err) {
      // Calls are supplementary — a failure here still leaves a usable
      // put-side board rather than blanking the page.
    }

    const chain = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

    let callOI = 0, putOI = 0, callVol = 0, putVol = 0;
    let ivSum = 0, ivCount = 0;
    let maxCallOI = null, maxPutOI = null;

    for (const row of chain) {
      if (row.call) {
        callOI += row.call.openInterest || 0;
        callVol += row.call.volume || 0;
        if (row.call.iv) { ivSum += row.call.iv; ivCount++; }
        if (row.call.openInterest && (!maxCallOI || row.call.openInterest > maxCallOI.oi)) {
          maxCallOI = { strike: row.strike, oi: row.call.openInterest };
        }
      }
      if (row.put) {
        putOI += row.put.openInterest || 0;
        putVol += row.put.volume || 0;
        if (row.put.iv) { ivSum += row.put.iv; ivCount++; }
        if (row.put.openInterest && (!maxPutOI || row.put.openInterest > maxPutOI.oi)) {
          maxPutOI = { strike: row.strike, oi: row.put.openInterest };
        }
      }
    }

    res.status(200).json({
      asOf: new Date().toISOString(),
      // Open interest and greeks are only published on the put route, so
      // the frontend must not present OI-derived figures as covering both
      // sides.
      coverage: {
        putsHaveOpenInterest: true,
        callsHaveOpenInterest: false,
        callsPriced: callsFetched,
      },
      underlying: {
        price: spot,
        change: num(header.gmchange),
        changePercent: num(header.gmdiff),
        code: header.gmshcode,
        volume: num(header.gmvolume),
        daysToExpiry: num(header.jandatecnt),
        histVol: num(header.histimpv),
        callIv: num(header.cimpv),
        putIv: num(header.pimpv),
      },
      summary: {
        callOpenInterest: callOI || null,
        putOpenInterest: putOI,
        putCallOIRatio: callOI ? putOI / callOI : null,
        callVolume: callVol,
        putVolume: putVol,
        putCallVolumeRatio: callVol ? putVol / callVol : null,
        averageIv: ivCount ? ivSum / ivCount : null,
        maxCallOI,
        maxPutOI,
        strikeCount: chain.length,
      },
      chain,
    });
  } catch (err) {
    res.status(200).json({ error: true, message: String((err && err.message) || err) });
  }
};
