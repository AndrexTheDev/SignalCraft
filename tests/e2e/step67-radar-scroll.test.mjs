import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html');
const seed = JSON.parse(extractArray(source, 'const SEED_SIGNALS ='));
const html = source.replace('    ME.refresh(false);', '    window.__radarScroll = { CexEngine, DexEngine, refreshVenuePresentation }; ME.apply(SEED_SIGNALS, "seed", ME_STAMP);').replace('    ME.startAuto();', '');
let browser;
async function open(reduced = false) {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(seed => {
    localStorage.clear(); const original = window.fetch.bind(window);
    window.fetch = (input, opt) => {
      const u = String(input);
      if (u.includes('data-api.binance.vision/api/v3/ticker/price')) return Promise.resolve({ ok: true, json: async () => seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', price: '1.23' })) });
      if (u.includes('api.dexscreener.com')) {
        const sym = new URL(u).searchParams.get('q');
        return Promise.resolve({ ok: true, json: async () => ({ pairs: [{ baseToken: { symbol: sym }, dexId: 'example', priceUsd: '123', liquidity: { usd: 100000 } }] }) });
      }
      if (/^https?:/.test(u) && !u.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, opt);
    };
  }, seed);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__radarScroll && window.__radarScroll.DexEngine.wire.length > 3 && !window.__radarScroll.DexEngine.busy);
  return page;
}
const regions = ['#cexTickerViewport', '#dexTickerViewport'];
describe('step67 / manual radar scrolling', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('makes both non-animated feeds focusable and reachable with keyboard on a narrow screen', async () => {
    const page = await open();
    try {
      for (const selector of regions) {
        const state = await page.$eval(selector, el => ({ role: el.getAttribute('role'), tabIndex: el.tabIndex, label: el.getAttribute('aria-label'), dir: el.getAttribute('dir'), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflow: getComputedStyle(el).overflowX, animation: getComputedStyle(el.firstElementChild).animationName }));
        assert.equal(state.role, 'region'); assert.equal(state.tabIndex, 0); assert.ok(state.label);
        assert.equal(state.dir, 'ltr'); assert.equal(state.overflow, 'auto'); assert.equal(state.animation, 'none');
        assert.ok(state.clientWidth >= 150 && state.scrollWidth > state.clientWidth, JSON.stringify(state));
        await page.focus(selector); await page.keyboard.press('ArrowRight');
        await page.waitForFunction(sel => document.querySelector(sel).scrollLeft > 0, {}, selector);
        const visibleEnd = await page.$eval(selector, el => {
          el.scrollLeft = el.scrollWidth;
          const node = el.firstElementChild.firstChild, range = document.createRange();
          range.setStart(node, node.textContent.length - 1); range.setEnd(node, node.textContent.length);
          const end = range.getBoundingClientRect(), box = el.getBoundingClientRect();
          return end.left >= box.left - 1 && end.right <= box.right + 1;
        });
        assert.equal(visibleEnd, true, selector);
      }
      assert.equal(await page.$eval('#tickerScrollHint', el => !el.hidden && !!el.getClientRects().length), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps localized names, usable width, and manually reachable text in every language including RTL', async () => {
    const page = await open();
    try {
      const labels = new Set(), hints = new Set();
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        await page.select('#langSelect', lang);
        labels.add(await page.$eval('#dexTickerViewport', el => el.getAttribute('aria-label')));
        hints.add(await page.$eval('#tickerScrollHint', el => el.textContent));
        for (const selector of regions) {
          assert.ok(await page.$eval(selector, el => el.clientWidth) >= 150, `${lang} ${selector}`);
          assert.equal(await page.$eval(selector, el => getComputedStyle(el.firstElementChild).animationName), 'none');
          assert.equal(await page.$eval(selector, el => el.getAttribute('dir')), 'ltr');
          assert.ok(await page.$eval(selector, el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft; }) > 0, `${lang} ${selector} end`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
      }
      assert.equal(labels.size, 5); assert.equal(hints.size, 5);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps focus and non-moving radar content across a desktop data refresh', async () => {
    const page = await open();
    try {
      await page.setViewport(VIEWPORTS.desktop);
      await page.focus('#dexTickerViewport');
      await page.evaluate(async () => { await window.__radarScroll.DexEngine.fetchAll(['BTC', 'ETH', 'PEPE', 'WIF']); window.__radarScroll.refreshVenuePresentation(); });
      assert.equal(await page.evaluate(() => document.activeElement.id), 'dexTickerViewport');
      assert.equal(await page.$eval('#dexTickerFeed', el => getComputedStyle(el).animationName), 'none');
      assert.equal(await page.$eval('#dexTickerFeed', el => getComputedStyle(el).transform), 'none');
      assert.match(await page.$eval('#dexTickerFeed', el => el.textContent), /EXAMPLE/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('remains keyboard-scrollable when reduced motion is enabled', async () => {
    const page = await open(true);
    try {
      for (const selector of regions) {
        assert.equal(await page.$eval(selector, el => getComputedStyle(el.firstElementChild).animationName), 'none');
        await page.focus(selector); await page.keyboard.press('ArrowRight');
        await page.waitForFunction(sel => document.querySelector(sel).scrollLeft > 0, {}, selector);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
