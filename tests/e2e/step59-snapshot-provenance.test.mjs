import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const app = read('app.html');
const source = app.replace('    ME.refresh(false);', '    window.__sourceTest = { ME, CexEngine, attachVenueData, renderSignals, signals: () => signalsData };\n    ME.refresh(false);');
let browser;
async function open(lang) {
  const page = await freshPage(browser);
  await stubMarket(page, {appHtml:source, klines:liveTestCandles(), globalTicker:{missing:true}});
  await page.goto(BASE + '/app.html?lang=' + lang, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('.signal-card') && /LIVE/.test(document.getElementById('meBadge').textContent));
  return page;
}
describe('step59 / snapshot time and market source provenance', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('uses the actual per-setup source when data was fetched from Binance.US', async () => {
    const page = await open('en', true);
    try {
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /LIVE.*\d{4}-\d\d-\d\d.*UTC/);
      assert.doesNotMatch(await page.$eval('#meBadge', el => el.title), /Binance Spot API/);
      assert.match(await page.$eval('.signal-card [data-model-source]', el => el.textContent), /BINANCE-US SPOT/);
      await page.evaluate(() => { const t = window.__sourceTest; t.CexEngine.data[t.signals()[0].pair.split(' / ')[0]] = { n: 1, med: 1, venues: ['OKX'] }; t.CexEngine.startedAt = Date.now(); t.attachVenueData(); t.renderSignals(); });
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
  it('never invents a model source for unrecognized source labels', async () => {
    const page = await open('en', true);
    try {
      await page.evaluate(() => {
        const t = window.__sourceTest;
        t.ME.apply(t.signals().map(s => ({ ...s, venue: '<img src=x onerror=alert(1)>' })), 'live', t.ME.status.when);
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
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /LIVE · Snapshot:.*UTC/);
      await page.select('#langSelect', 'zh');
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /LIVE · 快照：.*UTC/);
      assert.match(await page.$eval('#ftNodes', el => el.textContent), /雷达/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('removes time, source and details when live data becomes unavailable', async () => {
    const page = await open('en');
    try {
      await page.click('[data-inspect-sig]');
      await page.evaluate(() => window.__sourceTest.ME.apply([], 'unavailable', null));
      assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /unavailable/i);
      assert.match(await page.$eval('#ftNodes', el => el.textContent), /Radar.*0\/11.*0 DEX/i);
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('shows a localized full UTC timestamp and live method in all languages', async () => {
    for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
      const page = await open(lang);
      try {
        assert.match(await page.$eval('#snapshotInfo', el => el.textContent), /LIVE.*\d{4}-\d\d-\d\d.*UTC/);
        await page.click('[data-inspect-sig]');
        assert.match(await page.$eval('#dossierBody [data-dossier-method]', el => el.textContent), /\d{4}-\d\d-\d\d.*UTC/);
        assert.match(await page.$eval('#dossierBody [data-dossier-source]', el => el.textContent), /BINANCE-US SPOT/);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
