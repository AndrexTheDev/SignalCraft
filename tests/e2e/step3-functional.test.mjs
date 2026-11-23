import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp, LANGS
} from '../helpers/browser.mjs';

let browser;

describe('step3 functional', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('landing hero, CTA and FAQ render in DE', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'de' });
    const h1 = await page.$eval('h1', (el) => el.textContent);
    assert.match(h1, /Signalcraft/);
    assert.ok(await page.$('a[data-terminal-link]'));
    assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), 'de');
    await page.close();
  });

  it('landing language switcher: Arabic is RTL', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), 'en');
    await page.select('#langSelect', 'ar');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), 'ar');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('dir')), 'rtl');
    await page.select('#langSelect', 'zh');
    assert.equal(await page.$eval('html', (el) => el.getAttribute('dir')), 'ltr');
    await page.close();
  });

  it('CTA navigates to the terminal', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[data-terminal-link]')
    ]);
    assert.match(new URL(page.url()).pathname, /^\/app$/);
    await page.close();
  });

  it('terminal renders the exclusive Grade-A board, quality note and no pagination', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(n, 10);
    const note = await page.$eval('#qualityGateNote', (el) => el.textContent);
    assert.ok(note.trim().length > 0);
    assert.equal(await page.$('#paginationInfoLabel'), null);
    await page.close();
  });

  it('search finds a live board symbol and clear resets', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const symbol = await page.$eval('#signalsGrid .sc-asset-title', el => el.textContent.trim().split(/\s/)[0]);
    await page.type('#pairSearchInput', symbol);
    await new Promise((r) => setTimeout(r, 250));
    const titles = await page.$$eval('#signalsGrid .sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.some((t) => t.includes(symbol)), titles.join('|'));
    await page.click('#clearSearchBtn');
    const val = await page.$eval('#pairSearchInput', (el) => el.value);
    assert.equal(val, '');
    await page.close();
  });

  it('risk filter and sector pills narrow the board', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const expectedHigh = await page.$$eval('#signalsGrid .risk-badge.risk-high', els => els.length);
    const expectedMajors = await page.$eval('.sector-pill[data-sector="majors"]', el => Number((el.textContent.match(/\((\d+)\)/) || [])[1]));
    await page.click('.filter-btn[data-filter="risk-high"]');
    await new Promise((r) => setTimeout(r, 200));
    const high = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(high, expectedHigh);
    await page.click('.filter-btn[data-filter="all"]');
    await page.click('.sector-pill[data-sector="majors"]');
    await new Promise((r) => setTimeout(r, 200));
    const majors = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(majors, expectedMajors);
    await page.close();
  });

  it('exclusive board renders all 10 setups without a pager', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.equal(n, 10);
    assert.equal(await page.$('#btnNextPage'), null);
    assert.equal(await page.$('#btnPrevPage'), null);
    await page.close();
  });

  it('sort select does not throw', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.select('#sortSelect', 'sentiment');
    await page.select('#sortSelect', 'risk');
    await page.select('#sortSelect', 'time');
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('sentiment drawer toggles open', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('.sentiment-pill-btn');
    await page.waitForSelector('.sentiment-drawer-panel.is-open');
    await page.close();
  });

  it('chart drawer paints a canvas', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('[data-toggle-chart]');
    await page.waitForSelector('.chart-drawer-panel.is-open');
    await new Promise((r) => setTimeout(r, 400));
    const painted = await page.evaluate(() => {
      const c = document.querySelector('.chart-drawer-panel.is-open canvas');
      if (!c) return { ok: false, why: 'no-canvas' };
      const ctx = c.getContext('2d');
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let paintedPx = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] + data[i + 1] + data[i + 2] + data[i + 3] > 0) paintedPx++;
      }
      return { ok: paintedPx > 10, paintedPx, w: c.width, h: c.height };
    });
    assert.equal(painted.ok, true, JSON.stringify(painted));
    await page.close();
  });

  it('dossier modal opens with levels and copy button', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    await page.click('[data-inspect-sig]');
    const cls = await page.$eval('#dossierModalBackdrop', (el) => el.className);
    assert.match(cls, /is-visible/);
    const body = await page.$eval('#dossierBody', (el) => el.textContent);
    assert.match(body, /Stop|SL|Einstieg|Entry/i);
    assert.ok(await page.$('#btnCopyDossierData'));
    await page.click('#btnCloseDossierModal');
    await page.close();
  });

  it('share card is 1200x675 and share-direct exists', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('[data-share-sig]');
    const cls = await page.$eval('#shareCardModalBackdrop', (el) => el.className);
    assert.match(cls, /is-visible/);
    const size = await page.$eval('#shareCardCanvas', (c) => ({ w: c.width, h: c.height }));
    assert.deepEqual(size, { w: 1200, h: 675 });
    assert.ok(await page.$('#btnShareCardDirect'));
    await page.close();
  });

  it('all three themes apply without any unlock step', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    for (const theme of ['terminal-amber', 'paper-light', 'gallery-dark']) {
      await page.select('#themeSelect', theme);
      assert.equal(await page.$eval('html', (el) => el.getAttribute('data-theme')), theme);
    }
    await page.close();
  });

  it('donation modal opens from the masthead button', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    await page.click('#btnOpenDonation');
    const cls = await page.$eval('#donationModalBackdrop', (el) => el.className);
    assert.match(cls, /is-visible/);
    await page.click('#btnCloseDonationModal');
    await page.close();
  });

  it('FAQ accordion toggles', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const items = await page.$$('.faq-accordion-item');
    await items[1].$eval('.faq-header-toggle', (el) => el.click());
    const open = await items[1].evaluate((el) => el.classList.contains('is-open'));
    assert.equal(open, true);
    await page.close();
  });


  for (const lang of LANGS) {
    it(`?lang=${lang} sets html lang`, async () => {
      const page = await freshPage(browser);
      await gotoApp(page, { lang });
      assert.equal(await page.$eval('html', (el) => el.getAttribute('lang')), lang);
      if (lang === 'ar') {
        assert.equal(await page.$eval('html', (el) => el.getAttribute('dir')), 'rtl');
      }
      await page.close();
    });
  }
});
