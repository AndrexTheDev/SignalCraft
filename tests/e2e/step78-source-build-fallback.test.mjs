import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const app = read('app.html');
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const symbols = seed.map(s => s.pair.split(' / ')[0]), DAY = 86400000;
function candles(broken = false) {
  const start = Math.floor(Date.now() / DAY) * DAY - 199 * DAY; let price = 100;
  return Array.from({ length: 200 }, (_, i) => {
    const prog = i / 199, ret = .0045 + .016 * Math.sin(i * .9) + .0088 * Math.sin(i * 1.9 + 1.7) + .0048 * Math.sin(i * 3.1 + .4);
    const volume = 20e6 + 100e6 * prog * prog, ratio = .44 + .22 * prog;
    price *= 1 + ret; const open = price / (1 + ret), t = start + i * DAY;
    const high = Math.max(price, open) * (broken ? 4 : 1.007), low = Math.min(price, open) * (broken ? .1 : .993);
    return [t, open, high, low, price, 0, t + DAY - 1, volume, 0, 0, volume * ratio, 0];
  });
}
let browser;
async function run(mode) {
  const page = await freshPage(browser), normal = candles(), invalidPlan = candles(true);
  // Simulate a future build regression which returns a non-finite displayed field
  // instead of throwing: a single bad projection must not poison the snapshot.
  const instrumented = app.replace('    ME.refresh(false);', `    const originalBuild78 = ME.build;
    ME.build = function(sym, sec, k, src, ticker) {
      const result = originalBuild78.call(this, sym, sec, k, src, ticker);
      if ((${JSON.stringify(mode)} === 'primary-projection' && src === 'binance') ||
          (${JSON.stringify(mode)} === 'one-projection' && sym === ${JSON.stringify(symbols[0])})) result.metrics.volX = Infinity;
      return result;
    };
    window.__auditSignals = () => signalsData; ME.refresh(false);`);
  let usRequests = 0;
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(symbols.map(symbol => ({ symbol: symbol + 'USDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: Date.now() }))) }).catch(() => {});
    if (u.pathname.endsWith('/klines')) {
      const i = symbols.indexOf((u.searchParams.get('symbol') || '').replace(/USDT$/, '')), us = u.hostname === 'api.binance.us';
      if (us) usRequests++;
      const affected = mode === 'primary-fails' || (mode === 'one-missing' && i === 0) || (mode === 'many-missing' && i < 21);
      const broken = mode !== 'valid' && (affected && (!us || mode !== 'primary-fails'));
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(broken ? invalidPlan : normal) }).catch(() => {});
    }
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 30000 });
  return { page, usRequests };
}
describe('step78 / source fallback after uncomputable trade plans', { timeout: 90000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const mode of ['valid', 'primary-fails', 'one-missing', 'many-missing', 'primary-projection', 'one-projection']) {
    it(`handles ${mode} with per-source construction`, async () => {
      const { page, usRequests } = await run(mode);
      try {
        const live = true;
        assert.match(await page.$eval('#meBadge', e => e.textContent), live ? /LIVE/ : /unavailable/i);
        const cache = await page.evaluate(() => ({ signals: window.__auditSignals(), stored: localStorage.getItem('signalcraft_live_v2') }));
        assert.equal(cache.stored, null);
        if (live) {
          assert.ok(cache);
          assert.equal(cache.signals.length, (mode === 'one-missing' || mode === 'one-projection') ? 119 : mode === 'many-missing' ? 99 : 120);
          if (mode === 'many-missing') assert.ok(cache.signals.every(s => !symbols.slice(0,21).includes(s.pair.split(' / ')[0])));
          if ((mode === 'primary-fails' || mode === 'primary-projection')) assert.ok(cache.signals.every(s => s.venue === 'BINANCE-US SPOT'));
          if ((mode === 'one-missing' || mode === 'one-projection')) assert.ok(cache.signals.every(s => !s.pair.startsWith(symbols[0] + ' / ')));
        } else assert.equal(cache.signals.length, 0);
        assert.equal(usRequests, (mode === 'primary-fails' || mode === 'primary-projection') ? 120 : (mode === 'one-missing' || mode === 'one-projection') ? 1 : mode === 'many-missing' ? 21 : 0);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
