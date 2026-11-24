import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);', '    ME.CANDLE_HEDGE_MS = 50; ME.REFRESH_DEADLINE = 800; window.__hedge89 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ mode, candles }) => {
    window.__requests89 = []; window.__globalSignals89 = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href), us = url.hostname === 'api.binance.us';
      if (url.pathname.endsWith('/ticker/24hr')) {
        const rows = ['BTC', 'ETH'].map(sym => ({ symbol: sym + 'USDT', quoteVolume: us ? '120000000' : '200000000', priceChangePercent: '3', closeTime: Date.now() }));
        return Promise.resolve({ ok: true, json: async () => rows });
      }
      if (url.pathname.endsWith('/klines')) {
        window.__requests89.push({ host: url.hostname, symbol: url.searchParams.get('symbol') });
        if (!us && mode === 'slow-global') { window.__globalSignals89.push(options.signal); return new Promise(() => {}); }
        return Promise.resolve({ ok: true, json: async () => candles });
      }
      if (url.origin !== location.origin) return Promise.reject(new Error('offline'));
      return real(input, options);
    };
  }, { mode, candles: liveTestCandles() });
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({ status: 200, contentType: 'text/html', body: app }).catch(() => {}) : req.continue().catch(() => {}));
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__hedge89 && !window.__hedge89.ME.busy, { timeout: 10000 });
  return page;
}
describe('step89 / candle hedge and venue provenance', { timeout: 30000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('retains only matching US ticker and candle data when global candles stall', async () => {
    const page = await open('slow-global');
    try {
      const result = await page.evaluate(() => ({ mode: window.__hedge89.ME.status.mode, signals: window.__hedge89.signals(), requests: window.__requests89, aborted: window.__globalSignals89.every(s => s.aborted) }));
      assert.equal(result.mode, 'live'); assert.equal(result.signals.length, 2); assert.equal(result.aborted, true);
      assert.ok(result.signals.every(s => s.venue === 'BINANCE-US SPOT' && s.gateMetrics.volMio === 120));
      assert.equal(result.requests.filter(r => r.host === 'api.binance.us').length, 2);
      assert.match(await page.$eval('#snapshotInfo', e => e.textContent), /Evaluated: 2\/120/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps the preferred fast global source without extra US candle requests', async () => {
    const page = await open('fast-global');
    try {
      const result = await page.evaluate(() => ({ signals: window.__hedge89.signals(), requests: window.__requests89 }));
      assert.equal(result.signals.length, 2);
      assert.ok(result.signals.every(s => s.venue === 'BINANCE SPOT' && s.gateMetrics.volMio === 200));
      assert.equal(result.requests.filter(r => r.host === 'api.binance.us').length, 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
