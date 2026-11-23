import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const source = read('app.html');
const instrumented = source.replace('    ME.refresh(false);', '    window.__modalIsolationTest = { ME, setModalVisible };\n    ME.refresh(false);');
let browser;
async function open({ noInert = false, lang = 'en' } = {}) {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(noInert => {
    localStorage.clear();
    if (noInert) Object.defineProperty(HTMLElement.prototype, 'inert', { configurable: true, get() { return false; }, set() {} });
  }, noInert);
  await stubMarket(page, { appHtml: instrumented, klines: liveTestCandles() });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.signal-card') && !document.getElementById('btnRefreshSentimentGlobal').disabled);
  return page;
}
describe('step55 / modal isolation and focus restoration', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('isolates page and skip link, blocks outside focus, and restores the opener', async () => {
    const page = await open({ lang: 'ar' });
    try {
      await page.click('[data-inspect-sig]');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDossierModal');
      for (const selector of ['main.editorial-shell', '#skipToSignals']) {
        assert.equal(await page.$eval(selector, el => el.inert), true);
        assert.equal(await page.$eval(selector, el => el.getAttribute('aria-hidden')), 'true');
      }
      await page.evaluate(() => document.getElementById('pairSearchInput').focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDossierModal');
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
      assert.ok(await page.evaluate(() => document.getElementById('dossierModalBackdrop').contains(document.activeElement)));
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.equal(await page.$eval('#skipToSignals', el => el.hasAttribute('aria-hidden')), false);
      assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-inspect-sig')));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps the lower dialog inaccessible until the nested one closes', async () => {
    const page = await open();
    try {
      await page.click('[data-inspect-sig]');
      await page.focus('[data-possize-equity]');
      await page.evaluate(() => document.getElementById('btnOpenDonation').click());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.inert && el.getAttribute('aria-hidden') === 'true'), true);
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.inert), false);
      await page.evaluate(() => document.querySelector('[data-possize-equity]').focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.inert || el.hasAttribute('aria-hidden')), false);
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), true);
      assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-possize-equity')));
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-inspect-sig')));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps the background blocked if a lower signal dialog is invalidated', async () => {
    const page = await open();
    try {
      await page.click('[data-inspect-sig]');
      await page.focus('[data-possize-equity]');
      await page.evaluate(() => document.getElementById('btnOpenDonation').click());
      await page.evaluate(() => window.__modalIsolationTest.ME.apply([], 'unavailable', null));
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.classList.contains('is-visible') && !el.inert), true);
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'signalsGrid');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps visual layer order correct after an underlying dialog is removed', async () => {
    const page = await open();
    try {
      await page.click('[data-inspect-sig]');
      await page.evaluate(() => document.getElementById('btnOpenDonation').click());
      await page.evaluate(() => window.__modalIsolationTest.ME.apply([], 'unavailable', null));
      await page.evaluate(() => window.__modalIsolationTest.setModalVisible(document.getElementById('shareCardModalBackdrop'), true));
      const layers = await page.evaluate(() => ({
        top: +getComputedStyle(document.getElementById('shareCardModalBackdrop')).zIndex,
        previous: +getComputedStyle(document.getElementById('donationModalBackdrop')).zIndex,
        visibleAtCenter: document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.modal-backdrop')?.id,
        focus: document.activeElement.id
      }));
      assert.ok(layers.top > layers.previous);
      assert.equal(layers.visibleAtCenter, 'shareCardModalBackdrop');
      assert.equal(layers.focus, 'btnCloseShareCardModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('falls back to the board when the opener becomes disabled', async () => {
    const page = await open();
    try {
      await page.click('#btnOpenDonation');
      await page.evaluate(() => { document.getElementById('btnOpenDonation').disabled = true; });
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'signalsGrid');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('also prevents focus escape when inert is unsupported', async () => {
    const page = await open({ noInert: true });
    try {
      await page.click('[data-share-sig]');
      assert.equal(await page.$eval('main.editorial-shell', el => el.getAttribute('aria-hidden')), 'true');
      await page.evaluate(() => document.getElementById('pairSearchInput').focus());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseShareCardModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('main.editorial-shell', el => el.hasAttribute('aria-hidden')), false);
      assert.ok(await page.evaluate(() => document.activeElement.hasAttribute('data-share-sig')));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('restores the page after dismissing by backdrop', async () => {
    const page = await open();
    try {
      await page.click('#btnOpenDonation');
      await page.mouse.click(2, 2);
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), false);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnOpenDonation');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
