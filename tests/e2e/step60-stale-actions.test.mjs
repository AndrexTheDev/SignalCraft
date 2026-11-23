import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const html = read('app.html');
const seed = JSON.parse(extractArray(html, 'const SEED_SIGNALS ='));
const source = html.replace('    ME.refresh(false);', '    window.__actionsTest = { ME, seed: SEED_SIGNALS, signals: () => signalsData, copySignalLevels, renderShareCardCanvas };\n    ME.refresh(false);');
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(data => {
    localStorage.clear();
    window._now = Date.now(); Date.now = () => window._now;
    const t = window._now;
    const signals = Array.from({ length: 100 }, (_, i) => ({ ...data, pair: `SAFE${i} / USDT`, id: `SAFE-${i}`, timestamp: t, modelVersion: 3, entryPrice: 100, stopLoss: 90, targets: [110, 120], riskRewardRatio: '1:2.0', quantScore: 90, confluenceScore: 90, metrics: { ...data.metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals }));
    window._copies = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window._copies.push(text); return new Promise((resolve, reject) => { window._resolveCopy = resolve; window._rejectCopy = reject; }); } } });
    window._drawn = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window._drawn.push(String(text)); return fill.call(this, text, ...args); };
  }, seed[0]);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: source }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  return page;
}
describe('step60 / freshness during board actions', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const action of ['sentiment', 'chart', 'search', 'sort', 'refresh']) {
    it(`rejects an expired LIVE snapshot on ${action} even if timers have not run`, async () => {
      const page = await open();
      try {
        await page.evaluate(action => {
          window._now += 90000;
          if (action === 'sentiment') document.querySelector('[data-toggle-sentiment]').click();
          if (action === 'chart') document.querySelector('[data-toggle-chart]').click();
          if (action === 'search') { const e = document.getElementById('pairSearchInput'); e.value = 'SAFE0'; e.dispatchEvent(new Event('input', { bubbles: true })); }
          if (action === 'sort') { const e = document.getElementById('sortSelect'); e.value = 'risk'; e.dispatchEvent(new Event('change', { bubbles: true })); }
          if (action === 'refresh') document.querySelector('[data-refresh-sentiment]').click();
        }, action);
        assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
        assert.doesNotMatch(await page.$eval('#signalsGrid', el => el.textContent), /SAFE\d+ \/ USDT/);
        assert.equal(await page.$('.sentiment-drawer-panel.is-open'), null);
        assert.equal(await page.$('.chart-drawer-panel.is-open'), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('does not count an expired share action as an opened share', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { window._now += 90000; document.querySelector('[data-share-sig]').click(); });
      assert.equal(await page.$eval('#shareCardModalBackdrop', e => e.classList.contains('is-visible')), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('sc_shares')), null);
      assert.match(await page.$eval('#meBadge', e => e.textContent), /DEMO/);
    } finally { await page.close(); }
  });
  it('warns when an asynchronous clipboard write completes after the snapshot expires', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
      assert.match(await page.evaluate(() => window._copies[0]), /SAFE0 \/ USDT.*LIVE.*UTC/);
      await page.evaluate(() => { window._now += 90000; window._resolveCopy(); });
      await page.waitForFunction(() => /previous snapshot/i.test(document.getElementById('toastMessage').textContent));
      assert.match(await page.$eval('#meBadge', e => e.textContent), /DEMO/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('reports clipboard rejection even if the snapshot expired during the attempt', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
      await page.evaluate(() => { window._now += 90000; window._rejectCopy(new Error('denied')); });
      await page.waitForFunction(() => /Copy failed/i.test(document.getElementById('toastMessage').textContent));
      assert.match(await page.$eval('#meBadge', e => e.textContent), /DEMO/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not report a snapshot change for the same DEMO data applied again', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { const t = window.__actionsTest; t.ME.apply(t.seed, 'seed', t.seed[0].timestamp); document.querySelector('[data-copy-levels]').click(); t.ME.apply(t.seed, 'seed', t.seed[0].timestamp); window._resolveCopy(); });
      await page.waitForFunction(() => /copied to clipboard/i.test(document.getElementById('toastMessage').textContent));
      assert.doesNotMatch(await page.$eval('#toastMessage', e => e.textContent), /previous snapshot/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('localizes the warning for a delayed clipboard write in all languages', async () => {
    const warnings = { de: /vorherigen Snapshot/, en: /previous snapshot/, es: /instantánea anterior/, ar: /لقطة سابقة/, zh: /之前的快照/ };
    for (const [lang, warning] of Object.entries(warnings)) {
      const page = await open();
      try {
        await page.select('#langSelect', lang);
        await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
        await page.evaluate(() => { window._now += 90000; window._resolveCopy(); });
        await page.waitForFunction(pattern => new RegExp(pattern).test(document.getElementById('toastMessage').textContent), {}, warning.source);
        assert.match(await page.$eval('#meBadge', e => e.textContent), /DEMO/);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('resolves a retained setup reference to current board data and rejects non-board setups', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        const t = window.__actionsTest;
        window._old = { ...t.signals()[0] };
        const next = t.signals().map((s, i) => i ? { ...s } : { ...s, entryPrice: 200, stopLoss: 180, targets: [220, 240] });
        t.ME.apply(next, 'live', Date.now());
        t.copySignalLevels(window._old);
      });
      assert.match(await page.evaluate(() => window._copies[0]), /Entry: 200 USDT/);
      await page.evaluate(() => { window._resolveCopy(); window.__actionsTest.renderShareCardCanvas(window._old); });
      assert.ok(await page.evaluate(() => window._drawn.includes('200 USDT')));
      await page.keyboard.press('Escape');
      await page.evaluate(() => { const t = window.__actionsTest; window._copyCount = window._copies.length; t.copySignalLevels(t.signals()[10]); t.renderShareCardCanvas(t.signals()[10]); });
      assert.equal(await page.evaluate(() => window._copies.length), await page.evaluate(() => window._copyCount));
      assert.equal(await page.$eval('#shareCardModalBackdrop', e => e.classList.contains('is-visible')), false);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
