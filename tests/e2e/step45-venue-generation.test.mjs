import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', "    window.__venueTest = { ME, seed: SEED_SIGNALS, CexEngine, DexEngine }; ME.apply(SEED_SIGNALS, 'seed', ME_STAMP);").replace('    ME.startAuto();', '');
let browser;
async function instrumented(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(mode => {
    window._cex = []; window._dex = []; window._dexMode = 'old';
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (url.includes('data-api.binance.vision/api/v3/ticker/price')) {
        if (mode === 'cex') return new Promise(resolve => window._cex.push(rows => resolve({ ok: true, json: async () => rows })));
        return Promise.resolve({ ok: true, json: async () => [{ symbol: 'GUSDT', price: '7' }, { symbol: 'WIFUSDT', price: '8' }] });
      }
      if (url.includes('api.dexscreener.com')) {
        const symbol = new URL(url).searchParams.get('q');
        const response = dex => ({ ok: true, json: async () => ({ pairs: [{ baseToken: { symbol }, dexId: dex, priceUsd: '42', liquidity: { usd: 100000 } }] }) });
        if (mode === 'dex' && window._dexMode === 'old') return new Promise(resolve => window._dex.push(() => resolve(response('old-dex'))));
        if (mode === 'dex') return Promise.resolve(response('new-dex'));
      }
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, options);
    };
  }, mode);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  return page;
}
describe('step45 / venue results and snapshot replacement', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('ignores an old CEX response and coalesces rapid snapshot changes into the latest request', async () => {
    const page = await instrumented('cex');
    try {
      await page.waitForFunction(() => window._cex.length === 1);
      await page.evaluate(() => {
        const t = window.__venueTest;
        t.ME.apply([t.seed[1]], 'seed', Date.now());
        t.ME.apply([t.seed[2]], 'seed', Date.now());
        window._cex[0]([{ symbol: 'GUSDT', price: '111' }]);
      });
      await page.waitForFunction(() => window._cex.length === 2);
      assert.deepEqual(await page.evaluate(() => window.__venueTest.CexEngine.data), {});
      assert.doesNotMatch(await page.$eval('#tickerScrollFeed', el => el.textContent), /111/);
      await page.evaluate(() => window._cex[1]([{ symbol: 'GUSDT', price: '222' }]));
      await page.waitForFunction(() => window.__venueTest.CexEngine.data.G?.med === 222);
      assert.match(await page.$eval('#tickerScrollFeed', el => el.textContent), /G ≈222 USDT/);
      assert.equal(await page.evaluate(() => window._cex.length), 2);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('clears the previous CEX view and ignores a delayed DEX wire after snapshot replacement', async () => {
    const page = await instrumented('dex');
    try {
      await page.waitForFunction(() => window._dex.length > 0 && window.__venueTest.CexEngine.online === 1);
      await page.evaluate(() => window._dex.forEach(resolve => resolve()));
      await page.waitForFunction(() => document.getElementById('dexTickerFeed')?.textContent.includes('OLD-DEX'));
      assert.match(await page.$eval('#tickerScrollFeed', el => el.textContent), /USDT/);
      const cleared = await page.evaluate(() => {
        const t = window.__venueTest;
        window._dex = [];
        t.ME.apply([t.seed[1]], 'seed', Date.now());
        return { cex: t.CexEngine.data, dex: document.getElementById('dexTickerFeed').textContent, ticker: document.getElementById('tickerScrollFeed').textContent };
      });
      assert.deepEqual(cleared.cex, {}); assert.equal(cleared.dex, '–');
      assert.doesNotMatch(cleared.ticker, /USDT \(1 venues\)/);
      await page.waitForFunction(() => window._dex.length > 0);
      await page.evaluate(() => {
        const t = window.__venueTest;
        t.ME.apply([t.seed[2]], 'seed', Date.now());
        window._dexMode = 'new'; window._dex.forEach(resolve => resolve());
      });
      await page.waitForFunction(() => document.getElementById('dexTickerFeed')?.textContent.includes('NEW-DEX'));
      assert.doesNotMatch(await page.$eval('#dexTickerFeed', el => el.textContent), /OLD-DEX/);
      assert.ok(await page.evaluate(() => window.__venueTest.DexEngine.wire.every(x => x.sym === 'G')));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
