import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, stubMarket, BASE
} from '../helpers/browser.mjs';

let browser;

async function blockStorage(page) {
  await page.evaluateOnNewDocument(() => {
    const boom = function () { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    const fake = {
      getItem: boom,
      setItem: boom,
      removeItem: boom,
      clear: boom,
      key: boom,
      get length() { return 0; }
    };
    try { Object.defineProperty(window, 'localStorage', { configurable: true, value: fake }); } catch (e) {}
    try { Object.defineProperty(window, 'sessionStorage', { configurable: true, value: fake }); } catch (e) {}
  });
}

describe('step29 storage e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('blocked localStorage still paints the gated board without page errors', async () => {
    const page = await freshPage(browser);
    await blockStorage(page);
    await stubMarket(page);
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 750));
    const gate = await page.$('.adgate-card');
    assert.equal(gate, null);
    const n = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(n, 10);
    const badge = await page.$eval('#meBadge', (el) => el.textContent);
    assert.match(badge, /DEMO/);
    await page.select('#langSelect', 'de');
    const lang = await page.$eval('html', (el) => el.getAttribute('lang'));
    assert.equal(lang, 'de');
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('landing still boots with blocked storage and no page errors', async () => {
    const page = await freshPage(browser);
    await blockStorage(page);
    await stubMarket(page);
    await page.goto(BASE + '/index.html?lang=en', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('h1', { timeout: 10000 });
    const h1 = await page.$eval('h1', (el) => el.textContent);
    assert.match(h1, /Signalcraft/);
    await page.select('#langSelect', 'es');
    const lang = await page.$eval('html', (el) => el.getAttribute('lang'));
    assert.equal(lang, 'es');
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
