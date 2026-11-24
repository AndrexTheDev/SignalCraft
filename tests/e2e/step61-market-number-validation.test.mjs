import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const syms = seed.map(s => s.pair.split(' / ')[0]);
const DAY = 86400000;
function strongCandles() {
  const t0 = Math.floor(Date.now() / DAY) * DAY - 199 * DAY;
  let price = 100;
  return Array.from({ length: 200 }, (_, t) => {
    const prog = t / 199, ret = 0.0045 + 0.016 * Math.sin(t * 0.9) + 0.0088 * Math.sin(t * 1.9 + 1.7) + 0.0048 * Math.sin(t * 3.1 + 0.4);
    const qv = 20e6 + 100e6 * prog * prog, ratio = 0.44 + 0.22 * prog;
    price = Math.max(1, price * (1 + ret));
    const o = price / (1 + ret), h = Math.max(price, o) * 1.007, l = Math.min(price, o) * 0.993;
    return [t0 + t * DAY, +o.toFixed(6), +h.toFixed(6), +l.toFixed(6), +price.toFixed(6), +(qv / price).toFixed(4), t0 + t * DAY + DAY - 1, +qv.toFixed(2), 1000 + t, +((qv * ratio) / price).toFixed(4), +(qv * ratio).toFixed(2), 0];
  });
}
const app = read('app.html').replace('    ME.refresh(false);', '    window.__market61 = {signals: () => signalsData}; ME.refresh(false);');
let browser;
async function run(mode) {
  const page = await freshPage(browser), data = strongCandles();
  let candlesRequested = 0, tickerRequested = 0;
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({status:200,contentType:'text/html',body:app}).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) {
      tickerRequested++;
      const rows = syms.flatMap((sym, i) => {
        const row = { symbol: sym + 'USDT', quoteVolume: mode === 'bad-tickers' ? [20000000] : '20000000', priceChangePercent: '1', closeTime: Date.now() };
        return (mode === 'duplicates' || (mode === 'global-duplicates' && u.hostname !== 'api.binance.us')) && i < 21 ? [row, { ...row, quoteVolume: '30000000' }] : [row];
      });
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }).catch(() => {});
    }
    if (u.pathname.endsWith('/klines')) {
      candlesRequested++;
      const idx = syms.indexOf((u.searchParams.get('symbol') || '').replace(/USDT$/, ''));
      const broken = (mode === 'bad-candles' && idx < 21) || (mode === 'one-bad' && idx === 0);
      const klines = broken ? data.map((r, i) => i === 20 ? r.map((v, j) => j === 4 ? [v] : v) : r) : data;
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(klines) }).catch(() => {});
    }
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 30000 });
  return { page, get candlesRequested() { return candlesRequested; }, get tickerRequested() { return tickerRequested; } };
}
describe('step61 / malformed market input integration', { timeout: 90000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('does not paint a structurally valid old cache while the refresh is pending', async () => {
    for (const version of [6, 7, 8, 9]) {
      const page = await freshPage(browser);
      const instrumented = read('app.html').replace('    ME.refresh(false);', '    window.__cacheShape = isLiveCache; window.__oldCache = JSON.parse(localStorage.getItem("signalcraft_live_v2")); ME.refresh(false);');
      try {
        await page.evaluateOnNewDocument(({ data, version }) => {
          localStorage.clear(); const t = Date.now();
          const signals = Array.from({ length: 100 }, (_, i) => ({ ...data, id: `V${i}`, pair: `SAFE${i} / USDT`, timestamp: t, live: true, modelVersion: 4, quantScore: 90, confluenceScore: 90, metrics: { ...data.metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
          localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version, t, signals }));
        }, { data: seed[0], version });
        await page.setRequestInterception(true);
        page.on('request', req => {
          const u = new URL(req.url());
          if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
          if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
          if (u.pathname.endsWith('/ticker/24hr')) return;
          return req.abort().catch(() => {});
        });
        await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.getElementById('btnRefreshSentimentGlobal').disabled);
        assert.equal(await page.evaluate(() => window.__cacheShape(window.__oldCache)), true);
        assert.equal((await page.$$('.signal-card')).length, 0);
        assert.doesNotMatch(await page.$eval('#meBadge', e => e.textContent), /LIVE|DEMO/);
        assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  for (const mode of ['valid', 'one-bad', 'global-duplicates', 'bad-tickers', 'duplicates', 'bad-candles']) {
    it(`handles ${mode} data without inventing LIVE setups`, async () => {
      const h = await run(mode);
      try {
        const validLive = mode !== 'bad-tickers';
        assert.equal(h.tickerRequested, mode === 'bad-tickers' ? 3 : 2);
        assert.match(await h.page.$eval('#meBadge', el => el.textContent), validLive ? /LIVE/ : /unavailable/i);
        const cache = await h.page.evaluate(() => ({signals:window.__market61.signals(), stored:localStorage.getItem('signalcraft_live_v2')}));
        assert.equal(cache.stored,null);
        if (validLive) {
          assert.ok(cache);
          assert.equal(cache.signals.length, mode === 'one-bad' ? 119 : ['duplicates', 'bad-candles'].includes(mode) ? 99 : 120);
          assert.match(await h.page.$eval('#snapshotInfo', e => e.textContent), new RegExp('Evaluated: ' + cache.signals.length + '/120'));
          if (mode === 'duplicates' || mode === 'bad-candles') assert.ok(cache.signals.every(x => !syms.slice(0,21).includes(x.pair.split(' / ')[0])));
          if (mode === 'one-bad') assert.ok(cache.signals.every(x => !x.pair.startsWith(syms[0] + ' / ')));
          if (mode === 'global-duplicates') assert.equal(cache.signals.filter(x => x.venue === 'BINANCE-US SPOT').length, 21);
        } else assert.equal(cache.signals.length, 0);
        if (mode === 'bad-tickers') assert.equal(h.candlesRequested, 0);
        if (mode === 'duplicates') assert.equal(h.candlesRequested, 99);
        assert.deepEqual(h.page._pageErrors, []);
      } finally { await h.page.close(); }
    });
  }
});
