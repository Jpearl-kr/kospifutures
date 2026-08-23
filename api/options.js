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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'application/json');

  try {
    const token = await getToken();

    // Blank yyyymm gives the front-month board.
    const board = await callTR(token, 't2301', '/futureoption/market-data', {
      t2301InBlock: { yyyymm: req.query.yyyymm || '', gubun: '0' },
    });

    const header = board?.t2301OutBlock || {};
    const raw = board?.t2301OutBlock2 || [];

    // The board interleaves calls and puts across the same strikes. Group by
    // strike so the frontend can render a proper option chain.
    const byStrike = new Map();
    for (const r of raw) {
      const strike = num(r.actprice);
      if (strike === null) continue;
      if (!byStrike.has(strike)) byStrike.set(strike, { strike, call: null, put: null });
      const leg = {
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
        atm: r.atmgubun,
      };
      const entry = byStrike.get(strike);
      // A negative delta is a put; calls carry positive delta.
      if (leg.delta !== null && leg.delta < 0) entry.put = leg;
      else entry.call = leg;
    }

    const chain = Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);

    // Aggregate the numbers Korean derivatives desks actually watch.
    let callOI = 0, putOI = 0, callVol = 0, putVol = 0;
    let ivSum = 0, ivCount = 0;
    let maxCallOI = null, maxPutOI = null;

    for (const row of chain) {
      if (row.call) {
        callOI += row.call.openInterest || 0;
        callVol += row.call.volume || 0;
        if (row.call.iv) { ivSum += row.call.iv; ivCount++; }
        if (!maxCallOI || (row.call.openInterest || 0) > maxCallOI.oi) {
          maxCallOI = { strike: row.strike, oi: row.call.openInterest || 0 };
        }
      }
      if (row.put) {
        putOI += row.put.openInterest || 0;
        putVol += row.put.volume || 0;
        if (row.put.iv) { ivSum += row.put.iv; ivCount++; }
        if (!maxPutOI || (row.put.openInterest || 0) > maxPutOI.oi) {
          maxPutOI = { strike: row.strike, oi: row.put.openInterest || 0 };
        }
      }
    }

    res.status(200).json({
      asOf: new Date().toISOString(),
      underlying: {
        price: num(header.gmprice),
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
        callOpenInterest: callOI,
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
