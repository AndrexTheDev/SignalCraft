import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const signals = Array.from({ length: 100 }, (_, i) => ({ ...seed[0], pair: 'TEST' + i + ' / USDT', id: `CLOCK-${i}`, modelVersion: 3, quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
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
        assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
        await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
        assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('fails closed at UTC midnight even when the expiry timer has not yet fired', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(signals => {
        window._now = Date.UTC(2025, 0, 1, 23, 59, 50);
        Date.now = () => window._now;
        const t = window._now;
        localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }));
      }, signals);
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = new URL(req.url());
        if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        if (url.pathname.endsWith('/ticker/24hr')) return;
        return req.abort().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
      await page.evaluate(() => { window._now = Date.UTC(2025, 0, 2); document.querySelector('[data-inspect-sig]').click(); });
      assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
