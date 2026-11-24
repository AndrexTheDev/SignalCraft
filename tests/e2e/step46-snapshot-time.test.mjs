import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const signals = Array.from({ length: 100 }, (_, i) => ({ ...seed[0], pair: 'TEST' + i + ' / USDT', id: `CLOCK-${i}`, modelVersion: 4, quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
let browser;
async function oldCachePage(version, mismatch) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ signals, version, mismatch }) => {
    const t = Date.now();
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version, t, signals: signals.map(s => ({ ...s, timestamp: t - (mismatch ? 1 : 0) })) }));
  }, { signals, version, mismatch });
  await stubMarket(page);
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  return page;
}
describe('step46 / browser snapshot timing and cache migration', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const [version, mismatch] of [[5, false], [6, false], [7, false], [8, false], [9, true]]) {
    it(`does not restore cache version ${version} with ${mismatch ? 'inconsistent' : 'legacy'} timestamps`, async () => {
      const page = await oldCachePage(version, mismatch);
      try {
        await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
        assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
        assert.equal((await page.$$('.signal-card')).length, 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('removes a pre-midnight snapshot at the next visible tick without user interaction', async () => {
    const page = await freshPage(browser);
    try {
      const midnight = Math.floor(Date.now() / 86400000) * 86400000 + 86400000;
      await page.evaluateOnNewDocument(now => {
        window._now = now; Date.now = () => window._now;
        const interval = window.setInterval.bind(window);
        window.setInterval = (fn, ms, ...args) => { if (ms === 30000) window._marketTick46 = fn; return interval(fn, ms, ...args); };
      }, midnight - 10000);
      const offset = midnight - 10000 - Date.now();
      const appHtml = read('app.html').replace('    ME.refresh(false);', '    window.__clock46 = ME; ME.refresh(false);');
      await stubMarket(page, { appHtml, klines: liveTestCandles(), globalTicker: {timeOffset:offset}, usTicker:{timeOffset:offset} });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__clock46 && window.__clock46.status.mode === 'live' && !window.__clock46.busy);
      assert.ok((await page.$$('.signal-card')).length > 0);
      await page.evaluate(now => { window.__clock46.busy = true; window._now = now; window._marketTick46(); }, midnight);
      assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('fails closed at UTC midnight even when the expiry timer has not yet fired', async () => {
    const page = await freshPage(browser);
    try {
      const midnight = Math.floor(Date.now() / 86400000) * 86400000 + 86400000;
      await page.evaluateOnNewDocument(now => { window._now = now; Date.now = () => window._now; }, midnight - 10000);
      const offset = midnight - 10000 - Date.now();
      await stubMarket(page, { klines: liveTestCandles(), globalTicker: {timeOffset:offset}, usTicker:{timeOffset:offset} });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
      await page.evaluate(() => { window._now = Math.floor(window._now / 86400000) * 86400000 + 86400000; document.querySelector('[data-inspect-sig]').click(); });
      assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
