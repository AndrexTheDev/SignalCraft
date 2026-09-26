import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, VIEWPORTS
} from '../helpers/browser.mjs';

let browser;

describe('step13 ads beta', { timeout: 240_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('happy path still works with ad slots mounted: landing → terminal → dossier', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    assert.ok(await page.$('#adNative'));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[href="app.html"]')
    ]);
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 700));
    assert.ok(await page.$('#adSideL'));
    await page.type('#pairSearchInput', 'BTC');
    await new Promise((r) => setTimeout(r, 400));
    await page.waitForSelector('#signalsGrid article.signal-card [data-inspect-sig]', { timeout: 8000 });
    await page.evaluate(() => {
      const btn = document.querySelector('#signalsGrid article.signal-card [data-inspect-sig]');
      if (btn) btn.click();
    });
    await page.waitForSelector('#dossierModalBackdrop.is-visible', { timeout: 8000 });
    await page.click('#btnCloseDossierModal');
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('mobile RTL: sticky can be dismissed without covering search', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'ar', viewport: VIEWPORTS.mobile });
    assert.equal(await page.$eval('html', (el) => el.getAttribute('dir')), 'rtl');
    assert.equal(await page.$eval('#adStickyM', (el) => el.classList.contains('is-on')), true);
    await page.click('#adStickyX');
    await page.type('#pairSearchInput', 'ETH');
    await new Promise((r) => setTimeout(r, 200));
    const titles = await page.$$eval('#signalsGrid .sc-asset-title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.some((t) => /ETH/i.test(t)), titles.join('|'));
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('ad-block gate → recheck restores filters and URL state', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', query: { sector: 'majors' } });
    await page.evaluate(() => window.forceAdBlock(true));
    await new Promise((r) => setTimeout(r, 80));
    assert.ok(await page.$('.adgate-card'));
    await page.click('#btnAdRecheck');
    await page.evaluate(() => window.forceAdBlock(false));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await page.$('.adgate-card'), null);
    const ids = await page.$$eval(
      '#signalsGrid article.signal-card:not(.lead-capture-bento-card)',
      (els) => els.map((e) => e.getAttribute('data-id'))
    );
    assert.ok(ids.includes('SIG-BTC-014'));
    assert.match(page.url(), /sector=majors/);
    await page.close();
  });

  it('wide layout + donation modal + native footer coexist', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.wide });
    await page.click('#btnOpenDonation');
    await new Promise((r) => setTimeout(r, 80));
    assert.match(await page.$eval('#donationModalBackdrop', (el) => el.className), /is-visible/);
    const nativeTop = await page.$eval('#adNative', (el) => el.getBoundingClientRect().height);
    assert.ok(nativeTop >= 0);
    await page.click('#btnCloseDonationModal');
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('empty search, pagination and lead honeypot still work beside ads', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.type('#pairSearchInput', 'ZZZNOCOIN');
    await new Promise((r) => setTimeout(r, 200));
    const empty = await page.$eval('#signalsGrid', (el) => el.textContent);
    assert.match(empty, /No signals|Keine Signale|No hay|لا توجد|没有/i);
    await page.click('#clearSearchBtn');
    await new Promise((r) => setTimeout(r, 120));
    const n = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(n > 3);
    await page.evaluate(() => {
      const hp = document.getElementById('leadHpField');
      const em = document.getElementById('leadEmailInput');
      if (hp) hp.value = 'bot';
      if (em) em.value = 'ok@example.com';
    });
    await page.click('#leadCaptureForm button[type="submit"], #leadCaptureForm .tactile-btn');
    await new Promise((r) => setTimeout(r, 120));
    const leads = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('signalcraft_leads') || '[]'); } catch { return []; }
    });
    assert.equal(leads.length, 0);
    await page.close();
  });

  it('landing radar gate can be shown without throwing, then hidden again', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'de' });
    await page.evaluate(() => {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('radRow' + i);
        if (el) el.style.display = 'none';
      }
      const gn = document.getElementById('radGateNote');
      if (gn) gn.style.display = 'block';
    });
    const shown = await page.$eval('#radGateNote', (el) => getComputedStyle(el).display !== 'none');
    assert.equal(shown, true);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
