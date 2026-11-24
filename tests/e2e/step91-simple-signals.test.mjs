import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, BASE, VIEWPORTS } from '../helpers/browser.mjs';
const languages = ['de', 'en', 'es', 'ar', 'zh']; let browser;
describe('step91 / clear signal-first interface', {timeout:120000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('keeps the plan, risk and data status visible while optional details start closed in every language', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.mobileSm });
      const headings = new Set(), warnings = new Set(), summaries = new Set();
      for (const lang of languages) {
        await page.select('#langSelect', lang);
        const state = await page.evaluate(() => {
          const card = document.querySelector('.signal-card');
          const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility === 'visible';
          return { headline: document.querySelector('#heroT1').textContent, warning: document.querySelector('#boardRiskNotice').textContent,
            summary: document.querySelector('#boardDetailsSummary').textContent, warningVisible: visible(document.querySelector('#boardRiskNotice')),
            status: document.querySelector('#snapshotInfo').textContent, source: card.querySelector('[data-model-source]').textContent,
            levels: [...card.querySelectorAll('.sc-level-box')].map(el => el.textContent.trim()),
            details: ['snapshotDetails','boardDetails','marketRadar','marketOverview','faq'].map(id => document.getElementById(id).open),
            thesis: !!card.querySelector('.sc-thesis'), indicators: !!card.querySelector('.indicators-pill-strip'),
            lowRisk: document.querySelector('[data-filter="risk-low"]').textContent,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        headings.add(state.headline); warnings.add(state.warning); summaries.add(state.summary);
        assert.equal(state.warningVisible, true, lang); assert.match(state.status, /LIVE/); assert.match(state.source, /BINANCE/);
        assert.equal(state.levels.length, 4); assert.ok(state.levels.every(x => x.length > 4));
        assert.deepEqual(state.details, [false,false,false,false,false]); assert.equal(state.thesis, false); assert.equal(state.indicators, false);
        assert.equal(state.overflow, false, lang); assert.ok(state.lowRisk.length > 0);
      }
      assert.equal(headings.size, 5); assert.equal(warnings.size, 5); assert.equal(summaries.size, 5);
      await page.focus('#boardDetailsSummary'); await page.keyboard.press('Enter');
      assert.equal(await page.$eval('#boardDetails', e => e.open), true);
      assert.ok(await page.$eval('#qualityGateNote', e => !!e.getClientRects().length && e.textContent.length > 20));
      await page.click('#marketRadarSummary'); assert.equal(await page.$eval('#marketRadar', e => e.open), true);
      assert.ok(await page.$eval('#tickerScrollHint', e => !!e.getClientRects().length));
      await page.click('#btnOpenGuideModal');
      assert.equal(await page.$eval('#faq', e => e.open), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('shows no fake signals or misleading live status offline and offers optional diagnosis', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang:'en', expectCards:false });
      await page.waitForFunction(() => /unavailable/i.test(document.querySelector('#snapshotInfo').textContent));
      assert.equal(await page.$$('.signal-card').then(x => x.length), 0);
      assert.match(await page.$eval('#signalsGrid', e => e.textContent), /unavailable/i);
      assert.equal(await page.$eval('#snapshotDetails', e => e.open), false);
      await page.click('#snapshotDetailsSummary');
      assert.match(await page.$eval('#snapshotDiagnostics', e => e.textContent), /No valid 24h tickers/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps landing explanations optional, translated and reachable through the how-to link', async () => {
    const page = await freshPage(browser);
    try {
      await gotoLanding(page, { lang:'en', viewport:VIEWPORTS.mobileSm });
      for (const lang of languages) {
        await page.select('#langSelect', lang);
        assert.ok((await page.$eval('[data-i18n="more_steps"]', e => e.textContent)).trim().length > 0);
        assert.equal(await page.$eval('#schritte', e => e.open), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
      }
      await page.select('#langSelect', 'en');
      await page.click('a[href="#schritte"]');
      assert.equal(await page.$eval('#schritte', e => e.open), true);
      assert.equal(await page.evaluate(() => location.hash), '#schritte');
      assert.ok(await page.$eval('#schritte .step-box', e => !!e.getClientRects().length));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('renders the simplified landing and expandable explanations without JavaScript', async () => {
    const page = await freshPage(browser);
    try {
      await page.setJavaScriptEnabled(false);
      for (const lang of languages) {
        await page.goto(BASE + '/?lang=' + lang, {waitUntil:'domcontentloaded'});
        assert.ok((await page.$eval('[data-i18n="more_terms"]', e => e.textContent)).trim());
        assert.equal(await page.$eval('#glossar', e => e.open), false);
        await page.click('#glossar > summary');
        assert.ok(await page.$eval('#glossar .glossary-item', e => !!e.getClientRects().length));
      }
    } finally { await page.close(); }
  });
});
