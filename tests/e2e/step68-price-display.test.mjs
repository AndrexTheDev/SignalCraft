import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(data => {
    localStorage.clear();
    const t = Date.now(), entry = 1.00000000000002, stop = 1.00000000000001, tp1 = 1.00000000000003, tp2 = 1.00000000000004;
    const signals = Array.from({ length: 100 }, (_, i) => ({
      ...data, pair: `SAFE${i} / USDT`, id: `SAFE-${i}`, timestamp: t, modelVersion: 3, entryPrice: entry, stopLoss: stop, targets: [tp1, tp2], riskRewardRatio: '1:2.0',
      quantScore: 90, confluenceScore: 90, metrics: { ...data.metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 },
      k24: Array.from({ length: 24 }, () => [entry, tp2, stop, tp1])
    }));
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals }));
    window._copied68 = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window._copied68.push(text); return Promise.resolve(); } } });
    window._drawn68 = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window._drawn68.push(String(text)); return fill.call(this, text, ...args); };
  }, seed[0]);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  return page;
}
const levels = ['1.00000000000001', '1.00000000000002', '1.00000000000003', '1.00000000000004'];
describe('step68 / precision through the terminal', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('preserves distinct cached levels on cards, chart tables, copied text and share canvas', async () => {
    const page = await open();
    try {
      const card = await page.$eval('#signalsGrid .signal-card', el => el.textContent);
      for (const value of levels) assert.ok(card.includes(value), `card ${value}`);
      await page.evaluate(() => document.querySelector('[data-toggle-chart]').click());
      const row = await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]:first-child td', cells => cells.map(x => x.textContent));
      assert.deepEqual(row, [levels[1], levels[3], levels[0], levels[2]]);
      await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
      await page.waitForFunction(() => window._copied68.length > 0);
      const copied = await page.evaluate(() => window._copied68[0]);
      for (const value of levels) assert.ok(copied.includes(value), `clipboard ${value}`);
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      const drawn = await page.evaluate(() => window._drawn68);
      for (const value of levels) assert.ok(drawn.some(s => s.includes(value)), `canvas ${value}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
