import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding
} from '../helpers/browser.mjs';

let browser;

async function seoHead(page) {
  return page.evaluate(() => ({
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    desc: (document.querySelector('meta[name="description"]') || {}).content || '',
    canonical: (document.querySelector('link[rel="canonical"]') || {}).href || '',
    ogUrl: (document.querySelector('meta[property="og:url"]') || {}).content || '',
    ogLocale: (document.querySelector('meta[property="og:locale"]') || {}).content || '',
    ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || '',
    twTitle: (document.querySelector('meta[name="twitter:title"]') || {}).content || '',
    main: !!document.querySelector('main.editorial-shell')
  }));
}

describe('step17 seo e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('landing ?lang=en localizes title, description, canonical and og:locale', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const h = await seoHead(page);
    assert.equal(h.lang, 'en');
    assert.match(h.title, /Crypto Signals/i);
    assert.match(h.desc, /B\+/);
    assert.equal(h.canonical, 'https://signalcraft.click/index.html?lang=en');
    assert.equal(h.ogUrl, h.canonical);
    assert.equal(h.ogLocale, 'en_US');
    assert.equal(h.main, true);
    await page.close();
  });

  it('landing language switch to German drops ?lang= from the canonical', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.select('#langSelect', 'de');
    await new Promise((r) => setTimeout(r, 120));
    const h = await seoHead(page);
    assert.equal(h.lang, 'de');
    assert.match(h.title, /Krypto-Signale/);
    assert.equal(h.canonical, 'https://signalcraft.click/index.html');
    assert.equal(h.ogLocale, 'de_DE');
    await page.close();
  });

  it('terminal ?lang=es localizes title, description and og tags', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'es' });
    const h = await seoHead(page);
    assert.equal(h.lang, 'es');
    assert.match(h.title, /Signalcraft/);
    assert.match(h.desc, /B\+/);
    assert.equal(h.canonical, 'https://signalcraft.click/app.html?lang=es');
    assert.equal(h.ogUrl, h.canonical);
    assert.equal(h.ogLocale, 'es_ES');
    assert.equal(h.main, true);
    await page.close();
  });

  it('Arabic terminal sets lang=ar, dir=rtl and ar_SA locale', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'ar' });
    const h = await seoHead(page);
    const dir = await page.$eval('html', (el) => el.getAttribute('dir'));
    assert.equal(h.lang, 'ar');
    assert.equal(dir, 'rtl');
    assert.equal(h.ogLocale, 'ar_SA');
    assert.match(h.canonical, /app\.html\?lang=ar/);
    await page.close();
  });
});
