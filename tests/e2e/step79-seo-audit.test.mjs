import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE } from '../helpers/browser.mjs';
const langs = ['de', 'en', 'es', 'ar', 'zh']; let browser;
describe('step79 / rendered SEO canonical and language stability', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('serves canonical local routes and excludes private project files', async () => {
    for (const url of ['/', '/app', '/?lang=en', '/app?lang=ar', '/sitemap.xml', '/robots.txt', '/og-preview.png']) {
      const response = await fetch(BASE + url); assert.equal(response.status, 200, url);
    }
    for (const url of ['/tests/step79-seo-audit.test.mjs', '/tools/serve.py', '/.git/HEAD', '/node_modules/', '/missing']) {
      const response = await fetch(BASE + url); assert.equal(response.status, 404, url);
    }
  });
  it('serves translated pages and crawlable links without JavaScript', async () => {
    const page = await freshPage(browser);
    try {
      await page.setJavaScriptEnabled(false);
      for (const url of ['/?lang=en', '/app?lang=en']) {
        await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.$eval('html', e => e.lang), 'en');
        assert.equal(await page.$$eval('nav[data-language-links] a', a => a.length), 5);
        assert.equal(await page.$$eval('head link[rel="canonical"]', a => a.length), 1);
      }
      assert.match(await page.$eval('noscript', e => e.textContent), /JavaScript/);
    } finally { await page.close(); }
  });
  for (const file of ['index.html', 'app.html']) {
    it(`${file} has a deterministic German default despite browser and saved language`, async () => {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => { localStorage.setItem('signalcraft_lang', 'es'); Object.defineProperty(navigator, 'languages', { get: () => ['en-US'] }); });
        await stubMarket(page); await page.goto(BASE + '/' + file, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.$eval('html', e => e.lang), 'de');
        const expected = 'https://signalcraft.click/' + (file === 'app.html' ? 'app' : '');
        assert.equal(await page.$eval('link[rel="canonical"]', e => e.href), expected);
        assert.equal(new URL(page.url()).searchParams.has('lang'), false);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
    it(`${file} has one correctly localized canonical and structured page for each explicit language`, async () => {
      const page = await freshPage(browser);
      try {
        await stubMarket(page);
        for (const lang of langs) {
          await page.goto(BASE + '/' + file + '?lang=' + lang + '&campaign=test', { waitUntil: 'domcontentloaded' });
          const got = await page.evaluate(() => {
            const nodes = [...document.head.querySelectorAll('link[rel="canonical"]')];
            const graph = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
            const web = graph.find(x => x['@type'] === 'WebPage');
            return { lang: document.documentElement.lang, links: nodes.map(n => n.href), title: document.title, desc: document.querySelector('meta[name="description"]').content, web, og: document.querySelector('meta[property="og:url"]').content, ogAlt: document.querySelector('meta[property="og:image:alt"]').content, twAlt: document.querySelector('meta[name="twitter:image:alt"]').content };
          });
          const expected = 'https://signalcraft.click/' + (file === 'app.html' ? 'app' : '') + (lang === 'de' ? '' : '?lang=' + lang);
          assert.equal(got.lang, lang); assert.deepEqual(got.links, [expected]); assert.equal(got.og, expected);
          assert.equal(got.web.url, expected); assert.equal(got.web.inLanguage, lang); assert.equal(got.web.name, got.title); assert.equal(got.web.description, got.desc);
          assert.ok(got.ogAlt); assert.equal(got.ogAlt, got.twAlt);
        }
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
