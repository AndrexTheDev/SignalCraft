import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__dexValidation = { DexEngine, refreshVenuePresentation }; DexEngine.fetchAll(["BTC"]).then(refreshVenuePresentation);').replace('    ME.startAuto();', '');
let browser;
describe('step62 / DEX data in the browser', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('hides malformed feeds, keeps valid matches, and removes them on failed refresh', async () => {
    const page = await freshPage(browser);
    let mode = 'bad';
    try {
      await page.evaluateOnNewDocument(() => localStorage.clear());
      await page.setRequestInterception(true);
      page.on('request', req => {
        const u = new URL(req.url());
        if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
        if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        let body;
        if (u.hostname === 'api.hyperliquid.xyz') body = { BTC: mode === 'good' ? '100' : [100] };
        else if (u.hostname === 'indexer.dydx.trade') body = { markets: { BTC: { status: 'ACTIVE', oraclePrice: mode === 'good' ? '100' : true } } };
        else if (u.hostname === 'api.dexscreener.com') {
          const sym = u.searchParams.get('q');
          const bad = { baseToken: { symbol: sym }, dexId: 'fake-dex', priceUsd: true, liquidity: { usd: [10000000] } };
          const real = { baseToken: { symbol: sym }, dexId: 'real-dex', priceUsd: '1.25e-7', liquidity: { usd: '100000' } };
          body = { pairs: mode === 'good' ? [bad, real] : [bad] };
        } else return req.abort().catch(() => {});
        return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__dexValidation && window.__dexValidation.DexEngine.startedAt !== null && !window.__dexValidation.DexEngine.busy);
      assert.equal(await page.evaluate(() => window.__dexValidation.DexEngine.dexCount()), 0);
      assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /DEX SEARCH UNAVAILABLE/);
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      assert.match(await page.$eval('#ftNodes', el => el.textContent), /0 DEX/);
      mode = 'good';
      await page.evaluate(async () => { await window.__dexValidation.DexEngine.fetchAll(["BTC"]); window.__dexValidation.refreshVenuePresentation(); });
      assert.equal(await page.evaluate(() => window.__dexValidation.DexEngine.dexCount()), 3);
      assert.match(await page.$eval('#dexTickerFeed', el => el.textContent), /BTC REAL-DEX ≈\$1\.25e-7/);
      assert.doesNotMatch(await page.$eval('#dexTickerFeed', el => el.textContent), /FAKE-DEX/);
      assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /UNVERIFIED SYMBOLS/);
      assert.match(await page.$eval('#dexTickerLabel', el => el.title), /identity is not verified/);
      mode = 'bad';
      await page.evaluate(async () => { await window.__dexValidation.DexEngine.fetchAll(["BTC"]); window.__dexValidation.refreshVenuePresentation(); });
      assert.equal(await page.evaluate(() => window.__dexValidation.DexEngine.dexCount()), 0);
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /DEX SEARCH UNAVAILABLE/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
