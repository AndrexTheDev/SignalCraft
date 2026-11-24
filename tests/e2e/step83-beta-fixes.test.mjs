import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE } from '../helpers/browser.mjs';
const languages = ['de','en','es','ar','zh']; let browser;
describe('step83 / beta-report improvements', {timeout:60000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('serves provider and privacy pages and a usable true 404 without JavaScript', async () => {
    for (const path of ['/impressum','/datenschutz']) {
      const r = await fetch(BASE + path); assert.equal(r.status,200); const body = await r.text();
      for (const lang of languages) assert.match(body, new RegExp(`id="${lang}"`));
    }
    const r = await fetch(BASE + '/not-a-page-xyz'); assert.equal(r.status,404);
    assert.match(await r.text(), /Page not found/);
    const head = await fetch(BASE + '/not-a-page-xyz', {method:'HEAD'}); assert.equal(head.status,404); assert.equal(await head.text(),'');
    const page = await freshPage(browser);
    try {
      await page.setJavaScriptEnabled(false);
      for (const lang of languages) for (const path of ['/','/app']) {
        await page.goto(BASE + path + '?lang=' + lang, {waitUntil:'domcontentloaded'});
        const links = await page.$$eval('a[href^="/impressum"],a[href^="/datenschutz"]', els => els.map(a => a.getAttribute('href')));
        assert.deepEqual(links, ['/impressum#'+lang, '/datenschutz#'+lang]);
      }
    } finally { await page.close(); }
  });
  it('loads actual local font assets and never contacts Google Fonts', async () => {
    const page = await freshPage(browser), requests = [];
    try {
      page.on('request', request => requests.push(request.url()));
      await stubMarket(page);
      await page.goto(BASE+'/?lang=en',{waitUntil:'domcontentloaded'});
      const loaded = await page.evaluate(async () => {
        const fonts = await Promise.all(['400 16px "Plus Jakarta Sans"','400 16px "Cormorant Garamond"','400 16px "JetBrains Mono"'].map(x => document.fonts.load(x)));
        return fonts.map(x => x.length);
      });
      assert.ok(loaded.every(n => n > 0), JSON.stringify(loaded));
      assert.ok(requests.some(u => /\/assets\/fonts\/.*woff2/.test(u)));
      assert.ok(requests.every(u => !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u)));
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
});
