import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding } from '../helpers/browser.mjs';
let browser;
const langs = ['de', 'en', 'es', 'ar', 'zh'];

describe('step41 / multilingual SEO and URL state', { timeout: 180000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const pageName of ['index.html', 'app.html']) {
    it(`${pageName}: localized SEO graph reflects visible FAQ in all five languages`, async () => {
      const page = await freshPage(browser);
      try {
        if (pageName === 'index.html') await gotoLanding(page, { lang: 'de' });
        else await gotoApp(page, { lang: 'de' });
        for (const lang of langs) {
          await page.select('#langSelect', lang);
          const got = await page.evaluate(pageName => {
            const clean = s => String(s).replace(/\s+/g, ' ').trim();
            const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
            const faq = graph.find(n => n['@type'] === 'FAQPage');
            const web = graph.find(n => n['@type'] === 'WebPage');
            const rows = pageName === 'index.html' ? [...document.querySelectorAll('#faq .seo-faq-item')].map(el => [el.querySelector('.seo-faq-question'), el.querySelector('.seo-faq-answer')]) : [...document.querySelectorAll('#faq .faq-accordion-item')].map(el => [el.querySelector('.faq-header-toggle span:first-child'), el.querySelector('.faq-body-content')]);
            return { lang: document.documentElement.lang, canonical: document.querySelector('link[rel="canonical"]').href, web, faq: faq.mainEntity, rows: rows.map(([q, a]) => [clean(q.textContent).replace(/^\d+\.\s*/, ''), clean(a.textContent)]), locales: [...document.querySelectorAll('meta[property="og:locale:alternate"]')].map(el => el.content), locale: document.querySelector('meta[property="og:locale"]').content };
          }, pageName);
          const expected = 'https://signalcraft.click/' + (pageName === 'index.html' ? '' : 'app') + (lang === 'de' ? '' : '?lang=' + lang);
          assert.equal(got.lang, lang); assert.equal(got.canonical, expected);
          assert.equal(got.web.url, expected); assert.equal(got.web.inLanguage, lang);
          assert.equal(got.faq.length, got.rows.length);
          got.rows.forEach(([q, a], i) => { assert.equal(got.faq[i].name, q); assert.equal(got.faq[i].acceptedAnswer.text, a); });
          assert.equal(got.locales.length, 4); assert.equal(new Set(got.locales).size, 4); assert.ok(!got.locales.includes(got.locale));
          assert.equal(new URL(page.url()).searchParams.get('lang'), lang);
        }
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('preserves a landing query and fragment across language changes without adding history entries', async () => {
    const page = await freshPage(browser);
    try {
      await gotoLanding(page, { lang: 'de' });
      await page.evaluate(() => history.replaceState({ marker: 42 }, '', '?lang=de&campaign=example#faq'));
      const before = await page.evaluate(() => history.length);
      await page.select('#langSelect', 'ar');
      const state = await page.evaluate(() => ({ url: location.href, length: history.length, marker: history.state.marker }));
      const url = new URL(state.url);
      assert.equal(url.searchParams.get('lang'), 'ar');
      assert.equal(url.searchParams.get('campaign'), 'example');
      assert.equal(url.hash, '#faq');
      assert.equal(state.length, before); assert.equal(state.marker, 42);
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.$eval('html', el => el.lang), 'ar');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('retains filters and the selected language in shareable URLs, including after reload and return to landing', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en', query: { sector: 'majors', q: 'BTC' } });
      await page.select('#langSelect', 'es');
      const url = new URL(page.url());
      assert.equal(url.searchParams.get('lang'), 'es'); assert.equal(url.searchParams.get('sector'), 'majors'); assert.equal(url.searchParams.get('q'), 'BTC');
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.$eval('html', el => el.lang), 'es');
      assert.equal(await page.$eval('#pairSearchInput', el => el.value), 'BTC');
      assert.match(await page.$eval('#ftBack', el => el.getAttribute('href')), /lang=es/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
