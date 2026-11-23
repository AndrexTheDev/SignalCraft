import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp } from '../helpers/browser.mjs';
let browser;
describe('step58 / view positions and snapshot sorting', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('explains that positions refer to the filtered view and updates them with sorting', async () => {
    const page = await freshPage(browser);
    try {
      await gotoApp(page, { lang: 'en' });
      assert.match(await page.$eval('#boardRankNote', e => e.textContent), /before filters.*current view/i);
      const firstBefore = await page.$eval('.signal-card .sc-asset-title', e => e.textContent);
      await page.select('#sortSelect', 'risk');
      const firstAfter = await page.$eval('.signal-card .sc-asset-title', e => e.textContent);
      assert.notEqual(firstAfter, firstBefore);
      assert.match(await page.$eval('.signal-card .rank-badge', e => e.textContent), /#1.*position/i);
      await page.type('#pairSearchInput', 'BTC');
      assert.equal(await page.$$eval('.signal-card', cards => cards.length), 1);
      assert.match(await page.$eval('.signal-card .rank-badge', e => e.textContent), /#1.*position/i);
      assert.match(await page.$eval('#resultsStatus', e => e.textContent), /1 of 10/);
      assert.match(await page.$eval('#sortSelect option[value="time"]', e => e.textContent), /snapshot.*same/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('localizes the view-position explanation and shared timestamp in all languages', async () => {
    const notes = { de: /Ansicht/, en: /current view/, es: /vista actual/, ar: /العرض الحالي/, zh: /当前视图/ };
    const times = { de: /Snapshot.*gleich/, en: /snapshot.*same/i, es: /instantánea.*misma/i, ar: /اللقطة.*نفس/, zh: /快照.*相同/ };
    for (const lang of Object.keys(notes)) {
      const page = await freshPage(browser);
      try {
        await gotoApp(page, { lang });
        assert.match(await page.$eval('#boardRankNote', e => e.textContent), notes[lang]);
        assert.match(await page.$eval('#sortSelect option[value="time"]', e => e.textContent), times[lang]);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
