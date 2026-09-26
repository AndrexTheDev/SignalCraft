import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp
} from '../helpers/browser.mjs';
import { read, inlineScripts, extractArray } from '../helpers/html.mjs';
import { rollingTrackRecord } from '../helpers/core-logic.mjs';

const landJs = inlineScripts(read('index.html')).join('\n');
const TRACK_SET = Function('return (' + extractArray(landJs, 'var TRACK_SET =') + ')')();
const EXPECT = rollingTrackRecord(TRACK_SET);

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
    assert.equal(shown, EXPECT.pct + '%');
    assert.match(shown, /^\d{1,3}%$/);
    if (EXPECT.pct !== 71) assert.notEqual(shown, '71%');
    const body = await page.$eval('[data-i18n="pr_d"]', (el) => el.textContent);
    assert.match(body, new RegExp(String(EXPECT.pct)));
    assert.equal(body.includes('{pct}'), false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('grade chips show computed A+ / A / B+ rates', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const chips = await page.$$eval('.proof-grades span', (els) => els.map((e) => e.textContent));
    assert.equal(chips.length, 3);
    for (const g of ['A+', 'A', 'B+']) {
      const row = EXPECT.byGrade[g];
      assert.ok(row && row.pct != null, 'missing grade ' + g);
      assert.ok(chips.some((t) => t.includes(g) && t.includes(String(row.pct))), chips.join(' | '));
    }
    await page.close();
  });

  it('language switch keeps the same computed percent', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.select('#langSelect', 'de');
    await new Promise((r) => setTimeout(r, 120));
    const shown = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.equal(shown, EXPECT.pct + '%');
    const de = await page.$eval('[data-i18n="pr_d"]', (el) => el.textContent);
    assert.match(de, /errechnet|Kerzen|Historie|Quote/i);
    assert.match(de, new RegExp(String(EXPECT.pct)));
    await page.select('#langSelect', 'es');
    await new Promise((r) => setTimeout(r, 120));
    const es = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.equal(es, EXPECT.pct + '%');
    await page.close();
  });

  it('beta: landing proof → terminal still has B+ cards and no page errors', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const pct = await page.$eval('#proofHitPct', (el) => el.textContent.trim());
    assert.match(pct, /^\d{1,3}%$/);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[href="app.html"]')
    ]);
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    const grades = await page.$$eval('.grade-chip', (els) => els.map((e) => e.textContent).join(' '));
    assert.match(grades, /GRADE\s+(A\+|A|B\+)/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
