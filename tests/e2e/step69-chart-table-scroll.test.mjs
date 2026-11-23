import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__tableScroll = { ME, seed: SEED_SIGNALS, renderSignals, setLanguage }; ME.apply(SEED_SIGNALS, "seed", ME_STAMP);').replace('    ME.startAuto();', '');
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__tableScroll && document.querySelector('#signalsGrid [data-toggle-chart]'));
  await page.evaluate(() => {
    const t = window.__tableScroll, id = document.querySelector('[data-toggle-chart]').getAttribute('data-toggle-chart').replace('chart-panel-', '');
    const rows = Array.from({ length: 24 }, () => [1.00000000000002, 1.00000000000004, 1.00000000000001, 1.00000000000003]);
    t.ME.apply(t.seed.map(x => x.id === id ? { ...x, k24: rows } : x), 'seed', Date.now());
    document.querySelector('[data-toggle-chart]').click();
    document.querySelector('.chart-drawer-panel.is-open summary').click();
  });
  return page;
}
const region = '.chart-drawer-panel.is-open [data-chart-table-region]';
describe('step69 / keyboard access to OHLC tables', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('allows keyboard users to reach every column in the named scroll region', async () => {
    const page = await open();
    try {
      const state = await page.$eval(region, el => ({ role: el.getAttribute('role'), tab: el.tabIndex, label: el.getAttribute('aria-label'), described: el.getAttribute('aria-describedby'), width: el.clientWidth, total: el.scrollWidth, overflow: getComputedStyle(el).overflowX }));
      assert.equal(state.role, 'region'); assert.equal(state.tab, 0); assert.match(state.label, /Candle data as a table.* \/ /);
      assert.ok(state.described); assert.equal(state.overflow, 'auto'); assert.ok(state.total > state.width);
      assert.match(await page.$eval('#' + state.described, el => el.textContent), /scroll.*arrow keys/i);
      await page.focus('.chart-drawer-panel.is-open summary'); await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chart-table-region]')), true);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(sel => document.querySelector(sel).scrollLeft > 0, {}, region);
      const rightVisible = await page.$eval(region, el => { el.scrollLeft = el.scrollWidth; const last = el.querySelector('thead th:last-child').getBoundingClientRect(), box = el.getBoundingClientRect(); return last.right <= box.right + 1; });
      assert.equal(rightVisible, true);
      assert.equal(await page.$$eval(region + ' [data-candle-row]', x => x.length), 24);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('preserves open table, focus, and horizontal position after a board redraw', async () => {
    const page = await open();
    try {
      await page.focus(region);
      const before = await page.$eval(region, el => { el.scrollLeft = Math.min(120, el.scrollWidth - el.clientWidth); return el.scrollLeft; });
      assert.ok(before > 0);
      await page.evaluate(() => window.__tableScroll.renderSignals());
      assert.equal(await page.evaluate(() => document.activeElement.matches('[data-chart-table-region]')), true);
      assert.equal(await page.$eval('.chart-drawer-panel.is-open details', el => el.open), true);
      assert.equal(await page.$eval(region, el => el.scrollLeft), before);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('moves focus safely to the board if candle data disappears on redraw', async () => {
    const page = await open();
    try {
      await page.focus(region);
      await page.evaluate(() => {
        const id = document.activeElement.getAttribute('data-chart-table-region'), t = window.__tableScroll;
        t.ME.apply(t.seed.map(s => s.id === id ? { ...s, k24: [] } : s), 'seed', Date.now());
      });
      assert.equal(await page.$(region), null);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'signalsGrid');
      assert.match(await page.$eval('.chart-drawer-panel.is-open [data-chart-status]', el => el.textContent), /Candle data unavailable/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('uses distinct descriptions for simultaneously opened tables', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { document.querySelectorAll('[data-toggle-chart]')[1].click(); document.querySelectorAll('.chart-drawer-panel.is-open summary')[1].click(); });
      const names = await page.$$eval('.chart-drawer-panel.is-open [data-chart-table-region]', els => els.map(el => ({ label: el.getAttribute('aria-label'), described: el.getAttribute('aria-describedby'), exists: !!document.getElementById(el.getAttribute('aria-describedby')) })));
      assert.equal(names.length, 2); assert.notEqual(names[0].label, names[1].label); assert.notEqual(names[0].described, names[1].described);
      assert.ok(names.every(x => x.exists)); assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('localizes descriptions and allows scrolling in RTL without overflowing the page', async () => {
    const page = await open();
    try {
      const labels = new Set(), hints = new Set();
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        await page.select('#langSelect', lang);
        const result = await page.$eval(region, el => ({ label: el.getAttribute('aria-label'), hint: document.getElementById(el.getAttribute('aria-describedby'))?.textContent, direction: getComputedStyle(el).direction, width: el.scrollWidth - el.clientWidth }));
        labels.add(result.label); hints.add(result.hint); assert.ok(result.width > 0, lang);
        assert.equal(result.direction, lang === 'ar' ? 'rtl' : 'ltr');
        await page.$eval(region, el => { el.scrollLeft = 0; }); await page.focus(region);
        await page.keyboard.press(lang === 'ar' ? 'ArrowLeft' : 'ArrowRight');
        await page.waitForFunction(sel => document.querySelector(sel).scrollLeft !== 0, {}, region);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
      }
      assert.equal(labels.size, 5); assert.equal(hints.size, 5);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
