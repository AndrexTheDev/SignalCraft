import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html').replace('    ME.refresh(false);', '    window.__dexNotice = { ME, DexEngine, refreshVenuePresentation }; ME.apply(SEED_SIGNALS, "seed", ME_STAMP);');
const warnings = {
  de: /Treffer nur anhand des Symbols.*Token-Identität nicht bestätigt.*Keine Preisvergleiche oder Handelsentscheidungen/,
  en: /Results match by symbol only.*token identity is not verified.*Do not use for price comparisons or trading decisions/,
  es: /solo coinciden por símbolo.*identidad del token no está verificada.*No usar para comparar precios ni operar/,
  ar: /النتائج متطابقة في الرمز فقط.*لم تُتحقق هوية العملة.*لا تعتمد عليها لمقارنة الأسعار أو التداول/,
  zh: /结果仅按代号匹配.*代币身份未经验证.*请勿用于价格比较或交易决策/
};
let browser;
async function open() {
  const page = await freshPage(browser); await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear(); window._now65 = Date.UTC(2025, 0, 1, 12); Date.now = () => window._now65;
    window._dex65 = true;
    const original = window.fetch.bind(window);
    window.fetch = (input, opt) => {
      const url = String(input);
      if (url.includes('api.dexscreener.com') && window._dex65) {
        const sym = new URL(url).searchParams.get('q');
        return Promise.resolve({ ok: true, json: async () => ({ pairs: [{ baseToken: { symbol: sym }, dexId: 'example', priceUsd: '10', liquidity: { usd: 100000 } }] }) });
      }
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, opt);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: html }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('dexTickerFeed')?.textContent.includes('EXAMPLE'));
  return page;
}
describe('step65 / visible DEX caution', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('displays translated caution as visible text on a narrow touch viewport', async () => {
    const page = await open();
    try {
      for (const [lang, expected] of Object.entries(warnings)) {
        await page.select('#langSelect', lang);
        assert.equal(await page.$eval('#dexRadarNotice', el => !el.hidden && !!el.getClientRects().length && getComputedStyle(el).visibility === 'visible'), true, lang);
        assert.match(await page.$eval('#dexRadarNotice', el => el.textContent), expected);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('hides and clears the caution when a refresh has no results, then shows it again', async () => {
    const page = await open();
    try {
      await page.evaluate(async () => { window._dex65 = false; await window.__dexNotice.DexEngine.fetchAll(['BTC']); window.__dexNotice.refreshVenuePresentation(); });
      assert.equal(await page.$eval('#dexRadarNotice', el => el.hidden), true);
      assert.equal(await page.$eval('#dexRadarNotice', el => el.textContent), '');
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      await page.evaluate(async () => { window._dex65 = true; await window.__dexNotice.DexEngine.fetchAll(['BTC']); window.__dexNotice.refreshVenuePresentation(); });
      assert.equal(await page.$eval('#dexRadarNotice', el => el.hidden), false);
      assert.match(await page.$eval('#dexRadarNotice', el => el.textContent), warnings.en);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('clears the caution immediately when a new snapshot invalidates the radar', async () => {
    const page = await open();
    try {
      const after = await page.evaluate(() => {
        window._dex65 = false;
        window.__dexNotice.ME.apply([], 'seed', Date.now());
        const notice = document.getElementById('dexRadarNotice');
        return { hidden: notice.hidden, text: notice.textContent, feed: document.getElementById('dexTickerFeed').textContent };
      });
      assert.deepEqual(after, { hidden: true, text: '', feed: '–' });
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('removes the caution and data when the venue lifetime expires after a paused tab', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        window._now65 += 90000; window.__dexNotice.ME._last = window._now65;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await page.$eval('#dexRadarNotice', el => el.hidden), true);
      assert.equal(await page.$eval('#dexRadarNotice', el => el.textContent), '');
      assert.equal(await page.$eval('#dexTickerFeed', el => el.textContent), '–');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
