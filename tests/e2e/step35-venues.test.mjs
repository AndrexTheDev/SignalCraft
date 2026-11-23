import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
let browser;

describe('step35 / venue refresh in browser', { timeout: 90000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('labels symbol-only DEX search, never makes a DEX comparison, and clears failed feeds', async () => {
    const page = await freshPage(browser);
    let active = true;
    try {
      await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = new URL(req.url());
        if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        if (active && url.hostname === 'data-api.binance.vision' && url.pathname === '/api/v3/ticker/price') {
          const rows = seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', price: '5' }));
          return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }).catch(() => {});
        }
        if (active && url.hostname === 'api.dexscreener.com') {
          const symbol = url.searchParams.get('q');
          const body = { pairs: [{ baseToken: { symbol }, dexId: 'example-dex', priceUsd: '123', liquidity: { usd: 100000 } }] };
          return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
        }
        return req.abort().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.getElementById('dexTickerLabel')?.textContent.includes('UNVERIFIED SYMBOLS'), { timeout: 20000 });
      assert.match(await page.$eval('#dexTickerFeed', el => el.textContent), /EXAMPLE-DEX/);
      assert.match(await page.$eval('#dexTickerLabel', el => el.title), /identity is not verified/);
      assert.match(await page.$eval('#cexTickerLabel', el => el.textContent), /LIVE 1\/11/);
      await page.select('#langSelect', 'de');
      assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /NICHT VERIFIZIERT/);
      await page.select('#langSelect', 'en');
      assert.match(await page.$eval('#dexTickerLabel', el => el.textContent), /UNVERIFIED SYMBOLS/);
      await page.click('[data-inspect-sig]');
      await page.waitForSelector('#dossierModalBackdrop.is-visible');
      assert.doesNotMatch(await page.$eval('#dossierModalBackdrop', el => el.textContent), /DEX COMPARISON/);
      await page.keyboard.press('Escape');
      active = false;
      await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => /DEX SEARCH UNAVAILABLE/.test(document.getElementById('dexTickerLabel')?.textContent || ''), { timeout: 20000 });
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      assert.doesNotMatch(await page.$eval('#cexTickerLabel', el => el.textContent), /LIVE 1\/11/);
      assert.doesNotMatch(await page.$eval('#signalsGrid article.signal-card', el => el.textContent), /1 CEX/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
