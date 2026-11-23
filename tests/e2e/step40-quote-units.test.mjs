import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
// Live cache records carry their actual USDT quote and valid numeric trade levels.
const signals = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: `SIG-UNIT-${i}`, pair: (i ? 'TEST' + i : 'TEST') + ' / USDT', timestamp: Date.now(),
  entryPrice: 100, stopLoss: 90, targets: [110, 120], quantScore: 90, confluenceScore: 90, modelVersion: 3,
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
let browser;
async function open(lang, live) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ live, signals }) => {
    if (live) localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }))(Date.now())));
    else localStorage.removeItem('signalcraft_live_v2');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } }, configurable: true });
    window.canvasText = [];
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.canvasText.push(String(text)); return draw.call(this, text, ...args); };
  }, { live, signals });
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(live => document.getElementById('meBadge')?.textContent.includes(live ? 'LIVE' : 'DEMO'), {}, live);
  return page;
}
const notices = {
  de: [/ohne USD-Umrechnung/, /nicht verifiziert/],
  en: [/without USD conversion/, /unverified/],
  es: [/sin conversión a USD/, /no verificada/],
  ar: [/دون تحويل إلى USD/, /غير مؤكدة/],
  zh: [/未换算为美元/, /未经验证/]
};
describe('step40 / quote unit integrity', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const [lang, [liveNotice, demoNotice]] of Object.entries(notices)) {
    it(`labels prices, volume, position estimate, clipboard and image in ${lang}`, async () => {
      const page = await open(lang, true);
      try {
        assert.match(await page.$eval('#quoteNotice', el => el.textContent), liveNotice);
        if (lang === 'en') assert.match(await page.$eval('#qualityGateNote', el => el.textContent), /0 OF 100 SETUPS/);
        assert.match(await page.$eval('.sc-asset-title', el => el.textContent), /TEST \/ USDT/);
        assert.match(await page.$eval('.sc-levels-grid', el => el.textContent), /100 USDT/);
        assert.doesNotMatch(await page.$eval('.sc-levels-grid', el => el.textContent), /\$/);
        if (lang === 'en') {
          await page.type('#pairSearchInput', 'USDT');
          assert.equal(await page.$$eval('.signal-card', els => els.length), 10);
          await page.click('#clearSearchBtn');
          await page.evaluate(() => document.querySelector('[data-toggle-chart]').click());
          await page.waitForFunction(() => { const p = document.querySelector('.chart-drawer-panel.is-open'); return p && !p.querySelector('.chart-viewport-box').hidden && p.textContent.includes('ENTRY: 100 USDT'); });
          await page.select('#langSelect', 'de');
          await page.waitForFunction(() => { const p = document.querySelector('.chart-drawer-panel.is-open'); return p && !p.querySelector('.chart-viewport-box').hidden && p.textContent.includes('EINSTIEG: 100 USDT'); });
          await page.select('#langSelect', 'en');
        }
        await page.evaluate(() => document.querySelector('[data-toggle-sentiment]').click());
        assert.match(await page.$eval('.sentiment-drawer-panel.is-open', el => el.textContent), /USDT/);
        await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
        await page.waitForFunction(() => window.copied);
        assert.match(await page.evaluate(() => window.copied), /TEST \/ USDT Setup \| Entry: 100 USDT/);
        await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
        assert.match(await page.$eval('[data-quote-explanation]', el => el.textContent), liveNotice);
        assert.match(await page.$eval('[data-possize]', el => el.textContent), /USDT/);
        assert.match(await page.$eval('[data-possize-out="size"]', el => el.textContent), /USDT/);
        assert.match(await page.$eval('#dossierBody', el => el.textContent), /USDT/);
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.ok(await page.evaluate(() => window.canvasText.includes('TEST / USDT')));
        assert.ok(await page.evaluate(() => window.canvasText.includes('100 USDT')));
        assert.ok(await page.evaluate(() => window.canvasText.some(t => t.includes('USDT') && t.includes('USD'))));
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
      const demo = await open(lang, false);
      try {
        assert.match(await demo.$eval('#quoteNotice', el => el.textContent), demoNotice);
        if (lang === 'en') { const gate = await demo.$eval('#qualityGateNote', el => el.textContent); assert.match(gate, /110 OF 120 HISTORICAL/); assert.doesNotMatch(gate, /USDT/); }
        assert.match(await demo.$eval('.sc-asset-title', el => el.textContent), /\/ \?/);
        assert.match(await demo.$eval('.sc-levels-grid', el => el.textContent), /\?/);
        assert.doesNotMatch(await demo.$eval('.sc-levels-grid', el => el.textContent), /\$|USDT|USD/);
        await demo.evaluate(() => document.querySelector('[data-copy-levels]').click());
        await demo.waitForFunction(() => window.copied);
        assert.match(await demo.evaluate(() => window.copied), demoNotice);
        await demo.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.ok(await demo.evaluate(pattern => window.canvasText.some(t => new RegExp(pattern).test(t)), demoNotice.source));
        assert.deepEqual(demo._pageErrors, []);
      } finally { await demo.close(); }
    });
  }
});
