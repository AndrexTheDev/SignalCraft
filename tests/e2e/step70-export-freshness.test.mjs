import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const source = read('app.html');
const html = source.replace('    ME.refresh(false);', '    window.__export70 = { ME }; ME.refresh(false);');
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear(); window._now70 = Date.now(); Date.now = () => window._now70;
    window._downloads70 = [];
    HTMLAnchorElement.prototype.click = function () { window._downloads70.push({ href: this.href, name: this.download }); };
  });
  await stubMarket(page, { appHtml: html, klines: liveTestCandles() });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  await page.evaluate(() => document.querySelector('[data-share-sig]').click());
  assert.equal(await page.$eval('#btnDownloadCardPng', e => e.disabled), false);
  return page;
}
describe('step70 / PNG export freshness', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('starts a valid current PNG download with the signal filename', async () => {
    const page = await open();
    try {
      await page.evaluate(() => document.querySelector('#btnDownloadCardPng').click());
      const result = await page.evaluate(() => window._downloads70);
      assert.equal(result.length, 1); assert.match(result[0].name, /^Signalcraft-[A-Z0-9]+\.png$/); assert.match(result[0].href, /^data:image\/png;base64,/);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /download started/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not serialize or download after the snapshot is already expired', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { window._calls70 = 0; document.querySelector('#shareCardCanvas').toDataURL = () => { window._calls70++; return 'data:image/png;base64,YWJj'; }; window._now70 += 90000; document.querySelector('#btnDownloadCardPng').click(); });
      assert.equal(await page.evaluate(() => window._calls70), 0);
      assert.equal(await page.evaluate(() => window._downloads70.length), 0);
      assert.match(await page.$eval('#meBadge', e => e.textContent), /unavailable/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not download a snapshot that expires while the PNG is being serialized', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { window._now70 += 89999; document.querySelector('#shareCardCanvas').toDataURL = function () { const result = HTMLCanvasElement.prototype.toDataURL.call(this, 'image/png'); window._now70 += 2; return result; }; document.querySelector('#btnDownloadCardPng').click(); });
      assert.equal(await page.evaluate(() => window._downloads70.length), 0);
      assert.match(await page.$eval('#meBadge', e => e.textContent), /unavailable/i);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('rejects a result from a different snapshot even if it remains fresh', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { document.querySelector('#shareCardCanvas').toDataURL = function () { const result = HTMLCanvasElement.prototype.toDataURL.call(this, 'image/png'); window.__export70.ME.apply([], 'unavailable', null); return result; }; document.querySelector('#btnDownloadCardPng').click(); });
      assert.equal(await page.evaluate(() => window._downloads70.length), 0);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('reports serialization exceptions and distinguishes expiry during an exception', async () => {
    const page = await open();
    try {
      await page.evaluate(() => { document.querySelector('#shareCardCanvas').toDataURL = () => { throw new Error('encoding failed'); }; document.querySelector('#btnDownloadCardPng').click(); });
      assert.equal(await page.evaluate(() => window._downloads70.length), 0);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /could not be created/i);
      await page.evaluate(() => { window._now70 += 89999; document.querySelector('#shareCardCanvas').toDataURL = () => { window._now70 += 2; throw new Error('encoding failed'); }; document.querySelector('#btnDownloadCardPng').click(); });
      assert.equal(await page.evaluate(() => window._downloads70.length), 0);
      assert.match(await page.$eval('#meBadge', e => e.textContent), /unavailable/i);
      assert.match(await page.$eval('#toastMessage', e => e.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  for (const invalid of ['data:,', 'data:image/png;base64,', 'data:image/png;base64,YWJj', 'data:image/jpeg;base64,YWJj']) {
    it('reports an invalid serialized PNG without starting a download: ' + invalid, async () => {
      const page = await open();
      try {
        await page.evaluate(value => { document.querySelector('#shareCardCanvas').toDataURL = () => value; document.querySelector('#btnDownloadCardPng').click(); }, invalid);
        assert.equal(await page.evaluate(() => window._downloads70.length), 0);
        assert.match(await page.$eval('#toastMessage', e => e.textContent), /could not be created/i);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
