import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const syms = seed.map(s => s.pair.split(' / ')[0]), DAY = 86400000;
function candles(scale = 1, bigVolume = false) {
  const start = Math.floor(Date.now() / DAY) * DAY - 199 * DAY; let price = 100 * scale;
  return Array.from({ length: 200 }, (_, i) => {
    const prog = i / 199, ret = 0.0045 + 0.016 * Math.sin(i * 0.9) + 0.0088 * Math.sin(i * 1.9 + 1.7) + 0.0048 * Math.sin(i * 3.1 + 0.4);
    const volume = bigVolume ? 1e307 : 20e6 + 100e6 * prog * prog, ratio = 0.44 + 0.22 * prog;
    price *= 1 + ret; const open = price / (1 + ret), high = Math.max(price, open) * 1.007, low = Math.min(price, open) * 0.993, t = start + i * DAY;
    return [t, open, high, low, price, 0, t + DAY - 1, volume, 0, 0, volume * ratio, 0];
  });
}
const instrumented = read('app.html').replace('    ME.refresh(false);', '    window.__auditSignals = () => signalsData; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser), normal = candles(), priceOverflow = candles(1e160), volumeOverflow = candles(1, true);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(syms.map(sym => ({ symbol: sym + 'USDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: Date.now() }))) }).catch(() => {});
    if (u.pathname.endsWith('/klines')) {
      const idx = syms.indexOf((u.searchParams.get('symbol') || '').replace(/USDT$/, ''));
      const isGlobal = u.hostname !== 'api.binance.us';
      let data = normal;
      if (mode === 'global-price' && isGlobal) data = priceOverflow;
      if (mode === 'many-price' && idx < 21) data = priceOverflow;
      if (mode === 'one-volume' && idx === 0) data = volumeOverflow;
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
    }
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 30000 });
  return page;
}
describe('step75 / LIVE factor overflow integration', { timeout: 90000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const mode of ['valid', 'global-price', 'one-volume', 'many-price']) {
    it(`handles ${mode} sources conservatively`, async () => {
      const page = await open(mode);
      try {
        const live = true;
        assert.match(await page.$eval('#meBadge', el => el.textContent), live ? /LIVE/ : /unavailable/i);
        const cache = await page.evaluate(() => ({ signals: window.__auditSignals(), stored: localStorage.getItem('signalcraft_live_v2') }));
        assert.equal(cache.stored, null);
        if (live) {
          assert.ok(cache); assert.equal(cache.signals.length, mode === 'one-volume' ? 119 : mode === 'many-price' ? 99 : 120);
          if (mode === 'many-price') assert.ok(cache.signals.every(s => !syms.slice(0,21).includes(s.pair.split(' / ')[0])));
          if (mode === 'one-volume') assert.ok(cache.signals.every(s => !s.pair.startsWith(syms[0] + ' / ')));
          if (mode === 'global-price') assert.ok(cache.signals.every(s => s.venue === 'BINANCE-US SPOT'));
        } else assert.equal(cache.signals.length, 0);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
