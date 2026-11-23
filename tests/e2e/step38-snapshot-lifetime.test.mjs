import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const appHtml = read('app.html');
const seed = JSON.parse(extractArray(appHtml, 'const SEED_SIGNALS ='));
// Expose closure-scoped state only in this intercepted test response.
const instrumentedApp = appHtml.replace('    ME.refresh(false);', '    window.__snapshotTest = { ME, seed: SEED_SIGNALS, stamp: ME_STAMP, signals: () => signalsData };\n    ME.refresh(false);');
const fixture = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: `SIG-TEST-${i}`, pair: (i ? 'TEST' + i : 'TEST') + ' / USDT', timestamp: Date.now(),
  quantScore: 90, confluenceScore: 90, modelVersion: 3,
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
let browser;
async function livePage(lang = 'en') {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(signals => {
    localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }))(Date.now())));
  }, fixture);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumentedApp }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  return page;
}

describe('step38 / signal snapshot lifetime', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('closes and clears a dossier on a live replacement even when the ID is unchanged', async () => {
    const page = await livePage();
    try {
      await page.click('[data-inspect-sig]');
      assert.match(page.url(), /sig=/);
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.signals().map(s => ({...s, entryPrice: s.entryPrice * 2})), 'live', Date.now()));
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(await page.$eval('#dossierBody', el => el.textContent.trim()), '');
      assert.doesNotMatch(page.url(), /sig=/);
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /data changed/i);
      assert.ok(await page.evaluate(() => document.activeElement.matches('[data-inspect-sig], #signalsGrid')));
      await page.click('[data-inspect-sig]');
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('invalidates a share preview on expiry, preserving an unrelated nested dialog and focus', async () => {
    const page = await livePage();
    try {
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled), false);
      await page.evaluate(() => document.getElementById('btnOpenDonation').click());
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.seed, 'seed', window.__snapshotTest.stamp));
      assert.equal(await page.$eval('#shareCardModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled && el.onclick === null), true);
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.classList.contains('is-visible')), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('expires automatically and also fails closed on a click when browser timers are delayed', async () => {
    const page = await livePage();
    try {
      await page.click('[data-inspect-sig]');
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.signals(), 'live', Date.now() - window.__snapshotTest.ME.TTL + 2000));
      await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
      await page.waitForFunction(() => /DEMO/.test(document.getElementById('meBadge')?.textContent || ''), { timeout: 5000 });
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.signals(), 'live', Date.now()));
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      await page.evaluate(() => { window.__snapshotTest.ME.status.when = Date.now() - window.__snapshotTest.ME.TTL; document.getElementById('btnDownloadCardPng').click(); });
      assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
      assert.equal(await page.$eval('#shareCardModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('clears previous pixels and disables image download when canvas is unavailable', async () => {
    const page = await livePage();
    try {
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled), false);
      await page.click('#btnCloseShareCardModal');
      await page.evaluate(() => { const canvas = document.getElementById('shareCardCanvas'); window.originalShareContext = canvas.getContext.bind(canvas); canvas.getContext = () => null; });
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled), true);
      assert.equal(await page.$eval('#btnShareCardDirect', el => el.disabled), false);
      assert.match(await page.$eval('#shareCardDataState', el => el.textContent), /Preview unavailable/);
      assert.equal(await page.evaluate(() => window.originalShareContext('2d').getImageData(100, 100, 1, 1).data[3]), 0);
      await page.click('#btnCloseShareCardModal');
      await page.evaluate(() => { document.getElementById('shareCardCanvas').getContext = () => ({ fillRect() { throw new Error('drawing failed'); } }); });
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      assert.match(await page.$eval('#shareCardDataState', el => el.textContent), /Preview unavailable/);
      assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled && el.onclick === null), true);
      assert.equal(await page.evaluate(() => window.originalShareContext('2d').getImageData(100, 100, 1, 1).data[3]), 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('replaces changed IDs while leaving an unchanged demo snapshot open', async () => {
    const page = await livePage();
    try {
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.signals().map(s => ({...s, id: s.id + '-NEW'})), 'live', Date.now()));
      assert.equal(await page.$eval('#shareCardModalBackdrop', el => el.classList.contains('is-visible')), false);
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.seed, 'seed', window.__snapshotTest.stamp));
      await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
      await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.seed, 'seed', window.__snapshotTest.stamp));
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('labels exported canvas and copied levels with snapshot mode and UTC time in every language', async () => {
    for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
      const page = await livePage(lang);
      try {
        await page.evaluate(() => {
          window.drawnText = [];
          const original = CanvasRenderingContext2D.prototype.fillText;
          CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.drawnText.push(String(text)); return original.call(this, text, ...args); };
          Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedSnapshot = text; } }, configurable: true });
        });
        await page.click('[data-copy-levels]');
        await page.waitForFunction(() => window.copiedSnapshot);
        assert.match(await page.evaluate(() => window.copiedSnapshot), /\| LIVE · \d{4}-\d\d-\d\d .* UTC/);
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.match(await page.$eval('#shareCardDataState', el => el.textContent), /\d{4}-\d\d-\d\d .* UTC/);
        assert.ok(await page.evaluate(() => window.drawnText.some(t => /^LIVE · .+ · \d{4}-.* UTC$/.test(t))));
        await page.evaluate(() => window.__snapshotTest.ME.apply(window.__snapshotTest.seed, 'seed', window.__snapshotTest.stamp));
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.match(await page.$eval('#shareCardDataState', el => el.textContent), /DEMO/);
        assert.ok(await page.evaluate(() => window.drawnText.some(t => /^DEMO · .+ · \d{4}-.* UTC$/.test(t))));
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
