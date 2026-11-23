import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html');
const seed = JSON.parse(extractArray(source, 'const SEED_SIGNALS ='));
const html = source.replace('    ME.refresh(false);', "    window.__cexMedianTest = { ME, CexEngine }; ME.apply(SEED_SIGNALS, 'seed', ME_STAMP);");
const labels = {
  de: /Median gemeldeter USDT-Preise.*kein|Median gemeldeter USDT-Preise.*Kein/i,
  en: /Median of reported USDT prices.*Not an executable/i,
  es: /Mediana de precios USDT.*No es una oferta ejecutable/i,
  ar: /الوسيط لأسعار USDT.*ليس عرضاً قابلاً للتنفيذ/,
  zh: /USDT 价格的中位数.*并非可执行报价/
};
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(seed => {
    window._clock53 = Date.UTC(2025, 0, 1, 12); Date.now = () => window._clock53;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = String(input);
      if (url.includes('data-api.binance.vision/api/v3/ticker/price')) return Promise.resolve({ ok: true, json: async () => [null, ...seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', price: '1.00001' }))] });
      if (url.includes('okx.com/api/v5/market/tickers')) return Promise.resolve({ ok: true, json: async () => ({ data: [null, ...seed.map(s => ({ instId: s.pair.split(' / ')[0] + '-USDT', last: '1.00003' }))] }) });
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(input, options);
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
  await page.waitForFunction(() => document.getElementById('cexTickerLabel')?.textContent.includes('LIVE 2/11'));
  return page;
}
describe('step53 / CEX median presentation', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows a precise approximate median with an always-visible localized warning in all languages', async () => {
    const page = await open();
    try {
      assert.ok(Math.abs(await page.evaluate(() => window.__cexMedianTest.CexEngine.data.PEPE.med) - 1.00002) < 1e-12);
      assert.match(await page.$eval('#tickerScrollFeed', el => el.textContent), /PEPE ≈1\.00002 USDT \(2 venues\)/);
      for (const [lang, label] of Object.entries(labels)) {
        await page.select('#langSelect', lang);
        assert.equal(await page.$eval('#cexRadarNotice', el => el.hidden), false);
        assert.match(await page.$eval('#cexRadarNotice', el => el.textContent), label);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), lang);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('removes the warning and replaces the radar when quotes expire while the tab is paused', async () => {
    const page = await open();
    try {
      await page.evaluate(() => {
        window._clock53 += 90000;
        window.__cexMedianTest.ME._last = window._clock53;
        Object.defineProperty(document, 'hidden', { value: false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      assert.equal(await page.$eval('#cexRadarNotice', el => el.hidden), true);
      assert.doesNotMatch(await page.$eval('#cexTickerLabel', el => el.textContent), /LIVE 2\/11/);
      assert.doesNotMatch(await page.$eval('#tickerScrollFeed', el => el.textContent), /≈1\.00002/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
