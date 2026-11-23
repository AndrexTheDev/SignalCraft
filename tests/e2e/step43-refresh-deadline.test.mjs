import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
let browser;
describe('step43 / complete market refresh deadline', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('cancels stalled candle requests, restores DEMO and permits a fresh attempt', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(seed => {
        window._candles = [];
        const timer = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 60000 ? 300 : ms, ...args);
        const original = window.fetch.bind(window);
        window.fetch = (url, options) => {
          url = String(url);
          if (url.includes('/ticker/24hr')) return Promise.resolve({ ok: true, json: async () => seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: Date.now() })) });
          if (url.includes('/klines?')) {
            window._candles.push({ url, signal: options.signal });
            // Simulate a transport that ignores abort and never returns headers.
            return new Promise(() => {});
          }
          if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
          return original(url, options);
        };
      }, seed);
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window._candles.length === 6 && document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 5000 });
      await page.waitForFunction(() => window._candles.length === 6 && window._candles.every(x => x.signal.aborted) && !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 5000 });
      assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => window._candles.length === 12 && window._candles.every(x => x.signal.aborted) && !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 5000 });
      assert.equal(await page.$eval('#btnRefreshSentimentGlobal', el => el.hasAttribute('aria-busy')), false);
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /DEMO snapshot active/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
