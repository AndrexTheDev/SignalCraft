import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__fng87 = SentimentEngine; ME.refresh(false);');
let browser;
describe('step87 / automatic index recovery in the browser', { timeout: 30000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('retries only when due and visible, then accepts fresh data without a manual refresh', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => {
        window.__calls87 = 0; window.__available87 = false; window.__ticks87 = [];
        const realInterval = window.setInterval.bind(window), realFetch = window.fetch.bind(window);
        window.setInterval = (fn, ms, ...args) => { if (ms === 30000) window.__ticks87.push(fn); return realInterval(fn, ms, ...args); };
        window.fetch = (input, options) => {
          const url = String(input);
          if (url.includes('api.alternative.me/fng/')) {
            window.__calls87++;
            if (!window.__available87) return Promise.reject(new Error('offline'));
            return Promise.resolve({ ok: true, json: async () => ({ data: [{ value: '42', value_classification: 'Fear', timestamp: String(Math.floor(Date.now() / 1000)) }] }) });
          }
          if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
          return realFetch(input, options);
        };
      });
      await page.setRequestInterception(true);
      page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {}) : req.continue().catch(() => {}));
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__fng87 && !window.__fng87._fngController && window.__ticks87.length);
      assert.equal(await page.evaluate(() => window.__calls87), 1);
      assert.match(await page.$eval('#globalFngBadge', e => e.textContent), /F&G –/);
      await page.evaluate(() => { window.__available87 = true; window.__ticks87[0](); });
      assert.equal(await page.evaluate(() => window.__calls87), 1);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        window.__fng87._fngLastAttempt = Date.now() - window.__fng87._fngRefreshInterval - 1;
        window.__ticks87[0]();
      });
      assert.equal(await page.evaluate(() => window.__calls87), 1);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.querySelector('#globalFngBadge').textContent.includes('Index 42'));
      assert.equal(await page.evaluate(() => window.__calls87), 2);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
