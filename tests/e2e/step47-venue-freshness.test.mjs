import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html');
const seed = JSON.parse(extractArray(source, 'const SEED_SIGNALS ='));
const html = source.replace('    ME.refresh(false);', "    window.__venueAge = { ME, seed: SEED_SIGNALS, CexEngine, DexEngine, signals: () => signalsData }; ME.apply(SEED_SIGNALS, 'seed', ME_STAMP);");
let browser;
async function pageWithVenues() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(seed => {
    window._now = Date.UTC(2025, 0, 1, 12);
    Date.now = () => window._now;
    window._holdCex = false;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (url.includes('data-api.binance.vision/api/v3/ticker/price')) {
        if (window._holdCex) return new Promise(() => {});
        return Promise.resolve({ ok: true, json: async () => seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', price: '123' })) });
      }
      if (url.includes('api.dexscreener.com')) {
        const sym = new URL(url).searchParams.get('q');
        return Promise.resolve({ ok: true, json: async () => ({ pairs: [{ baseToken: { symbol: sym }, dexId: 'example-dex', priceUsd: '42', liquidity: { usd: 100000 } }] }) });
      }
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, options);
    };
  }, seed);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('dexTickerFeed')?.textContent.includes('EXAMPLE-DEX') && document.getElementById('cexTickerLabel')?.textContent.includes('LIVE 1/11'));
  return page;
}
describe('step47 / venue freshness after browser pauses', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('removes expired venue data on visibility change even if browser timers were delayed', async () => {
    const page = await pageWithVenues();
    try {
      assert.ok(await page.evaluate(() => window.__venueAge.signals().some(s => s.cexN === 1)));
      const after = await page.evaluate(() => {
        window._now += 90000;
        window.__venueAge.ME._last = window._now;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return { cex: window.__venueAge.CexEngine.online, dex: window.__venueAge.DexEngine.dexCount(), attached: window.__venueAge.signals().some(s => s.cexN), cexLabel: document.getElementById('cexTickerLabel').textContent, dexFeed: document.getElementById('dexTickerFeed').textContent };
      });
      assert.equal(after.cex, 0); assert.equal(after.dex, 0); assert.equal(after.attached, false);
      assert.doesNotMatch(after.cexLabel, /LIVE 1\/11/); assert.equal(after.dexFeed, '–');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('clears inherited venue metadata when the same DEMO seed objects are reapplied', async () => {
    const page = await pageWithVenues();
    try {
      assert.ok(await page.evaluate(() => window.__venueAge.seed.some(s => s.cexN)));
      const after = await page.evaluate(() => {
        window._holdCex = true;
        const t = window.__venueAge;
        t.ME.apply(t.seed, 'seed', Date.now());
        return { seedAttached: t.seed.some(s => s.cexN), cardText: document.querySelector('#signalsGrid .signal-card')?.textContent, cex: t.CexEngine.online };
      });
      assert.equal(after.seedAttached, false); assert.equal(after.cex, 0);
      assert.doesNotMatch(after.cardText, /1 CEX/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('also removes expired venues on a UI rerender without waiting for the visibility event', async () => {
    const page = await pageWithVenues();
    try {
      await page.evaluate(() => { window._now += 90000; });
      await page.select('#langSelect', 'de');
      assert.equal(await page.evaluate(() => window.__venueAge.CexEngine.online), 0);
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      assert.equal(await page.evaluate(() => window.__venueAge.signals().some(s => s.cexN)), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
