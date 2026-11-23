import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html').replace('    ME.refresh(false);', '    window.__chartTest = { ME, seed: SEED_SIGNALS, renderSignals };\n    ME.refresh(false);');
let browser;
async function open(lang = 'en', brokenCanvas = false) {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(broken => {
    localStorage.clear();
    if (broken) HTMLCanvasElement.prototype.getContext = () => null;
  }, brokenCanvas);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: source }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled);
  return page;
}
async function chart(page) {
  await page.click('[data-toggle-chart]');
  await page.waitForFunction(() => { const p = document.querySelector('.chart-drawer-panel.is-open'); return p && p.querySelector('[data-chart-status]').textContent !== 'Loading chart …' && !p.querySelector('[data-chart-status]').textContent.includes('geladen'); });
}
describe('step56 / candle charts and accessible data', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows a labeled DEMO chart and 24 accessible OHLC rows', async () => {
    const page = await open();
    try {
      await chart(page);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open .chart-viewport-box', el => el.hidden), false);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open canvas', el => el.getAttribute('aria-hidden')), 'true');
      assert.match(await page.$eval('.chart-drawer-panel.is-open', el => el.textContent), /DEMO[\s\S]*does not contain candle dates/);
      await page.click('.chart-drawer-panel.is-open summary');
      assert.equal(await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]', rows => rows.length), 24);
      assert.match(await page.$eval('.chart-drawer-panel.is-open thead', el => el.textContent), /Open \(\?\).*High \(\?\).*Low \(\?\).*Close \(\?\)/s);
      await page.focus('.chart-drawer-panel.is-open summary');
      await page.evaluate(() => window.__chartTest.renderSignals());
      assert.equal(await page.$eval('.chart-drawer-panel.is-open details', el => el.open), true);
      assert.equal(await page.evaluate(() => document.activeElement.matches('summary[data-chart-table-toggle]')), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('labels current LIVE cache candles with USDT and an open UTC day', async () => {
    const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
    const page = await freshPage(browser);
    await page.evaluateOnNewDocument(data => {
      const now = Date.now();
      const signals = Array.from({ length: 100 }, (_, i) => ({ ...data, id: `LIVE-${i}`, pair: `SAFE${i} / USDT`, timestamp: now, modelVersion: 3, quantScore: 90, confluenceScore: 90, metrics: { ...data.metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
      localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t: now, signals }));
    }, seed[0]);
    await page.setRequestInterception(true);
    page.on('request', req => {
      const url = new URL(req.url());
      if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
      if (url.pathname.endsWith('/ticker/24hr')) return;
      return req.abort().catch(() => {});
    });
    try {
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      assert.match(await page.$eval('#meBadge', el => el.textContent), /LIVE/);
      await chart(page);
      const text = await page.$eval('.chart-drawer-panel.is-open', el => el.textContent);
      assert.match(text, /LIVE[\s\S]*UTC daily candles[\s\S]*still open/);
      assert.match(text, /Snapshot:[\s\S]*UTC[\s\S]*BINANCE/);
      assert.match(text, /Open \(USDT\)/);
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
        const list = window.__chartTest.seed.map(x => x.id === id ? { ...x, k24: x.k24.map(row => row.map(value => value * 2)) } : x);
        window.__chartTest.ME.apply(list, 'seed', Date.now());
        return id;
      });
      await page.waitForFunction(id => !document.getElementById('viewport-' + id).hidden, {}, result);
      assert.equal(await page.$$eval('.chart-drawer-panel.is-open [data-candle-row]', rows => rows.length), 24);
      const old = await page.$eval('.chart-drawer-panel.is-open [data-candle-row] td', el => el.textContent);
      await page.evaluate(id => {
        const list = window.__chartTest.seed.map(x => x.id === id ? { ...x, k24: [] } : x);
        window.__chartTest.ME.apply(list, 'seed', Date.now());
      }, result);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open .chart-viewport-box', el => el.hidden), true);
      assert.match(await page.$eval('.chart-drawer-panel.is-open [data-chart-status]', el => el.textContent), /Candle data unavailable/);
      assert.equal(await page.$('.chart-drawer-panel.is-open [data-candle-row]'), null);
      assert.notEqual(old, firstBefore);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
