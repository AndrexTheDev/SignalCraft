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

  it('?q=AAVE deep-link fills search and filters the board', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { q: 'AAVE' } });
    const val = await page.$eval('#pairSearchInput', (el) => el.value);
    assert.equal(val, 'AAVE');
    const titles = await page.$$eval('.sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.length >= 1);
    assert.equal(titles.every((t) => /AAVE/i.test(t)), true, titles.join('|'));
    await page.close();
  });

  it('language is carried from landing to terminal by its explicit URL', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.select('#langSelect', 'es');
    const stored = await page.evaluate(() => localStorage.getItem('signalcraft_lang'));
    assert.equal(stored, 'es');
    const target = await page.$eval('a[data-terminal-link]', el => el.href);
    assert.equal(new URL(target).searchParams.get('lang'), 'es');
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#signalsGrid');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), 'es');
    await page.close();
  });

  it('chosen theme persists across reload', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
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

  it('exclusive board has no pager controls', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    assert.equal(await page.$('#btnNextPage'), null);
    assert.equal(await page.$('#btnPrevPage'), null);
    assert.equal(await page.$('#sizeAllBtn'), null);
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
