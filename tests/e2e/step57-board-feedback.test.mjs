import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const source = read('app.html').replace('    ME.refresh(false);', '    window.__boardTest = { ME, seed: SEED_SIGNALS, renderSignals };\n    ME.refresh(false);');
let browser;
async function open(lang = 'en') {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => localStorage.clear());
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: source }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled);
  return page;
}
describe('step57 / board controls and empty-state feedback', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('returns focus to the board when a focused card disappears and no setups remain', async () => {
    const page = await open();
    try {
      await page.focus('[data-inspect-sig]');
      await page.evaluate(() => window.__boardTest.ME.apply(window.__boardTest.seed.map(s => ({ ...s, quantScore: 0 })), 'seed', Date.now()));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'signalsGrid');
      assert.equal(await page.$eval('#resetFiltersBtn', el => el.hidden), true);
      assert.match(await page.$eval('#signalsGrid', el => el.textContent), /no setups.*board/i);
      assert.doesNotMatch(await page.$eval('#signalsGrid', el => el.textContent), /reset.*filter/i);
      assert.match(await page.$eval('#resultsStatus', el => el.textContent), /0 of 0/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('returns focus to the board if a data change leaves an active filter with no results', async () => {
    const page = await open();
    try {
      await page.click('.sector-pill[data-sector="majors"]');
      await page.focus('[data-inspect-sig]');
      await page.evaluate(() => window.__boardTest.ME.apply(window.__boardTest.seed.map(s => ({ ...s, sector: 'ai' })), 'seed', Date.now()));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'signalsGrid');
      assert.match(await page.$eval('#signalsGrid', el => el.textContent), /reset.*filter/i);
      assert.equal(await page.$eval('#resetFiltersBtn', el => el.hidden), false);
      assert.equal(new URL(page.url()).searchParams.get('sector'), 'majors');
      await page.click('#resetFiltersBtn');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'pairSearchInput');
      assert.ok(await page.$('#signalsGrid .signal-card'));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not steal focus from an open modal when the board empties', async () => {
    const page = await open();
    try {
      await page.click('#btnOpenDonation');
      await page.evaluate(() => window.__boardTest.ME.apply(window.__boardTest.seed.map(s => ({ ...s, quantScore: 0 })), 'seed', Date.now()));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnCloseDonationModal');
      assert.equal(await page.$eval('main.editorial-shell', el => el.inert), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnOpenDonation');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('updates the live result count only when it changes', async () => {
    const page = await open();
    try {
      const changes = await page.evaluate(() => {
        const status = document.getElementById('resultsStatus');
        let n = 0; const observer = new MutationObserver(records => { n += records.length; });
        observer.observe(status, { childList: true, characterData: true, subtree: true });
        window.__boardTest.renderSignals();
        const same = observer.takeRecords().length;
        document.getElementById('pairSearchInput').value = 'not-a-pair';
        document.getElementById('pairSearchInput').dispatchEvent(new Event('input', { bubbles: true }));
        const changed = observer.takeRecords().length;
        observer.disconnect();
        return { same, changed, n };
      });
      assert.equal(changes.same, 0);
      assert.ok(changes.changed > 0);
      assert.match(await page.$eval('#resultsStatus', el => el.textContent), /^0 of /);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('has named filter groups and displays the translated sort choice rather than an internal key', async () => {
    const risk = { de: /risiko/i, en: /risk/i, es: /riesgo/i, ar: /المخاطر/, zh: /风险/ };
    for (const lang of Object.keys(risk)) {
      const page = await open(lang);
      try {
        const group = await page.$eval('[data-risk-group]', el => ({ role: el.getAttribute('role'), label: el.getAttribute('aria-label') }));
        assert.equal(group.role, 'group'); assert.match(group.label, risk[lang]);
        assert.equal(await page.$eval('.sector-pills-row', el => el.getAttribute('aria-labelledby')), 'sectorLabel');
        assert.doesNotMatch(await page.$eval('#sortSelect option[value="confluence"]', el => el.textContent), /79%/);
        await page.select('#sortSelect', 'risk');
        const label = await page.$eval('#sortSelect', el => el.selectedOptions[0].textContent);
        assert.ok((await page.$eval('#toastMessage', el => el.textContent)).includes(label));
        await page.evaluate(() => window.__boardTest.ME.apply(window.__boardTest.seed.map(s => ({ ...s, quantScore: 0 })), 'seed', Date.now()));
        assert.match(await page.$eval('#resultsStatus', el => el.textContent), /0/);
        assert.equal(await page.$eval('#resetFiltersBtn', el => el.hidden), true);
        assert.ok((await page.$eval('#signalsGrid', el => el.textContent.trim())).length > 5);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
