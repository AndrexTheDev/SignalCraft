import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const langs = ['de','en','es','ar','zh'];
const source = read('app.html').replace('    ME.refresh(false);', '    window.__beta92 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
describe('step92 / systematic beta journeys', {timeout:180000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows the strongest trend-quality factor correctly in every language', async () => {
    const expected = {de:/Trend-Qualität/,en:/Trend quality/i,es:/Calidad de tendencia/i,ar:/جودة الاتجاه/,zh:/趋势质量/};
    const page = await freshPage(browser);
    try {
      await gotoApp(page, {lang:'en',appHtml:source});
      await page.evaluate(() => {
        const {ME,signals} = window.__beta92;
        ME.apply(signals().map(s => ({...s, metrics:{...s.metrics,top:'Trend-Qualität'}})), 'live', ME.status.when);
      });
      for (const lang of langs) {
        await page.select('#langSelect', lang);
        await page.click('.signal-card [data-toggle-sentiment]');
        const catalyst = await page.$eval('.signal-card .sentiment-catalyst-tag', e => e.textContent);
        assert.match(catalyst,expected[lang],lang); assert.doesNotMatch(catalyst, /undefined|null|NaN/);
        await page.click('.signal-card [data-toggle-sentiment]');
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('supports search, empty state, reset, sorting, details and navigation in five languages', async () => {
    for (const lang of langs) {
      const page = await freshPage(browser);
      try {
        await gotoApp(page, {lang});
        assert.ok(await page.$$('.signal-card').then(x => x.length) <= 10);
        await page.type('#pairSearchInput','ZZZNOTREAL');
        assert.equal(await page.$$('.signal-card').then(x => x.length), 0);
        assert.ok(await page.$eval('#resetFiltersBtn', e => !e.hidden));
        await page.click('#resetFiltersBtn');
        assert.ok(await page.$$('.signal-card').then(x => x.length) > 0);
        await page.select('#sortSelect','risk');
        await page.click('[data-inspect-sig]');
        assert.equal(await page.$eval('#dossierModalBackdrop', e => e.classList.contains('is-visible')), true);
        assert.ok(await page.$eval('#dossierBody', e => e.textContent.includes('USDT')));
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('#dossierModalBackdrop', e => e.classList.contains('is-visible')), false);
        assert.equal(await page.$eval('#ftLegalPrivacy', e => e.getAttribute('href')), '/datenschutz#' + lang);
        assert.deepEqual(page._pageErrors,[],lang);
      } finally { await page.close(); }
    }
  });
  it('keeps essential controls and plans inside the viewport across sizes and languages', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page,{lang:'en'});
      for (const width of [320,375,768,1024,1440]) for (const lang of langs) {
        await page.setViewport({width,height:850}); await page.select('#langSelect',lang);
        const state = await page.evaluate(() => {
          const selectors = ['#langSelect','#btnRefreshSentimentGlobal','#pairSearchInput','#sortSelect','#boardRiskNotice','.signal-card .sc-asset-title','.signal-card .sc-levels-grid','.signal-card .sc-level-val','.signal-card .risk-badge','.signal-card [data-toggle-sentiment]','.signal-card [data-inspect-sig]'];
          return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            controls: selectors.map(sel => { const el=document.querySelector(sel), r=el.getBoundingClientRect(); return {sel,left:r.left,right:r.right,width:r.width,height:r.height}; }) };
        });
        assert.ok(state.overflow <= 2, `${lang} ${width}: overflow ${state.overflow}`);
        for (const c of state.controls) {
          assert.ok(c.width > 0 && c.height > 0 && c.left >= -1 && c.right <= width + 1, `${lang} ${width}: ${JSON.stringify(c)}`);
        }
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('keeps primary controls reachable at a simulated 200% CSS zoom', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page,{lang:'en',viewport:{width:640,height:900}});
      await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
      for (const lang of langs) {
        await page.select('#langSelect', lang);
        const state = await page.evaluate(() => {
          const selectors = ['#langSelect','#btnRefreshSentimentGlobal','#pairSearchInput','#sortSelect','.signal-card .sc-asset-title','.signal-card .sc-levels-grid','.signal-card [data-inspect-sig]'];
          return selectors.map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return {sel,left:r.left,right:r.right,width:r.width,height:r.height}; });
        });
        for (const c of state) assert.ok(c.left >= -1 && c.right <= 641 && c.width > 0 && c.height > 0, `${lang} zoom: ${JSON.stringify(c)}`);
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('opens landing guides and preserves language when entering the terminal', async () => {
    for (const lang of langs) {
      const page = await freshPage(browser);
      try {
        await gotoLanding(page, {lang,viewport:VIEWPORTS.mobileSm});
        await page.click('a[href="#schritte"]'); assert.equal(await page.$eval('#schritte',e=>e.open),true);
        const href = await page.$eval('[data-terminal-link]', e => e.href);
        assert.equal(new URL(href).searchParams.get('lang'),lang === 'de' ? null : lang);
        assert.ok(await page.$eval('#glossar > summary', e => !!e.getClientRects().length));
        assert.deepEqual(page._pageErrors,[]);
      } finally { await page.close(); }
    }
  });
});
