import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__radarFormat = { CexEngine, DexEngine, refreshVenuePresentation }; ME.apply(SEED_SIGNALS, "seed", ME_STAMP);').replace('    ME.startAuto();', '');
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear(); window._cexPrice66 = '1.00001';
    const original = window.fetch.bind(window);
    window.fetch = (input, opt) => {
      const u = String(input);
      if (u.includes('data-api.binance.vision/api/v3/ticker/price')) return Promise.resolve({ ok: true, json: async () => [{ symbol: 'PEPEUSDT', price: window._cexPrice66 }] });
      if (u.includes('api.dexscreener.com')) {
        const sym = new URL(u).searchParams.get('q');
        const vals = { PEPE: ['1.00001', '40001'], WIF: ['1.00004', '50001'], G: ['1e-100', '100000'] };
        return Promise.resolve({ ok: true, json: async () => ({ pairs: vals[sym] ? [{ baseToken: { symbol: sym }, dexId: 'test', priceUsd: vals[sym][0], liquidity: { usd: vals[sym][1] } }] : [] }) });
      }
      if (/^https?:/.test(u) && !u.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, opt);
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
  await page.waitForFunction(() => window.__radarFormat && window.__radarFormat.DexEngine.startedAt !== null && !window.__radarFormat.DexEngine.busy);
  await page.evaluate(async () => { await window.__radarFormat.DexEngine.fetchAll(['PEPE', 'WIF', 'G']); window.__radarFormat.refreshVenuePresentation(); });
  return page;
}
describe('step66 / radar numeric presentation', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows close DEX prices and sub-0.1M liquidity as approximate values rather than cents or zero', async () => {
    const page = await open();
    try {
      const feed = await page.$eval('#dexTickerFeed', el => el.textContent);
      assert.match(feed, /PEPE TEST ≈\$1\.00001 · ≈0\.040001M\$/);
      assert.match(feed, /WIF TEST ≈\$1\.00004 · ≈0\.050001M\$/);
      assert.match(feed, /G TEST ≈\$1e-100 · ≈0\.1M\$/);
      assert.equal(await page.$eval('#dexRadarNotice', el => el.hidden), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('renders extreme CEX medians compactly, without treating them as executable quotes', async () => {
    const page = await open();
    try {
      for (const [price, expected] of [['1e-100', /PEPE ≈1e-100 USDT/], ['1e100', /PEPE ≈1e\+100 USDT/]]) {
        await page.evaluate(async price => { window._cexPrice66 = price; await window.__radarFormat.CexEngine.fetchAll(['PEPE']); window.__radarFormat.refreshVenuePresentation(); }, price);
        const feed = await page.$eval('#tickerScrollFeed', el => el.textContent);
        assert.match(feed, expected); assert.ok(feed.length < 80, feed);
        assert.match(await page.$eval('#cexRadarNotice', el => el.textContent), /Not an executable quote/);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
