import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
let browser;
describe('step37 / position risk and explanations', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('caps the spot position, shows the actual planned loss and clears invalid input', async () => {
    const page = await freshPage(browser);
    try {
      const signals = Array.from({ length: 100 }, (_, i) => ({
        ...seed[0], id: `SIG-TEST-${i}`, pair: (i ? 'TEST' + i : 'TEST') + ' / USDT', entryPrice: 100, stopLoss: 99.9, targets: [101, 102], riskRewardRatio: '1:20.0',
        quantScore: 90, confluenceScore: 90, modelVersion: 3,
        gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
      }));
      await page.evaluateOnNewDocument(signals => {
        localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }))(Date.now())));
      }, signals);
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = new URL(req.url());
        if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        if (url.pathname.endsWith('/ticker/24hr')) return; // keep refresh pending while inspecting cached LIVE fixture
        return req.abort().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
      await page.click('[data-inspect-sig]');
      await page.waitForSelector('#dossierModalBackdrop.is-visible');
      const text = selector => page.$eval(selector, el => el.textContent.trim());
      assert.equal(await text('[data-possize-out="size"]'), '≈ 10,000 USDT');
      assert.equal(await text('[data-possize-out="units"]'), '≈ 100');
      assert.equal(await text('[data-possize-out="loss"]'), '≈ −10 USDT');
      assert.equal(await text('[data-possize-out="tp1"]'), '≈ +100 USDT');
      assert.match(await text('[data-possize-status]'), /Capped at available capital/);
      assert.equal(await page.$eval('[data-possize-status]', el => el.getAttribute('role')), 'status');
      assert.match(await text('[data-possize]'), /actual loss can be greater/);
      await page.$eval('[data-possize-equity]', el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
      for (const key of ['size', 'units', 'loss', 'tp1']) assert.equal(await text(`[data-possize-out="${key}"]`), '—');
      assert.match(await text('[data-possize-status]'), /Enter positive capital/);
      await page.$eval('[data-possize-equity]', el => { el.value = '-1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await text('[data-possize-out="size"]'), '—');
      await page.$eval('[data-possize-equity]', el => { el.value = '1000'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert.equal(await text('[data-possize-out="size"]'), '≈ 1,000 USDT');
      assert.equal(await text('[data-possize-out="loss"]'), '≈ −1 USDT');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('explains stop execution risk in the FAQ and calculator in all five languages', async () => {
    const copy = {
      de: [/nicht garantiert/, /tatsächliche Verlust kann höher/],
      en: [/does not guarantee/, /actual loss can be greater/],
      es: [/no garantiza/, /pérdida real puede ser mayor/],
      ar: [/لا يضمن/, /الخسارة الفعلية أكبر/],
      zh: [/不保证最大亏损/, /实际亏损可能更大/]
    };
    for (const [lang, [faq, note]] of Object.entries(copy)) {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
        await gotoApp(page, { lang });
        assert.match(await page.$eval('#faq-panel-3', el => el.textContent), faq);
        await page.click('[data-inspect-sig]');
        assert.match(await page.$eval('[data-possize]', el => el.textContent), note);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });

  it('the landing-page glossary does not promise stop execution at the displayed price', async () => {
    const copy = { de: /nicht garantiert/, en: /not guaranteed/, es: /no está garantizada/, ar: /لا يوجد ضمان/, zh: /不保证/ };
    for (const [lang, text] of Object.entries(copy)) {
      const page = await freshPage(browser);
      try {
        await gotoLanding(page, { lang });
        assert.match(await page.$eval('[data-i18n="g3d"]', el => el.textContent), text);
      } finally { await page.close(); }
    }
  });
});
