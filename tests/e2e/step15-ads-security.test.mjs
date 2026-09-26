import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding
} from '../helpers/browser.mjs';

let browser;

describe('step15 ads security e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('search XSS payload never becomes a DOM node', async () => {
    const page = await freshPage(browser);
    const xss = '<img src=x onerror=alert(1)>';
    await gotoApp(page, { lang: 'en', query: { q: xss }, expectCards: false });
    const injected = await page.evaluate(() => document.querySelectorAll('img[src="x"]').length);
    assert.equal(injected, 0);
    const dialogs = [];
    page.on('dialog', (d) => { dialogs.push(d.type()); d.dismiss(); });
    await new Promise((r) => setTimeout(r, 200));
    assert.deepEqual(dialogs, []);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('ad-gate HTML does not embed the current query string', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { q: '<svg/onload=alert(1)>' }, expectCards: false });
    await page.evaluate(() => window.forceAdBlock(true));
    await new Promise((r) => setTimeout(r, 80));
    const html = await page.$eval('.adgate-card', (el) => el.innerHTML);
    assert.equal(html.includes('onload'), false);
    assert.equal(html.includes('<svg'), false);
    await page.close();
  });

  it('poisoned leads JSON does not escalate via __proto__', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, {
      lang: 'en',
      storage: { signalcraft_leads: '{"__proto__":{"polluted":true}}' }
    });
    const polluted = await page.evaluate(() => ({}.polluted === true));
    assert.equal(polluted, false);
    await page.close();
  });

  it('no javascript: or http:// ad script is present at runtime', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const bad = await page.evaluate(() => {
      const srcs = [...document.querySelectorAll('script[src]')].map((s) => s.src);
      const hrefs = [...document.querySelectorAll('[href]')].map((a) => a.getAttribute('href') || '');
      return {
        httpAd: srcs.filter((s) => s.startsWith('http://') && /immaturelunatic|ads/.test(s)),
        jsHref: hrefs.filter((h) => /^javascript:/i.test(h))
      };
    });
    assert.deepEqual(bad.httpAd, []);
    assert.deepEqual(bad.jsHref, []);
    await page.close();
  });

  it('landing WebDriver path never loads the popunder', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.mouse.move(10, 10);
    await page.mouse.move(10, 0);
    await new Promise((r) => setTimeout(r, 250));
    const hit = await page.evaluate(() => !!document.querySelector('script[src*="eacc536c"]'));
    assert.equal(hit, false);
    await page.close();
  });
});
