import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);', '    window.__recovery88 = { ME, SentimentEngine }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ mode, candles }) => {
    window.__mode88 = mode; window.__tickers88 = []; window.__held88 = []; window.__fngAvailable88 = false; window.__fngCalls88 = 0;
    const real = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href), state = window.__mode88;
      if (url.hostname === 'api.alternative.me') {
        window.__fngCalls88++;
        if (!window.__fngAvailable88) return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ value: '42', value_classification: 'Fear', timestamp: String(Math.floor(Date.now() / 1000)) }] }) });
      }
      if (url.pathname.endsWith('/ticker/24hr')) {
        window.__tickers88.push(url.hostname);
        if (state === 'hold') return new Promise((resolve, reject) => window.__held88.push(reject));
        if (state === 'transition') { window.__mode88 = 'live'; return Promise.reject(new Error('last offline endpoint')); }
        if (state !== 'live') return Promise.reject(new Error('offline'));
        return Promise.resolve({ ok: true, json: async () => [{ symbol: 'BTCUSDT', quoteVolume: '120000000', priceChangePercent: '3', closeTime: Date.now() }] });
      }
      if (url.pathname.endsWith('/klines')) return Promise.resolve({ ok: true, json: async () => candles });
      if (url.origin !== location.origin) return Promise.reject(new Error('offline'));
      return real(input, options);
    };
  }, { mode, candles: liveTestCandles() });
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({ status: 200, contentType: 'text/html', body: app }).catch(() => {}) : req.continue().catch(() => {}));
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__recovery88);
  return page;
}
describe('step88 / recovery after network hints', { timeout: 30000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('retries an unavailable board after online without inventing signals or flooding requests', async () => {
    const page = await open('offline');
    try {
      await page.waitForFunction(() => !window.__recovery88.ME.busy && window.__recovery88.ME.status.mode === 'unavailable');
      const initial = await page.evaluate(() => window.__tickers88.length);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForFunction(n => !window.__recovery88.ME.busy && window.__tickers88.length > n, {}, initial);
      assert.equal((await page.$$('.signal-card')).length, 0);
      const afterRetry = await page.evaluate(() => window.__tickers88.length);
      await page.evaluate(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('online')); });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await page.evaluate(() => window.__tickers88.length), afterRetry);
      await page.evaluate(() => { window.__mode88 = 'live'; window.__recovery88.ME._onlineRetryAt -= 16000; window.dispatchEvent(new Event('online')); });
      await page.waitForFunction(() => window.__recovery88.ME.status.mode === 'live' && !window.__recovery88.ME.busy);
      assert.equal((await page.$$('.signal-card')).length, 1);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('defers recovery while hidden and processes it when visible', async () => {
    const page = await open('offline');
    try {
      await page.waitForFunction(() => !window.__recovery88.ME.busy);
      const before = await page.evaluate(() => window.__tickers88.length);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        window.__mode88 = 'live'; window.dispatchEvent(new Event('online'));
      });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await page.evaluate(() => window.__tickers88.length), before);
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => window.__recovery88.ME.status.mode === 'live' && !window.__recovery88.ME.busy);
      assert.equal((await page.$$('.signal-card')).length, 1);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('retries the missing index after online without duplicate rapid attempts', async () => {
    const page = await open('offline');
    try {
      await page.waitForFunction(() => !window.__recovery88.ME.busy && !window.__recovery88.SentimentEngine._fngController);
      assert.equal(await page.evaluate(() => window.__fngCalls88), 1);
      await page.evaluate(() => {
        window.__fngAvailable88 = true;
        window.__recovery88.SentimentEngine._fngLastAttempt -= 16000;
        window.dispatchEvent(new Event('online'));
      });
      await page.waitForFunction(() => document.querySelector('#globalFngBadge').textContent.includes('Index 42'));
      await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('online')); });
      assert.equal(await page.evaluate(() => window.__fngCalls88), 2);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not lose an online hint received during a still-failing refresh', async () => {
    const page = await open('hold');
    try {
      await page.waitForFunction(() => window.__held88.length === 2 && window.__recovery88.ME.busy);
      await page.evaluate(() => {
        window.__mode88 = 'transition'; window.dispatchEvent(new Event('online'));
        window.__held88.forEach(reject => reject(new Error('offline')));
      });
      await page.waitForFunction(() => window.__recovery88.ME.status.mode === 'live' && !window.__recovery88.ME.busy, { timeout: 10000 });
      assert.equal((await page.$$('.signal-card')).length, 1);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
