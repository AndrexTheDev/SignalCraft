import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const app = read('app.html').replace('    ME.refresh(false);', '    window.__quote40 = {ME, signals: () => signalsData}; ME.refresh(false);');
let browser;
async function open(lang, live) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem('signalcraft_live_v2');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } }, configurable: true });
    window.canvasText = [];
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.canvasText.push(String(text)); return draw.call(this, text, ...args); };
  });
  await stubMarket(page, {appHtml:app, klines:live ? liveTestCandles() : null});
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(live => live ? !!document.querySelector('.signal-card') : !document.getElementById('btnRefreshSentimentGlobal').disabled, {}, live);
  if (live) await page.evaluate(() => { const t=window.__quote40; t.ME.apply(t.signals().map(s=>({...s,entryPrice:100,stopLoss:90,targets:[110,120],riskRewardRatio:'1:2.0'})), 'live', t.ME.status.when); });
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
        if (lang === 'en') assert.match(await page.$eval('#qualityGateNote', el => el.textContent), /0 OF 120 SETUPS/);
        assert.match(await page.$eval('.sc-asset-title', el => el.textContent), /[A-Z0-9]+ \/ USDT/);
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
        assert.match(await page.evaluate(() => window.copied), /[A-Z0-9]+ \/ USDT Setup \| Entry: 100 USDT/);
        await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
        assert.match(await page.$eval('[data-quote-explanation]', el => el.textContent), liveNotice);
        assert.match(await page.$eval('[data-possize]', el => el.textContent), /USDT/);
        assert.match(await page.$eval('[data-possize-out="size"]', el => el.textContent), /USDT/);
        assert.match(await page.$eval('#dossierBody', el => el.textContent), /USDT/);
        await page.keyboard.press('Escape');
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.ok(await page.evaluate(() => window.canvasText.some(t => /^[A-Z0-9]+ \/ USDT$/.test(t))));
        assert.ok(await page.evaluate(() => window.canvasText.includes('100 USDT')));
        assert.ok(await page.evaluate(() => window.canvasText.some(t => t.includes('USDT') && t.includes('USD'))));
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
      const offline = await open(lang, false);
      try {
        assert.equal((await offline.$$('.signal-card')).length, 0);
        assert.equal(await offline.$('[data-copy-levels], [data-share-sig]'), null);
        assert.doesNotMatch(await offline.$eval('#quoteNotice', el => el.textContent), /DEMO/i);
        assert.deepEqual(offline._pageErrors, []);
      } finally { await offline.close(); }
    });
  }
});
