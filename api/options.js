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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
  res.setHeader('Content-Type', 'application/json');

  try {
    const token = await getToken();

    // The board TR returns the put side only, whatever gubun is passed —
    // it still gives us the strike ladder, the underlying header, and
    // full put analytics in one call.
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
        theoryPrice: num(r.theoryprice),
        timeValue: num(r.timevl),
        delta: num(r.delt),
        gamma: num(r.gama),
        vega: num(r.vega),
        theta: num(r.ceta),
        rho: num(r.rhox),
      };
    }

    // Call symbols mirror put symbols exactly apart from the prefix:
    // B0… is the call, C0… the put, same expiry and strike. So the call
    // for any strike on the board is derivable without a master lookup.
    // t2111 then prices each one, open interest and greeks included.
    const strikesNearSpot = Array.from(byStrike.values())
      .filter((r) => r.put && r.put.code)
      .sort((a, b) => Math.abs(a.strike - (spot || 0)) - Math.abs(b.strike - (spot || 0)))
      .slice(0, Number(req.query.depth || 21));

    let callsFetched = 0;
    await Promise.all(
      strikesNearSpot.map(async (row, i) => {
        // t2111 allows 10 calls/sec; stagger so a wide chain stays inside it.
        await sleep(i * 120);
        const callCode = 'B0' + String(row.put.code).slice(2);
        try {
          const q = await callTR(token, 't2111', '/futureoption/market-data', {
            t2111InBlock: { focode: callCode },
          });
          const o = q?.t2111OutBlock;
          if (!o || num(o.price) === null) return;
          row.call = {
            code: callCode,
            price: num(o.price),
            change: num(o.change),
            changePercent: num(o.diff),
            volume: num(o.volume),
            openInterest: num(o.mgjv),
            openInterestChange: num(o.mgjvdiff),
            iv: num(o.impv),
            theoryPrice: num(o.theoryprice),
            delta: num(o.delt),
          };
          callsFetched++;
        } catch (err) {
          // One bad strike shouldn't blank the chain.
        }
      })
    );

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
      coverage: {
        callsHaveOpenInterest: callsFetched > 0,
        putsHaveOpenInterest: true,
        callsPriced: callsFetched,
        // Ratios and max pain only span the strikes we priced calls for,
        // not the full board.
        callStrikesCovered: strikesNearSpot.length,
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
