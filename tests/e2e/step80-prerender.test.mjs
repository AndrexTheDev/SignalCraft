import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE } from '../helpers/browser.mjs';
const langs = ['de', 'en', 'es', 'ar', 'zh'];
let browser;

describe('step80 / prerendered page usability', { timeout: 180000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const path of ['/', '/app']) {
    it(`${path}: raw response and rendered page agree for all languages`, async () => {
      const page = await freshPage(browser);
      try {
        await stubMarket(page);
        for (const lang of langs) {
          const address = BASE + path + (lang === 'de' ? '' : '?lang=' + lang);
          const response = await fetch(address);
          assert.equal(response.status, 200);
          const source = await response.text();
          assert.match(source, new RegExp(`<html lang="${lang}"`));
          await page.goto(address, { waitUntil: 'domcontentloaded' });
          const html = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, canonical: document.querySelector('link[rel="canonical"]').href, h1: document.querySelector('h1').textContent }));
          const canonical = 'https://signalcraft.click' + path + (lang === 'de' ? '' : '?lang=' + lang);
          assert.equal(html.lang, lang); assert.equal(html.canonical, canonical);
          assert.ok(source.includes(html.title)); assert.ok(html.h1.includes('Signalcraft'));
        }
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('returns from an English prerendered landing page to genuine German and back after reload', async () => {
    const page = await freshPage(browser);
    try {
      await stubMarket(page); await page.goto(BASE + '/?lang=en', { waitUntil: 'domcontentloaded' });
      assert.match(await page.$eval('h1', e => e.textContent), /crypto setups/i);
      await page.select('#langSelect', 'de');
      assert.match(await page.$eval('h1', e => e.textContent), /Krypto-Setups/);
      assert.match(await page.$eval('#faq', e => e.textContent), /kostenlos/i);
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.$eval('html', e => e.lang), 'de');
      await page.select('#langSelect', 'en');
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.match(await page.$eval('h1', e => e.textContent), /crypto setups/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('exposes each translated FAQ and its canonical without JavaScript', async () => {
    const page = await freshPage(browser);
    try {
      await page.setJavaScriptEnabled(false);
      for (const path of ['/', '/app']) for (const lang of langs) {
        const query = lang === 'de' ? '' : '?lang=' + lang;
        await page.goto(BASE + path + query, { waitUntil: 'domcontentloaded' });
        assert.equal(await page.$eval('html', el => el.lang), lang);
        assert.equal(await page.$eval('link[rel="canonical"]', el => el.href), 'https://signalcraft.click' + path + query);
        assert.ok((await page.$eval('#faq', el => el.textContent)).trim().length > 100);
        assert.equal(await page.$$eval('[data-language-links] a', a => a.length), 5);
      }
    } finally { await page.close(); }
  });
});
