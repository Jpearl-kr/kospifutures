const REST_BASE = 'https://openapi.ls-sec.co.kr:8080';

// KOSPI 200's sector code in LS's 업종 (sector/index) namespace.
const KOSPI200 = '101';
const KOSPI = '001';
const KOSDAQ = '301';

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
  // Expire our copy a little early so a request never rides an expiring token.
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

    // Current index snapshot — price, OHLC, advance/decline, trading value.
    const quote = await callTR(token, 't1511', '/indtp/market-data', {
      t1511InBlock: { upcode: KOSPI200 },
    });
    const q = quote?.t1511OutBlock || {};

    // Daily history — gubun1:'2', gubun2:'1' is the combo this TR accepts;
    // carries per-day OHLC plus foreign/institution net flows.
    const hist = await callTR(token, 't1514', '/indtp/market-data', {
      t1514InBlock: {
        upcode: KOSPI200,
        gubun1: '2',
        gubun2: '1',
        cts_date: '',
        cnt: 20,
        rate_gbn: '0',
      },
    });
    const histRows = (hist?.t1514OutBlock1 || []).map((r) => ({
      date: r.date,
      close: num(r.jisu),
      open: num(r.openjisu),
      high: num(r.highjisu),
      low: num(r.lowjisu),
      change: num(r.change),
      changePercent: num(r.diff),
      volume: num(r.volume),
      tradingValue: num(r.value1),
      advancing: num(r.up),
      declining: num(r.down),
      unchanged: num(r.unchg),
      totalIssues: num(r.totjo),
      foreignNet: num(r.frgsvolume),
      instNet: num(r.orgsvolume),
    }));

    res.status(200).json({
      asOf: new Date().toISOString(),
      index: {
        name: 'KOSPI 200',
        price: num(q.pricejisu),
        change: num(q.change),
        changePercent: num(q.diffjisu),
        open: num(q.openjisu),
        high: num(q.highjisu),
        low: num(q.lowjisu),
        prevClose: num(q.jniljisu),
        volume: num(q.volume),
        tradingValue: num(q.value),
        openTime: q.opentime,
        highTime: q.hightime,
        lowTime: q.lowtime,
        advancing: num(q.upjo),
        declining: num(q.downjo),
        unchanged: num(q.unchgjo),
        yearHigh: num(q.yhjisu),
        yearHighDate: q.yhjday,
        yearLow: num(q.yljisu),
        yearLowDate: q.yljday,
      },
      history: histRows,
    });
  } catch (err) {
    res.status(200).json({ error: true, message: String((err && err.message) || err) });
  }
};
