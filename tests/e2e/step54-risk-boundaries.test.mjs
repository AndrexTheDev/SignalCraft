import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const signals = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: 'SIG-RISK-' + i, pair: 'TEST' + i + ' / USDT', modelVersion: 3,
  entryPrice: 100, stopLoss: 90, targets: [120, 140], riskRewardRatio: '1:4.0',
  quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 },
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(signals => {
    const t = Date.now();
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals: signals.map(s => ({ ...s, timestamp: t })) }));
  }, signals);
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
async function enter(page, value) {
  await page.$eval('[data-possize-equity]', (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function text(page, name) { return page.$eval(`[data-possize-out="${name}"]`, el => el.textContent.trim()); }
describe('step54 / position calculator edge cases and explanations', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('supports small positive inputs, changes risk percentages, and marks invalid input accessibly', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
      await enter(page, '1000');
      assert.equal(await text(page, 'size'), '≈ 100 USDT');
      assert.equal(await text(page, 'units'), '≈ 1');
      assert.equal(await text(page, 'loss'), '≈ −10 USDT');
      assert.equal(await text(page, 'tp1'), '≈ +20 USDT');
      await page.select('[data-possize-risk]', '2');
      assert.equal(await text(page, 'size'), '≈ 200 USDT');
      assert.equal(await text(page, 'tp1'), '≈ +40 USDT');
      await enter(page, '0.001');
      assert.match(await text(page, 'size'), /0\.0002 USDT/);
      assert.equal(await page.$eval('[data-possize-equity]', el => el.validity.valid), true);
      assert.equal(await page.$eval('[data-possize-equity]', el => el.getAttribute('aria-invalid')), 'false');
      await enter(page, '0');
      assert.equal(await page.$eval('[data-possize-equity]', el => el.getAttribute('aria-invalid')), 'true');
      assert.equal(await page.$eval('[data-possize-equity]', el => el.getAttribute('aria-describedby')), 'possizeStatus');
      assert.match(await page.$eval('#possizeStatus', el => el.textContent), /Enter positive capital/);
      for (const name of ['size', 'units', 'loss', 'tp1']) assert.equal(await text(page, name), '—');
      await enter(page, '1e-323');
      assert.equal(await page.$eval('[data-possize-equity]', el => el.getAttribute('aria-invalid')), 'false');
      assert.match(await page.$eval('#possizeStatus', el => el.textContent), /Calculation unavailable/);
      assert.equal(await text(page, 'loss'), '—');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('renders extreme but computable inputs compactly instead of overflowing on mobile', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
      await enter(page, '1e250');
      for (const name of ['size', 'units', 'loss', 'tp1']) {
        const value = await text(page, name);
        assert.match(value, /E\+?\d+/i);
        assert.ok(value.length < 50, value);
      }
      assert.ok(await page.$eval('[data-possize]', el => el.scrollWidth <= el.clientWidth + 1));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('explains the whole-position TP1 assumption and omitted exchange rules in five languages', async () => {
    const copy = {
      de: [/gesamte Position bei TP1 verkauft/, /Börsen-Mindestgrößen und Mengenschritte/],
      en: [/entire position is sold at TP1/, /Exchange minimums and quantity increments/],
      es: [/vender toda la posición en TP1/, /mínimos ni pasos de cantidad/],
      ar: [/بيع كامل المركز عند TP1/, /الحدود الدنيا وخطوات الكمية/],
      zh: [/整个仓位在TP1卖出/, /交易所最低数量和数量步长/]
    };
    const page = await open();
    try {
      for (const [lang, [whole, limits]] of Object.entries(copy)) {
        await page.select('#langSelect', lang);
        await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
        const content = await page.$eval('[data-possize]', el => el.textContent);
        assert.match(content, whole); assert.match(content, limits);
        await page.evaluate(() => document.getElementById('btnCloseDossierModal').click());
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
