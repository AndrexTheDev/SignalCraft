import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp
} from '../helpers/browser.mjs';
import { read, inlineScripts, extractArray } from '../helpers/html.mjs';
import { trackRecordSetups } from '../helpers/core-logic.mjs';

const landJs = inlineScripts(read('index.html')).join('\n');
const TRACK_SET = Function('return (' + extractArray(landJs, 'var TRACK_SET =') + ')')();
const EXPECT = trackRecordSetups(TRACK_SET);

let browser;

describe('step21 track-record e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('landing paints the computed TP1 hit rate, not a leftover 71%', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'de' });
    const shown = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.equal(shown, EXPECT.hit + '/' + EXPECT.setups);
    assert.match(shown, /^\d+\/\d+$/);
    assert.notEqual(shown, '71%');
    const body = await page.$eval('[data-i18n="pr_d"]', (el) => el.textContent);
    assert.match(body, new RegExp(String(EXPECT.resolved)));
    assert.match(body, new RegExp(String(EXPECT.hit)));
    assert.match(body, new RegExp(String(EXPECT.stop)));
    assert.equal(/\{resolved\}|\{hit\}|\{stop\}/.test(body), false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('grade chips show computed A+ / A counts', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const chips = await page.$$eval('.proof-grades span', (els) => els.map((e) => e.textContent));
    assert.equal(chips.length, 2);
    for (const g of ['A+', 'A']) {
      const row = EXPECT.byGrade[g];
      assert.ok(row && row.n > 0, 'missing grade ' + g);
      assert.ok(chips.some((t) => t.includes(g) && t.includes(String(row.hit)) && t.includes(String(row.n))), chips.join(' | '));
    }
    await page.close();
  });

  it('language switch keeps the same computed percent', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.select('#langSelect', 'de');
    await new Promise((r) => setTimeout(r, 120));
    const shown = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.equal(shown, EXPECT.hit + '/' + EXPECT.setups);
    const de = await page.$eval('[data-i18n="pr_d"]', (el) => el.textContent);
    assert.match(de, /Kerzen|Historie|Pfade|Simulation/i);
    await page.select('#langSelect', 'es');
    await new Promise((r) => setTimeout(r, 120));
    const es = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.equal(es, EXPECT.hit + '/' + EXPECT.setups);
    await page.close();
  });

  it('beta: landing proof → terminal shows Grade-A cards and no page errors', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const pct = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.match(pct, /^\d+\/\d+$/);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[href="app.html"]')
    ]);
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    const grades = await page.$$eval('.grade-chip', (els) => els.map((e) => e.textContent).join(' '));
    assert.match(grades, /GRADE\s+A\+?/);
    assert.equal(/GRADE\s+(B|C)\b/.test(grades), false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
