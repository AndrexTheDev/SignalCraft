import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const app = read('app.html');
const seed = JSON.parse(extractArray(app, 'const SEED_SIGNALS ='));
const source = app.replace('    ME.refresh(false);', '    window.__sourceTest = { ME, seed: SEED_SIGNALS, CexEngine, attachVenueData, renderSignals, signals: () => signalsData };\n    ME.refresh(false);');
let browser;
async function open(lang, live = false) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ live, data }) => {
    localStorage.clear();
    if (live) {
      const t = Date.now();
      const signals = Array.from({ length: 100 }, (_, i) => ({ ...data, pair: `SAFE${i} / USDT`, id: `SAFE-${i}`, venue: 'BINANCE-US SPOT', timestamp: t, modelVersion: 3, quantScore: 90, confluenceScore: 90, metrics: { ...data.metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
      localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals }));
    }
  }, { live, data: seed[0] });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: source }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (live && url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(want => document.getElementById('meBadge')?.textContent.includes(want ? 'LIVE' : 'DEMO'), {}, live);
  return page;
}
describe('step59 / snapshot time and market source provenance', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('uses the actual per-setup source when a Binance.US cache is restored', async () => {
    const page = await open('en', true);
    try {
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /LIVE.*\d{4}-\d\d-\d\d.*UTC/);
      assert.doesNotMatch(await page.$eval('#meBadge', el => el.title), /Binance Spot API/);
      assert.match(await page.$eval('.signal-card [data-model-source]', el => el.textContent), /BINANCE-US SPOT/);
      await page.evaluate(() => { const t = window.__sourceTest; t.CexEngine.data.SAFE0 = { n: 1, med: 1, venues: ['OKX'] }; t.CexEngine.startedAt = Date.now(); t.attachVenueData(); t.renderSignals(); });
      assert.match(await page.$eval('.signal-card [data-model-source]', el => el.textContent), /BINANCE-US SPOT/);
      assert.doesNotMatch(await page.$eval('.signal-card [data-model-source]', el => el.textContent), /OKX/);
      await page.click('[data-inspect-sig]');
      const sourceText = await page.$eval('#dossierBody [data-dossier-source]', el => el.textContent);
      assert.match(sourceText, /BINANCE-US SPOT/);
      assert.doesNotMatch(sourceText, /Binance Spot API|Mirror/);
      assert.match(await page.$eval('#dossierBody [data-dossier-method]', el => el.textContent), /\d{4}-\d\d-\d\d.*UTC/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('never invents a model source for unrecognized cached labels', async () => {
    const page = await open('en', true);
    try {
      await page.evaluate(() => {
        const t = window.__sourceTest;
        t.ME.apply(t.signals().map(s => ({ ...s, venue: '<img src=x onerror=alert(1)>' })), 'live', Date.now());
      });
      assert.match(await page.$eval('.signal-card [data-model-source]', el => el.textContent), /Model source: —/);
      assert.equal(await page.$('.signal-card [data-model-source] img'), null);
      await page.click('[data-inspect-sig]');
      assert.match(await page.$eval('#dossierBody [data-dossier-source]', el => el.textContent), /Model source: —/);
      assert.equal(await page.$('#dossierBody [data-dossier-source] img'), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('updates the visible snapshot label immediately when the language changes', async () => {
    const page = await open('en');
    try {
      await page.select('#langSelect', 'de');
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /DEMO · historischer Snapshot:.*UTC/);
      await page.select('#langSelect', 'zh');
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /DEMO · 历史快照：.*UTC/);
      assert.match(await page.$eval('#ftNodes', el => el.textContent), /雷达/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('updates the time, source and method honestly on DEMO fallback', async () => {
    const page = await open('en', true);
    try {
      await page.evaluate(() => window.__sourceTest.ME.apply(window.__sourceTest.seed, 'seed', window.__sourceTest.seed[0].timestamp));
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /DEMO.*historical.*\d{4}-\d\d-\d\d.*UTC/i);
      assert.match(await page.$eval('#ftNodes', el => el.textContent), /Radar.*0\/11.*0 DEX/i);
      assert.doesNotMatch(await page.$eval('#ftNodes', el => el.textContent), /Live market data/i);
      await page.click('[data-inspect-sig]');
      assert.match(await page.$eval('#dossierBody [data-dossier-source]', el => el.textContent), /DEMO/i);
      const method = await page.$eval('#dossierBody [data-dossier-method]', el => el.textContent);
      assert.match(method, /historical.*not current/i);
      assert.doesNotMatch(method, /Every value is computed automatically/i);
      assert.match(method, /\d{4}-\d\d-\d\d.*UTC/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('shows a localized full UTC timestamp and DEMO method in all languages', async () => {
    for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
      const page = await open(lang);
      try {
        assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /DEMO.*\d{4}-\d\d-\d\d.*UTC/);
        await page.click('[data-inspect-sig]');
        assert.match(await page.$eval('#dossierBody [data-dossier-method]', el => el.textContent), /\d{4}-\d\d-\d\d.*UTC/);
        assert.match(await page.$eval('#dossierBody [data-dossier-source]', el => el.textContent), /DEMO/);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
