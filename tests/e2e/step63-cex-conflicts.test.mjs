import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS, liveTestCandles } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__cexConflicts = { ME, CexEngine, refreshVenuePresentation }; ME.refresh(false);').replace('    ME.startAuto();', '');
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  const candles = liveTestCandles(), symbols = JSON.parse(read('tests/fixtures/legacy-seed.json')).map(s => s.pair.split(' / ')[0]);
  await page.evaluateOnNewDocument(({candles, symbols}) => {
    localStorage.clear(); window._mode63 = 'mixed'; window._reverse63 = false;
    const original = window.fetch.bind(window);
    window.fetch = (input, opt) => {
      const u = String(input);
      if (u.includes('/ticker/24hr')) return Promise.resolve({ok:true,json:async()=>symbols.map(sym=>({symbol:sym+'USDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()}))});
      if (u.includes('/klines?')) return Promise.resolve({ok:true,json:async()=>candles});
      if (u.includes('api.kraken.com') && window._kraken86) {
        if (new URL(u).searchParams.has('pair')) return Promise.resolve({ ok: true, json: async () => ({ error: ['EQuery:Unknown asset pair'] }) });
        return Promise.resolve({ ok: true, json: async () => ({ error: [], result: { XBTUSDT: { c: ['101'] }, ETHUSDT: { c: ['11'] } } }) });
      }
      const reversed = window._reverse63, mode = window._mode63;
      if (u.includes('data-api.binance.vision/api/v3/ticker/price')) {
        const duplicate = [{ symbol: 'PEPEUSDT', price: '100' }, { symbol: 'PEPEUSDT', price: '200' }];
        if (reversed) duplicate.reverse();
        return Promise.resolve({ ok: true, json: async () => mode === 'mixed' ? [...duplicate, { symbol: 'BTCUSDT', price: '50' }] : duplicate });
      }
      if (u.includes('okx.com/api/v5/market/tickers')) return Promise.resolve({ ok: true, json: async () => ({ data: mode === 'mixed' ? [{ instId: 'PEPE-USDT', last: '100' }] : [{ instId: 'PEPE-USDT', last: '100' }, { instId: 'PEPE-USDT', last: '110' }] }) });
      if (u.includes('bybit.com/v5/market/tickers') && mode === 'mixed') return Promise.resolve({ ok: true, json: async () => ({ result: { list: [{ symbol: 'PEPEUSDT', lastPrice: '120' }] } }) });
      if (/^https?:/.test(u) && !u.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, opt);
    };
  }, {candles, symbols});
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__cexConflicts && document.querySelector('.signal-card') && window.__cexConflicts.CexEngine.online === 3 && !window.__cexConflicts.CexEngine.busy);
  return page;
}
describe('step63 / ambiguous CEX quotes in the browser', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('excludes ambiguous pair quotes but retains other pairs and explains the overall count', async () => {
    const page = await open();
    try {
      const data = await page.evaluate(() => window.__cexConflicts.CexEngine.data);
      assert.equal(data.PEPE.n, 2); assert.equal(data.PEPE.med, 110);
      assert.deepEqual(data.PEPE.venues, ['OKX', 'BYBIT']);
      assert.equal(data.BTC.n, 1); assert.deepEqual(data.BTC.venues, ['BINANCE']);
      assert.match(await page.$eval('#cexTickerLabel', el => el.textContent), /LIVE 3\/11/);
      assert.match(await page.$eval('#tickerScrollFeed', el => el.textContent), /PEPE ≈110 USDT \(2 venues\)/);
      assert.match(await page.$eval('#cexRadarNotice', el => el.textContent), /at least one accepted quote across the scanned universe/);
      await page.evaluate(async () => { window._reverse63 = true; await window.__cexConflicts.CexEngine.fetchAll(["PEPE", "BTC"]); window.__cexConflicts.refreshVenuePresentation(); });
      assert.equal(await page.evaluate(() => window.__cexConflicts.CexEngine.data.PEPE.med), 110);
      assert.equal(await page.evaluate(() => window.__cexConflicts.CexEngine.data.PEPE.n), 2);
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        await page.select('#langSelect', lang);
        assert.equal(await page.$eval('#cexRadarNotice', el => el.hidden), false);
        const coverage = { de: /Gesamtzahl umfasst Börsen/, en: /at least one accepted quote across the scanned universe/, es: /al menos una cotización válida/, ar: /سعر مقبول واحد على الأقل/, zh: /至少有一个有效报价/ };
        assert.match(await page.$eval('#cexRadarNotice', el => el.textContent), coverage[lang]);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('preserves Kraken quotes when the requested universe also contains an unlisted pair', async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        window._kraken86 = true; window._mode63 = 'all-bad';
        await window.__cexConflicts.CexEngine.fetchAll(['BTC', 'ETH', 'NOTLISTED']);
        return window.__cexConflicts.CexEngine.data;
      });
      assert.deepEqual(result.BTC.venues, ['KRAKEN']); assert.equal(result.BTC.med, 101);
      assert.deepEqual(result.ETH.venues, ['KRAKEN']); assert.equal(result.ETH.med, 11);
      assert.equal(result.NOTLISTED, undefined); assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not show a phantom radar if all available pair quotes are duplicated', async () => {
    const page = await open();
    try {
      await page.evaluate(async () => { window._mode63 = 'all-bad'; await window.__cexConflicts.CexEngine.fetchAll(["PEPE"]); window.__cexConflicts.refreshVenuePresentation(); });
      assert.equal(await page.evaluate(() => window.__cexConflicts.CexEngine.online), 0);
      assert.deepEqual(await page.evaluate(() => window.__cexConflicts.CexEngine.data), {});
      assert.equal(await page.$eval('#cexRadarNotice', el => el.hidden), true);
      assert.doesNotMatch(await page.$eval('#cexTickerLabel', el => el.textContent), /CEX USDT RADAR/);
      assert.doesNotMatch(await page.$eval('#tickerScrollFeed', el => el.textContent), /≈/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
