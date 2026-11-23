import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoLanding } from '../helpers/browser.mjs';

let browser;
describe('step21 / live-only landing', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
    it(`shows no historical track record or sample signals in ${lang}`, async () => {
      const page = await freshPage(browser);
      try {
        await gotoLanding(page, { lang });
        assert.equal(await page.$('#proofHitPct, .proof-grades, #radRow1'), null);
        const text = await page.evaluate(() => document.body.innerText);
        assert.doesNotMatch(text, /\bDEMO\b|91\/100|88\/100|BUILD SNAPSHOT/i);
        assert.ok(await page.$('a[data-terminal-link]'));
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
  it('keeps the terminal link usable after switching language', async () => {
    const page = await freshPage(browser);
    try {
      await gotoLanding(page, { lang: 'en' });
      await page.select('#langSelect', 'es');
      assert.match(await page.$eval('a[data-terminal-link]', el => el.getAttribute('href')), /^\/app\?lang=es$/);
      assert.equal(await page.$('#proofHitPct'), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
