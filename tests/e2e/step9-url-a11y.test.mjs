import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding
} from '../helpers/browser.mjs';

let browser;

function params(url) {
  return new URL(url).searchParams;
}

describe('step9 url + a11y e2e', { timeout: 240_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('?sector=majors filters the board and keeps live major setups', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { sector: 'majors' } });
    const ids = await page.$$eval(
      '#signalsGrid article.signal-card',
      (els) => els.map((e) => e.getAttribute('data-id'))
    );
    assert.ok(ids.length > 0);
    assert.ok(ids.every(id => /^SIG-[A-Z0-9]+-\d+$/.test(id)), ids.join(','));
    const titles = await page.$$eval('#signalsGrid .sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.equal(titles.some((t) => /PEPE/i.test(t)), false);
    assert.equal(params(page.url()).get('sector'), 'majors');
    const pressed = await page.$eval('.sector-pill[data-sector="majors"]', (el) => el.getAttribute('aria-pressed'));
    assert.equal(pressed, 'true');
    await page.close();
  });

  it('filter/search/sort write sector, risk, q and sort into the URL', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('.sector-pill[data-sector="majors"]');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(params(page.url()).get('sector'), 'majors');
    await page.click('.filter-btn[data-filter="risk-high"]');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(params(page.url()).get('risk'), 'high');
    assert.equal(params(page.url()).get('sector'), 'majors');
    const ids = await page.$$eval(
      '#signalsGrid article.signal-card',
      (els) => els.map((e) => e.getAttribute('data-id'))
    );
    assert.equal(ids.includes('SIG-AAVE-001'), false);
    await page.click('.filter-btn[data-filter="all"]');
    await page.click('.sector-pill[data-sector="all"]');
    await page.type('#pairSearchInput', 'BTC');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(params(page.url()).get('q'), 'BTC');
    await page.select('#sortSelect', 'sentiment');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(params(page.url()).get('sort'), 'sentiment');
    assert.equal(params(page.url()).get('lang'), 'en');
    await page.close();
  });

  it('?sig=SIG-AAVE-001 opens the dossier; close clears sig', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { sig: 'SIG-AAVE-001' } });
    await page.waitForSelector('#dossierModalBackdrop.is-visible', { timeout: 8000 });
    assert.equal(params(page.url()).get('sig'), 'SIG-AAVE-001');
    const title = await page.$eval('#dossierTitle', (el) => el.textContent);
    assert.match(title, /AAVE/);
    await page.click('#btnCloseDossierModal');
    await new Promise((r) => setTimeout(r, 150));
    const visible = await page.$eval('#dossierModalBackdrop', (el) => el.classList.contains('is-visible'));
    assert.equal(visible, false);
    assert.equal(params(page.url()).get('sig'), null);
    await page.close();
  });

  it('FAQ accordion updates aria-expanded', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('#faqSummary');
    const first = await page.$eval('.faq-header-toggle', (el) => el.getAttribute('aria-expanded'));
    assert.equal(first, 'true');
    await page.click('.faq-header-toggle');
    await new Promise((r) => setTimeout(r, 80));
    const after = await page.$eval('.faq-header-toggle', (el) => el.getAttribute('aria-expanded'));
    assert.equal(after, 'false');
    const second = await page.$$('.faq-header-toggle');
    await second[1].click();
    await new Promise((r) => setTimeout(r, 80));
    const exp = await page.$$eval('.faq-header-toggle', (els) => els.map((e) => e.getAttribute('aria-expanded')));
    assert.equal(exp[1], 'true');
    await page.close();
  });

  it('search, sort and close controls have translated aria-labels', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const search = await page.$eval('#pairSearchInput', (el) => el.getAttribute('aria-label'));
    const sort = await page.$eval('#sortSelect', (el) => el.getAttribute('aria-label'));
    const close = await page.$eval('#btnCloseDossierModal', (el) => el.getAttribute('aria-label'));
    assert.match(search, /Search/i);
    assert.match(sort, /Sort/i);
    assert.match(close, /Close/i);
    await page.select('#langSelect', 'de');
    await new Promise((r) => setTimeout(r, 200));
    const deSearch = await page.$eval('#pairSearchInput', (el) => el.getAttribute('aria-label'));
    const deClose = await page.$eval('#btnCloseDossierModal', (el) => el.getAttribute('aria-label'));
    assert.match(deSearch, /suchen|Währung/i);
    assert.match(deClose, /Schlie/i);
    await page.close();
  });

  it('opening a dossier focuses the closer and restore returns to the trigger', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('[data-inspect-sig]');
    await new Promise((r) => setTimeout(r, 120));
    const closeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(closeId, 'btnCloseDossierModal');
    await page.click('#btnCloseDossierModal');
    await new Promise((r) => setTimeout(r, 120));
    const back = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.getAttribute('data-inspect-sig') || el.id) : '';
    });
    assert.ok(back, 'focus was not restored');
    await page.close();
  });

  it('theme-color follows the paper-light theme', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const before = await page.$eval('meta[name="theme-color"]', (el) => el.getAttribute('content'));
    assert.equal(before, '#121316');
    await page.select('#themeSelect', 'paper-light');
    await new Promise((r) => setTimeout(r, 120));
    const after = await page.$eval('meta[name="theme-color"]', (el) => el.getAttribute('content'));
    assert.equal(after, '#F4F1EA');
    await page.close();
  });

  it('landing ships apple-mobile-web-app-capable', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const capable = await page.$eval('meta[name="apple-mobile-web-app-capable"]', (el) => el.getAttribute('content'));
    assert.equal(capable, 'yes');
    await page.close();
  });
});
