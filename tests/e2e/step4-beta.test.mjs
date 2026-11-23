import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp, liveTestCandles, VIEWPORTS
} from '../helpers/browser.mjs';

let browser;

describe('step4 beta', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('happy path: landing → terminal → AAVE → dossier → share', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en', viewport: VIEWPORTS.desktop, marketKlines:liveTestCandles() });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[data-terminal-link]')
    ]);
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.type('#pairSearchInput', 'AAVE');
    await new Promise((r) => setTimeout(r, 250));
    const title = await page.$eval('.sc-asset-title', (el) => el.textContent);
    assert.match(title, /AAVE/i);
    await page.click('[data-inspect-sig]');
    assert.match(await page.$eval('#dossierModalBackdrop', (el) => el.className), /is-visible/);
    await page.click('#btnCloseDossierModal');
    await page.click('[data-share-sig]');
    assert.match(await page.$eval('#shareCardModalBackdrop', (el) => el.className), /is-visible/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('mobile 390px: no horizontal overflow, cards stack', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de', viewport: VIEWPORTS.mobile });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 12, 'overflow ' + overflow);
    const cardWidth = await page.$eval('.signal-card', (el) => el.getBoundingClientRect().width);
    assert.ok(cardWidth > 280);
    assert.ok(cardWidth <= 390);
    await page.close();
  });

  it('tablet 768px landing remains usable', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'es', viewport: VIEWPORTS.tablet });
    assert.ok(await page.$('.hero-title'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 12, 'overflow ' + overflow);
    await page.close();
  });

  it('Arabic RTL terminal: dir=rtl and AAVE search', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'ar', viewport: VIEWPORTS.desktop });
    assert.equal(await page.$eval('html', (el) => el.getAttribute('dir')), 'rtl');
    await page.type('#pairSearchInput', 'AAVE');
    await new Promise((r) => setTimeout(r, 250));
    const titles = await page.$$eval('.sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.some((t) => /AAVE/i.test(t)), titles.join('|'));
    await page.close();
  });

  it('empty search shows empty-state copy', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.type('#pairSearchInput', 'ZZZNOCOIN999');
    await new Promise((r) => setTimeout(r, 250));
    const text = await page.$eval('#signalsGrid', (el) => el.textContent);
    assert.match(text, /No signals|Keine Signale|No se encontraron|لا توجد|没有信号/i);
    await page.close();
  });

  it('exclusive board shows all gated setups at once (no pager)', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(n, 10);
    await page.close();
  });

  it('language select has aria-label; FAQ link works', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const aria = await page.$eval('#langSelect', (el) => el.getAttribute('aria-label'));
    assert.match(aria, /Language|Sprache/i);
    await page.click('a[href="#faq"]');
    assert.ok(await page.$('#faq'));
    await page.close();
  });

  it('guide button scrolls to FAQ', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    await page.click('#btnOpenGuideModal');
    await new Promise((r) => setTimeout(r, 900));
    const top = await page.$eval('#faq', (el) => el.getBoundingClientRect().top);
    assert.ok(top < 200, 'faq top ' + top);
    await page.close();
  });

  it('theme select applies Terminal Amber immediately (no unlock step)', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.select('#themeSelect', 'terminal-amber');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('data-theme')), 'terminal-amber');
    await page.close();
  });

  it('supporter flow: honor-system badge activates without any unlock wall', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('#btnOpenDonation');
    await page.click('#btnDonated');
    await page.waitForSelector('#editorialToast.is-active');
    await page.select('#themeSelect', 'terminal-amber');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('data-theme')), 'terminal-amber');
    await page.close();
  });

  it('grade chips render on the first page', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const chips = await page.$$eval('.grade-chip', (els) => els.map((e) => e.textContent).join(' '));
    assert.match(chips, /GRADE\s+(A\+|A|B\+|B)/);
    await page.close();
  });

  it('cards expose take-profit levels', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const levels = await page.$eval('.sc-levels-grid', (el) => el.textContent);
    assert.match(levels, /TAKE PROFIT|TAKE-PROFIT|止盈|أخذ الربح/i);
    await page.close();
  });
});
