import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp
} from '../helpers/browser.mjs';
import { read, inlineScripts, extractArray } from '../helpers/html.mjs';
import { passesQualityGate } from '../helpers/core-logic.mjs';

const WALLETS = {
  SOL: '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8',
  BTC: 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f',
  ETH: '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7'
};

const appJs = inlineScripts(read('app.html')).join('\n');
const seed = JSON.parse(extractArray(appJs, 'const SEED_SIGNALS ='));
const gated = seed.filter((s) => passesQualityGate(s)).length;

let browser;

describe('step23 launch e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('landing footer paints v3.6 and the three published wallets', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'de' });
    const body = await page.$eval('footer', (el) => el.textContent);
    assert.match(body, /v3\.6/);
    assert.equal(body.includes('v3.2'), false);
    assert.equal(body.includes('v3.4'), false);
    for (const w of Object.values(WALLETS)) assert.ok(body.includes(w), w.slice(0, 8));
    assert.match(body, /RISIKOHINWEIS|RISK NOTICE/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('terminal version, gated count and donation copies match the published set', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const ver = await page.$eval('#ftVersion', (el) => el.textContent);
    assert.match(ver, /v3\.6/);
    const wallets = await page.$eval('#ftWallets', (el) => el.textContent);
    for (const w of Object.values(WALLETS)) assert.ok(wallets.includes(w), w.slice(0, 8));
    const n = await page.$eval('#statActiveCount', (el) => el.textContent.trim());
    assert.equal(n, String(gated));
    await page.click('#btnOpenDonation');
    await page.waitForSelector('#donationModalBackdrop.is-visible', { timeout: 5000 });
    const copies = await page.$$eval('[data-doncopy]', (els) => els.map((e) => e.getAttribute('data-doncopy')));
    assert.deepEqual(new Set(copies).size, 3);
    assert.ok(copies.includes(WALLETS.SOL));
    assert.ok(copies.includes(WALLETS.BTC));
    assert.ok(copies.includes(WALLETS.ETH));
    assert.equal(copies.some((c) => c.includes('@')), false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('EN FAQ names the Grade-A gate after language switch', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const a1 = await page.$eval('[data-i18n="a1"]', (el) => el.textContent);
    assert.match(a1, /Grade[ -]A/);
    assert.match(a1, /pairs|board/i);
    await page.close();
  });

  it('beta: landing wallets → terminal donation modal, Grade-A cards, no page errors', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    const land = await page.$eval('footer', (el) => el.textContent);
    assert.ok(land.includes(WALLETS.SOL));
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a[href="app.html"]')
    ]);
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    const n = await page.$eval('#statActiveCount', (el) => el.textContent.trim());
    assert.equal(n, String(gated));
    await page.click('#btnOpenDonation');
    await page.waitForSelector('#donationModalBackdrop.is-visible', { timeout: 5000 });
    const sol = await page.$eval('#btnDonSol', (el) => el.getAttribute('data-doncopy'));
    assert.equal(sol, WALLETS.SOL);
    const grades = await page.$$eval('.grade-chip', (els) => els.map((e) => e.textContent).join(' '));
    assert.match(grades, /GRADE\s+A\+?/);
    assert.equal(/GRADE\s+(B|C)\b/.test(grades), false);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
