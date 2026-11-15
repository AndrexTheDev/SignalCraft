import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding
} from '../helpers/browser.mjs';

let browser;

describe('step19 integrity e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('a stale legacy lead key in storage does not crash the board or pollute Object', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', storage: { signalcraft_leads: '{"email":"x","__proto__":{"pwn":1}}' } });
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(n > 0);
    const polluted = await page.evaluate(() => ({}.pwn === 1));
    assert.equal(polluted, false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('garbage live cache is ignored and seed cards still render', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, {
      lang: 'en',
      storage: { signalcraft_live_v1: JSON.stringify({ t: Date.now(), signals: 'x'.repeat(120) }) }
    });
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(n > 3, 'cards ' + n);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('unknown ?sig= does not open a dossier or throw', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { sig: 'SIG-NOPE-000' } });
    await new Promise((r) => setTimeout(r, 500));
    const open = await page.$eval('#dossierModalBackdrop', (el) => el.classList.contains('is-visible'));
    assert.equal(open, false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('?lang=zz falls back instead of setting html lang=zz', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'zz' });
    const lang = await page.$eval('html', (el) => el.getAttribute('lang'));
    assert.notEqual(lang, 'zz');
    assert.match(lang, /^(de|en|es|ar|zh)$/);
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(n > 0);
    await page.close();
  });

  it('bogus saved theme falls back to gallery-dark', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', storage: { signalcraft_theme: 'hacker-neon' } });
    const theme = await page.$eval('html', (el) => el.getAttribute('data-theme'));
    assert.equal(theme, 'gallery-dark');
    await page.close();
  });

  it('exclusive board has no pagination remnants anywhere', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    assert.equal(await page.$('#btnNextPage'), null);
    assert.equal(await page.$('#btnPrevPage'), null);
    assert.equal(await page.$('#btnNextPageBottom'), null);
    assert.equal(await page.$('#btnPrevPageBottom'), null);
    assert.equal(await page.$('#paginationInfoLabel'), null);
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(n, 10);
    await page.close();
  });

  it('dossier copy button writes levels to the clipboard', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.evaluate(() => {
      window.__clip = '';
      navigator.clipboard.writeText = (t) => { window.__clip = String(t); return Promise.resolve(); };
    });
    await page.click('[data-inspect-sig]');
    await page.waitForSelector('#dossierModalBackdrop.is-visible');
    await page.click('#btnCopyDossierData');
    await new Promise((r) => setTimeout(r, 120));
    const clip = await page.evaluate(() => window.__clip);
    assert.match(clip, /Entry:/);
    assert.match(clip, /SL:/);
    assert.match(clip, /Signalcraft/);
    await page.close();
  });

  it('sentiment meter width is a numeric percentage', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('.sentiment-pill-btn');
    await page.waitForSelector('.sentiment-drawer-panel.is-open');
    const w = await page.$eval('.sentiment-drawer-panel.is-open .sentiment-meter-fill', (el) => el.style.width);
    assert.match(w, /^\d+(\.\d+)?%$/);
    const n = Number(w.replace('%', ''));
    assert.ok(n >= 0 && n <= 100);
    await page.close();
  });


  it('landing and terminal boot without page errors', async () => {
    const land = await freshPage(browser);
    await gotoLanding(land, { lang: 'en' });
    assert.deepEqual(land._pageErrors, []);
    await land.close();
    const appPage = await freshPage(browser);
    await gotoApp(appPage, { lang: 'en' });
    assert.deepEqual(appPage._pageErrors, []);
    await appPage.close();
  });
});
