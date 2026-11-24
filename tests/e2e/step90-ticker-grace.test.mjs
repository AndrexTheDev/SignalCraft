import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);', '    ME.TICKER_GRACE_MS = 60; ME.REFRESH_DEADLINE = 800; window.__grace90 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ mode, candles }) => {
    window.__tickerRequests90 = []; window.__slow90 = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href), us = url.hostname === 'api.binance.us';
      if (url.pathname.endsWith('/ticker/24hr')) {
        window.__tickerRequests90.push(url.hostname);
        const ticker = [{ symbol: (us ? 'ETH' : 'BTC') + 'USDT', quoteVolume: '120000000', priceChangePercent: '3', closeTime: Date.now() }];
        if ((mode === 'slow-global' && !us) || ((mode === 'slow-us' || mode === 'bad-candles') && us)) {
          return new Promise(resolve => window.__slow90.push({ signal: options.signal, resolve }));
        }
        if (mode === 'both' && us) return new Promise(resolve => setTimeout(() => resolve({ok:true,json:async()=>ticker}), 20));
        return Promise.resolve({ok:true,json:async()=>ticker});
      }
      if (url.pathname.endsWith('/klines')) return Promise.resolve({ok:true,json:async()=>mode === 'bad-candles' ? candles.slice(1) : candles});
      if (url.origin !== location.origin) return Promise.reject(new Error('offline'));
      return real(input, options);
    };
  }, { mode, candles: liveTestCandles() });
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({status:200,contentType:'text/html',body:app}).catch(() => {}) : req.continue().catch(() => {}));
  await page.goto(BASE + '/app.html?lang=en', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__grace90 && !window.__grace90.ME.busy, {timeout:10000});
  return page;
}
describe('step90 / bounded ticker wait and transparent partial results', {timeout:30000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const [mode, pair, venue, skipped] of [['slow-global', 'ETH / USDT', 'BINANCE-US SPOT', 'Binance'], ['slow-us', 'BTC / USDT', 'BINANCE SPOT', 'Binance.US']]) {
    it(`publishes only validated ${venue} data when ${mode} is skipped`, async () => {
      const page = await open(mode);
      try {
        const result = await page.evaluate(() => ({ status:window.__grace90.ME.status, signals:window.__grace90.signals(), aborted:window.__slow90.every(x => x.signal.aborted) }));
        assert.equal(result.status.mode, 'live'); assert.equal(result.signals.length, 1); assert.equal(result.signals[0].pair, pair); assert.equal(result.signals[0].venue, venue); assert.ok(result.aborted);
        assert.match(await page.$eval('#snapshotInfo', e => e.textContent), new RegExp('Evaluated: 1/120.*Source omitted'));
        await page.evaluate(() => window.__slow90.forEach(x => x.resolve({ok:true,json:async()=>[{symbol:'BTCUSDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()}]})));
        await new Promise(resolve => setTimeout(resolve, 80));
        assert.equal(await page.evaluate(() => window.__grace90.signals().length), 1);
        for (const lang of ['de','es','ar','zh','en']) {
          await page.select('#langSelect', lang);
          assert.match(await page.$eval('#snapshotDiagnostics', e => e.textContent), new RegExp(skipped.replace('.', '\\.')));
        }
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('keeps both completed sources inside the grace window', async () => {
    const page = await open('both');
    try {
      const result = await page.evaluate(() => window.__grace90.signals().map(s => s.pair));
      assert.deepEqual(result.sort(), ['BTC / USDT','ETH / USDT']);
      assert.doesNotMatch(await page.$eval('#snapshotInfo', e => e.textContent), /Slow ticker source omitted/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('still explains the omitted source when candidate histories are invalid', async () => {
    const page = await open('bad-candles');
    try {
      assert.equal(await page.evaluate(() => window.__grace90.ME.status.reason), 'pairs');
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.match(await page.$eval('#snapshotDiagnostics', e => e.textContent), /Slow ticker source omitted: Binance.US/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
