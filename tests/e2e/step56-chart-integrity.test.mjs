import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html').replace('    ME.refresh(false);', '    window.__chartTest = { ME, signals: () => signalsData, renderSignals };\n    ME.refresh(false);');
let browser;
async function open(lang = 'en', brokenCanvas = false) {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(broken => {
    localStorage.clear();
    if (broken) HTMLCanvasElement.prototype.getContext = () => null;
  }, brokenCanvas);
  await stubMarket(page, { appHtml: source, klines: liveTestCandles() });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.signal-card') && !document.getElementById('btnRefreshSentimentGlobal').disabled);
  return page;
}
async function chart(page) {
  await page.click('[data-toggle-chart]');
  await page.waitForFunction(() => { const p = document.querySelector('.chart-drawer-panel.is-open'); return p && p.querySelector('[data-chart-status]').textContent !== 'Loading chart …' && !p.querySelector('[data-chart-status]').textContent.includes('geladen'); });
}
describe('step56 / candle charts and accessible data', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows a labeled LIVE chart and 24 accessible OHLC rows', async () => {
    const page = await open();
    try {
      await chart(page);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open .chart-viewport-box', el => el.hidden), false);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open canvas', el => el.getAttribute('aria-hidden')), 'true');
      assert.match(await page.$eval('.chart-drawer-panel.is-open', el => el.textContent), /LIVE[\s\S]*UTC daily candles[\s\S]*still open/);
      await page.click('.chart-drawer-panel.is-open summary');
      assert.equal(await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]', rows => rows.length), 24);
      assert.match(await page.$eval('.chart-drawer-panel.is-open thead', el => el.textContent), /Open \(USDT\).*High \(USDT\).*Low \(USDT\).*Close \(USDT\)/s);
      await page.focus('.chart-drawer-panel.is-open summary');
      await page.evaluate(() => window.__chartTest.renderSignals());
      assert.equal(await page.$eval('.chart-drawer-panel.is-open details', el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement.matches('summary[data-chart-table-toggle]')), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not expose a chart when live data is unavailable', async () => {
    const page = await freshPage(browser);
    try {
      await stubMarket(page);
      await page.goto(BASE + '/app.html?lang=en', {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => /unavailable/i.test(document.getElementById('meBadge').textContent));
      assert.equal(await page.$('[data-toggle-chart]'), null);
      assert.equal(await page.$('[data-candle-row]'), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('reports canvas failure in every language and keeps the numeric table available', async () => {
    const expected = { de: 'Chart nicht verfügbar', en: 'Chart unavailable', es: 'Gráfico no disponible', ar: 'الرسم غير متاح', zh: '图表不可用' };
    for (const [lang, text] of Object.entries(expected)) {
      const page = await open(lang, true);
      try {
        await page.click('[data-toggle-chart]');
        await page.waitForFunction(text => document.querySelector('.chart-drawer-panel.is-open [data-chart-status]')?.textContent.includes(text), {}, text);
        assert.equal(await page.$eval('.chart-drawer-panel.is-open .chart-viewport-box', el => el.hidden), true);
        assert.equal(await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]', rows => rows.length), 24);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('replaces chart data on dataset change and does not retain stale pixels when data is invalid', async () => {
    const page = await open();
    try {
      await chart(page);
      const firstBefore = await page.$eval('.chart-drawer-panel.is-open [data-candle-row] td', el => el.textContent);
      const result = await page.evaluate(() => {
        const p = document.querySelector('.chart-drawer-panel.is-open');
        const id = p.id.slice('chart-panel-'.length);
        const list = window.__chartTest.signals().map(x => x.id === id ? { ...x, k24: x.k24.map(row => row.map(value => value * 2)) } : x);
        window.__chartTest.ME.apply(list, 'live', window.__chartTest.ME.status.when);
        return id;
      });
      await page.waitForFunction(id => !document.getElementById('viewport-' + id).hidden, {}, result);
      assert.equal(await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]', rows => rows.length), 24);
      const old = await page.$eval('.chart-drawer-panel.is-open [data-candle-row] td', el => el.textContent);
      await page.evaluate(id => {
        const list = window.__chartTest.signals().map(x => x.id === id ? { ...x, k24: [] } : x);
        window.__chartTest.ME.apply(list, 'live', window.__chartTest.ME.status.when);
      }, result);
      assert.equal(await page.$('.chart-drawer-panel.is-open'), null);
      assert.equal(await page.$('[data-candle-row]'), null);
      assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
      assert.notEqual(old, firstBefore);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
