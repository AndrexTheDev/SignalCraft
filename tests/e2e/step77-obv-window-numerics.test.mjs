import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const syms = seed.map(s => s.pair.split(' / ')[0]), DAY = 86400000;
function candles(spike) {
  const start = Math.floor(Date.now() / DAY) * DAY - 199 * DAY; let price = 100;
  return Array.from({ length: 200 }, (_, i) => {
    const prog = i / 199, ret = 0.0045 + 0.016 * Math.sin(i * 0.9) + 0.0088 * Math.sin(i * 1.9 + 1.7) + 0.0048 * Math.sin(i * 3.1 + 0.4);
    const volume = spike && i === 10 ? 1e100 : 20e6 + 100e6 * prog * prog, ratio = 0.44 + 0.22 * prog;
    price *= 1 + ret; const open = price / (1 + ret), high = Math.max(price, open) * 1.007, low = Math.min(price, open) * 0.993, t = start + i * DAY;
    return [t, open, high, low, price, 0, t + DAY - 1, volume, 0, 0, volume * ratio, 0];
  });
}
let browser;
async function obtain(spike) {
  const page = await freshPage(browser), data = candles(spike);
  try {
    await page.evaluateOnNewDocument(() => localStorage.clear());
    await page.setRequestInterception(true);
    page.on('request', req => {
      const u = new URL(req.url());
      if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
      if (u.pathname.endsWith('/ticker/24hr')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(syms.map(sym => ({ symbol: sym + 'USDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: Date.now() }))) }).catch(() => {});
      if (u.pathname.endsWith('/klines')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
      return req.abort().catch(() => {});
    });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 30000 });
    assert.match(await page.$eval('#meBadge', e => e.textContent), /LIVE/);
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('signalcraft_live_v2')));
    assert.equal(cache.signals.length, 120);
    assert.deepEqual(page._pageErrors, []);
    return cache;
  } finally { await page.close(); }
}
describe('step77 / LIVE OBV old-volume independence', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('retains the same scores and OBV directions for a historical spike outside the window', async () => {
    const normal = await obtain(false), spiked = await obtain(true);
    const factors = cache => cache.signals.map(s => ({ pair: s.pair, score: s.quantScore, obv: s.metrics.obvDir, volume: s.metrics.comp.vo }));
    assert.ok(normal.signals.every(s => s.metrics.obvDir === 'up'));
    assert.deepEqual(factors(spiked), factors(normal));
    assert.equal(spiked.version, 9);
  });
});
