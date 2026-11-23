import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);', '    window.__precision68 = {ME, signals: () => signalsData}; ME.refresh(false);');
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    window._copied68 = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => { window._copied68.push(text); return Promise.resolve(); } } });
    window._drawn68 = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window._drawn68.push(String(text)); return fill.call(this, text, ...args); };
  });
  await stubMarket(page, {appHtml:app, klines:liveTestCandles()});
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  await page.evaluate(() => { const t = window.__precision68, e=1.00000000000002, sl=1.00000000000001, a=1.00000000000003, b=1.00000000000004; t.ME.apply(t.signals().map(s=>({...s,entryPrice:e,stopLoss:sl,targets:[a,b],riskRewardRatio:'1:2.0', k24:Array.from({length:24},()=>[e,b,sl,a])})), 'live', t.ME.status.when); });
  return page;
}
const levels = ['1.00000000000001', '1.00000000000002', '1.00000000000003', '1.00000000000004'];
describe('step68 / precision through the terminal', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('preserves distinct live levels on cards, chart tables, copied text and share canvas', async () => {
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
