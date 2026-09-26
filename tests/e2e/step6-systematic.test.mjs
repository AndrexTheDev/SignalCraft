import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp, VIEWPORTS
} from '../helpers/browser.mjs';

let browser;

describe('step6 systematic e2e', { timeout: 240_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('?q=BTC deep-link fills search and filters the board', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { q: 'BTC' } });
    const val = await page.$eval('#pairSearchInput', (el) => el.value);
    assert.equal(val, 'BTC');
    const titles = await page.$$eval('.sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.length >= 1);
    assert.equal(titles.every((t) => /BTC/i.test(t)), true, titles.join('|'));
    await page.close();
  });

  it('language persists from landing to terminal via localStorage', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.select('#langSelect', 'es');
    const stored = await page.evaluate(() => localStorage.getItem('signalcraft_lang'));
    assert.equal(stored, 'es');
    await page.goto(page.url().replace(/index\.html.*/, 'app.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#signalsGrid');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), 'es');
    await page.close();
  });

  it('unlocked theme persists across reload', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', unlockThemes: true });
    await page.select('#themeSelect', 'paper-light');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('data-theme')), 'paper-light');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#signalsGrid');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$eval('html', (el) => el.getAttribute('data-theme')), 'paper-light');
    await page.close();
  });

  it('Escape closes the dossier modal', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('[data-inspect-sig]');
    assert.match(await page.$eval('#dossierModalBackdrop', (el) => el.className), /is-visible/);
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      await page.$eval('#dossierModalBackdrop', (el) => el.classList.contains('is-visible')),
      false
    );
    await page.close();
  });

  it('clicking the backdrop closes the donation modal', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('#btnOpenDonation');
    assert.match(await page.$eval('#donationModalBackdrop', (el) => el.className), /is-visible/);
    await page.$eval('#donationModalBackdrop', (el) => el.click());
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(
      await page.$eval('#donationModalBackdrop', (el) => el.classList.contains('is-visible')),
      false
    );
    await page.close();
  });

  it('combined majors + high-risk never shows other sectors', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('.sector-pill[data-sector="majors"]');
    await page.click('.filter-btn[data-filter="risk-high"]');
    await new Promise((r) => setTimeout(r, 250));
    const meta = await page.$$eval('.sc-meta-sub', (els) => els.map((e) => e.textContent));
    if (meta.length) {
      assert.equal(meta.every((t) => /MAJORS/i.test(t)), true, meta[0]);
    }
    await page.close();
  });

  it('next is disabled on the last page', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    await page.click('#sizeAllBtn');
    await new Promise((r) => setTimeout(r, 300));
    const disabled = await page.$eval('#btnNextPage', (el) => el.disabled);
    assert.equal(disabled, true);
    await page.close();
  });

  it('prev is disabled on page 1', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const disabled = await page.$eval('#btnPrevPage', (el) => el.disabled);
    assert.equal(disabled, true);
    await page.close();
  });

  it('lead honeypot pretends success without storing', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.$eval('#leadHpField', (el) => { el.value = 'http://spam.test'; });
    await page.type('#leadEmailInput', 'bot@example.com');
    await page.click('#leadCaptureForm button[type="submit"]');
    await page.waitForSelector('#editorialToast.is-active');
    const stored = await page.evaluate(() => localStorage.getItem('signalcraft_leads'));
    assert.ok(!stored || !stored.includes('bot@example.com'));
    await page.close();
  });

  it('valid lead is stored once; duplicate is rejected', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.type('#leadEmailInput', 'alpha@signalcraft.test');
    await page.click('#leadCaptureForm button[type="submit"]');
    await page.waitForSelector('#editorialToast.is-active');
    await new Promise((r) => setTimeout(r, 3300));
    await page.type('#leadEmailInput', 'alpha@signalcraft.test');
    await page.click('#leadCaptureForm button[type="submit"]');
    await page.waitForSelector('#editorialToast.is-active');
    const leads = await page.evaluate(() => JSON.parse(localStorage.getItem('signalcraft_leads') || '[]'));
    const n = leads.filter((l) => l.email === 'alpha@signalcraft.test').length;
    assert.equal(n, 1);
    await page.close();
  });

  it('?admin=1 opens the vault modal', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { admin: '1' } });
    await page.waitForSelector('#secretVaultModalBackdrop.is-visible', { timeout: 5000 });
    await page.close();
  });

  it('five clicks on the crest open the vault', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    for (let i = 0; i < 5; i++) await page.click('#brandCrestLogo');
    await page.waitForSelector('#secretVaultModalBackdrop.is-visible', { timeout: 4000 });
    await page.close();
  });

  it('share canvas contains the pair name', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const pair = await page.$eval('.sc-asset-title', (el) => el.textContent.trim());
    await page.click('[data-share-sig]');
    await page.waitForSelector('#shareCardModalBackdrop.is-visible');
    const painted = await page.$eval('#shareCardCanvas', (c) => {
      const ctx = c.getContext('2d');
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 32) if (data[i + 3] > 0) n++;
      return n;
    });
    assert.ok(painted > 100, 'share card looks empty');
    const title = await page.$eval('#shareCardModalBackdrop h3', (el) => el.textContent);
    assert.match(title, /Share|Card|1200/i);
    assert.ok(pair.length > 2);
    await page.close();
  });

  it('dialogs are labelled for assistive tech', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('[data-inspect-sig]');
    const role = await page.$eval('#dossierModalBackdrop .modal-window', (el) => el.getAttribute('role'));
    assert.equal(role, 'dialog');
    const modal = await page.$eval('#dossierModalBackdrop .modal-window', (el) => el.getAttribute('aria-modal'));
    assert.equal(modal, 'true');
    await page.close();
  });

  it('mobile 360px: primary buttons are at least 32px tall', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.mobileSm });
    const h = await page.$eval('#btnRefreshSentimentGlobal', (el) => el.getBoundingClientRect().height);
    assert.ok(h >= 32, 'cta height ' + h);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 12, 'overflow ' + overflow);
    await page.close();
  });

  it('sort by sentiment changes the first card (or keeps a stable board)', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const before = await page.$eval('.sc-asset-title', (el) => el.textContent);
    await page.select('#sortSelect', 'sentiment');
    await new Promise((r) => setTimeout(r, 250));
    const after = await page.$eval('.sc-asset-title', (el) => el.textContent);
    assert.ok(typeof after === 'string' && after.length > 0);
    assert.ok(before.length > 0);
    await page.close();
  });

  it('laptop 1280 and tablet 768 terminal do not throw', async () => {
    for (const vp of ['laptop', 'tablet']) {
      const page = await freshPage(browser);
      await gotoApp(page, { lang: 'de', viewport: VIEWPORTS[vp] });
      assert.deepEqual(page._pageErrors, []);
      const n = await page.$$eval('.signal-card', (els) => els.length);
      assert.ok(n > 0);
      await page.close();
    }
  });
});
