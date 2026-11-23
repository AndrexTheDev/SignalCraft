import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seedSignals = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));

let browser;
describe('step33 / accessibility and feedback', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('keeps drawer state and accessible state in sync after a re-render', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en' });
      const selector = '[data-toggle-sentiment]';
      await page.click(selector);
      const id = await page.$eval(selector, b => b.getAttribute('aria-controls'));
      assert.equal(await page.$eval(selector, b => b.getAttribute('aria-expanded')), 'true');
      await page.select('#langSelect', 'de');
      assert.equal(await page.$eval(selector, b => b.getAttribute('aria-expanded')), 'true');
      assert.equal(await page.$eval('[id="' + id + '"]', p => p.classList.contains('is-open')), true);
      await page.click('[data-toggle-chart]');
      assert.equal(await page.$eval('[data-toggle-chart]', b => b.getAttribute('aria-expanded')), 'true');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('traps focus in nested dialogs, closes only the top dialog and restores focus', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en' });
      await page.click('[data-inspect-sig]');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDossierModal');
      await page.evaluate(() => document.getElementById('btnOpenDonation').click());
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.getAttribute('aria-hidden')), 'true');
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnDonated');
      await page.keyboard.press('Escape');
      assert.equal(await page.$eval('#donationModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDossierModal');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-inspect-sig')), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('reports clipboard failures honestly and returns focus after clearing search', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en' });
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }));
      await page.click('[data-copy-levels]');
      await page.waitForFunction(() => document.getElementById('toastMessage').textContent.includes('Copy failed'));
      await page.type('#pairSearchInput', 'BTC');
      await page.click('#clearSearchBtn');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'pairSearchInput');
      assert.equal(await page.$eval('#pairSearchInput', el => el.value), '');
      await page.type('#pairSearchInput', 'not-a-pair');
      assert.match(await page.$eval('#resultsStatus', el => el.textContent), /^0 of /);
      await page.click('#resetFiltersBtn');
      assert.equal(await page.$eval('#pairSearchInput', el => el.value), '');
      assert.equal(await page.$eval('#resetFiltersBtn', el => el.hidden), true);
      assert.ok((await page.$$('#signalsGrid .signal-card')).length > 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('preserves a deep-linked language and keeps mobile controls usable in RTL', async () => {
    const page = await freshPage(browser);
    try {
      await gotoLanding(page, { lang: 'ar', viewport: { width: 320, height: 740 } });
      assert.equal(await page.$eval('a[data-terminal-link]', a => new URL(a.href).searchParams.get('lang')), 'ar');
      assert.match(await page.$eval('[data-i18n="pr_d"]', el => el.textContent), /أثر رجعي/);
      await page.goto(await page.$eval('a[data-terminal-link]', a => a.href), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#signalsGrid .signal-card');
      assert.equal(await page.$eval('html', el => el.dir), 'rtl');
      const sizes = await page.$eval('#pairSearchInput', el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
      assert.ok(sizes.width > 0 && sizes.height >= 44);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('shows observed taker shares and labels demo data and the separate index in every language', async () => {
    const copy = {
      de: [/separat/i, /Kaufanteil/i], en: [/separate/i, /taker-buy share/i],
      es: [/aparte/i, /proporción/i], ar: [/منفصل/, /نسبة/], zh: [/单独/, /占比/]
    };
    for (const [lang, [separate, explanation]] of Object.entries(copy)) {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
        await gotoApp(page, { lang, fng: { value: 63 } });
        await page.click('[data-toggle-sentiment]');
        const id = await page.$eval('#signalsGrid article.signal-card', el => el.getAttribute('data-id'));
        const seed = seedSignals.find(s => s.id === id);
        assert.ok(seed, `missing seed ${id}`);
        const expected = seed.metrics.tb7.toFixed(1) + '% / ' + (100 - seed.metrics.tb7).toFixed(1) + '%';
        assert.equal(await page.$eval('.sentiment-drawer-panel.is-open .taker-split', el => el.textContent), expected);
        const drawer = await page.$eval('.sentiment-drawer-panel.is-open', el => el.textContent);
        assert.match(drawer, /DEMO/);
        assert.match(drawer, separate);
        assert.match(drawer, /63/);
        assert.match(await page.$eval('#faq-panel-1', el => el.textContent), explanation);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });

  it('rejects invalid Fear & Greed values and never injects API classifications as HTML', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en', fng: { value: '63oops', classification: 'Greed' } });
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /F&G –/);
    } finally { await page.close(); }
    const page2 = await freshPage(browser);
    try {
      await gotoApp(page2, { lang: 'en', fng: { value: 63, classification: '<img src=x onerror=alert(1)>' } });
      await page2.click('[data-toggle-sentiment]');
      assert.match(await page2.$eval('#globalFngBadge', el => el.textContent), /Index 63/);
      assert.match(await page2.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value', el => el.textContent), /^63 · .+ UTC$/);
      assert.equal(await page2.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value', el => el.children.length), 0);
      assert.deepEqual(page2._pageErrors, []);
    } finally { await page2.close(); }
  });

});
