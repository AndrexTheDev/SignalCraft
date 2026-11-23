import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__dexRank = { DexEngine, refreshVenuePresentation }; ME.apply(SEED_SIGNALS, "seed", ME_STAMP);').replace('    ME.startAuto();', '');
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear(); window._mode64 = 'none'; window._pending64 = {};
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (url.includes('api.dexscreener.com') && window._mode64 === 'manual') {
        const sym = new URL(url).searchParams.get('q');
        return new Promise(resolve => { window._pending64[sym] = rows => resolve({ ok: true, json: async () => ({ pairs: rows }) }); });
      }
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, options);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__dexRank && window.__dexRank.DexEngine.startedAt !== null && !window.__dexRank.DexEngine.busy);
  return page;
}
describe('step64 / DEX discovery order in the browser', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('does not publish ambiguous equal-liquidity leaders and clears the previous result', async () => {
    const page = await open();
    try {
      for (const mode of ['clear', 'ambiguous', 'reverse']) {
        await page.evaluate(async mode => {
          window._mode64 = 'manual'; window._pending64 = {};
          const task = window.__dexRank.DexEngine.fetchAll(['BTC']);
          const row = (dex, price, liq) => ({ baseToken: { symbol: 'BTC' }, dexId: dex, priceUsd: price, liquidity: { usd: liq } });
          const rows = [row('first', '10', '100000'), row('second', '20', mode === 'clear' ? '90000' : '100000')];
          if (mode === 'reverse') rows.reverse();
          await Promise.resolve(); window._pending64.BTC(rows); await task; window.__dexRank.refreshVenuePresentation();
        }, mode);
        if (mode === 'clear') {
          assert.equal(await page.evaluate(() => window.__dexRank.DexEngine.dexCount()), 1);
          assert.match(await page.$eval('#dexTickerFeed', el => el.textContent), /BTC FIRST ≈\$10/);
          assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /UNVERIFIED SYMBOLS/);
        } else {
          assert.equal(await page.evaluate(() => window.__dexRank.DexEngine.dexCount()), 0);
          assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
          assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /DEX SEARCH UNAVAILABLE/);
        }
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('orders the fourteen visible results by exact liquidity regardless of completion order', async () => {
    const page = await open();
    try {
      const results = [];
      for (const reverse of [false, true]) {
        results.push(await page.evaluate(async reverse => {
          window._mode64 = 'manual'; window._pending64 = {};
          const syms = Array.from({ length: 16 }, (_, i) => 'S' + String(i).padStart(2, '0'));
          const task = window.__dexRank.DexEngine.fetchAll(syms);
          await Promise.resolve();
          for (const sym of reverse ? syms.slice().reverse() : syms) {
            const n = Number(sym.slice(1));
            window._pending64[sym]([{ baseToken: { symbol: sym }, dexId: 'test', priceUsd: '1', liquidity: { usd: String(100000 + n) } }]);
          }
          await task; window.__dexRank.refreshVenuePresentation();
          return { order: window.__dexRank.DexEngine.wire.map(x => x.sym), feed: document.getElementById('dexTickerFeed').textContent };
        }, reverse));
      }
      assert.deepEqual(results[0], results[1]);
      assert.deepEqual(results[0].order, Array.from({ length: 16 }, (_, i) => 'S' + String(15 - i).padStart(2, '0')));
      const displayed = results[0].feed.split('   |   ');
      assert.equal(displayed.length, 14); assert.match(displayed[0], /^S15 /); assert.match(displayed[13], /^S02 /);
      assert.match(await page.$eval('#dexTickerLabel', el => el.title), /identity is not verified/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
