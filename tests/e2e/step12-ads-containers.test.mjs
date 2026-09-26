import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, VIEWPORTS
} from '../helpers/browser.mjs';

let browser;

async function slotState(page) {
  return page.evaluate(() => {
    const ids = ['adSideL', 'adSideR', 'adStickyM', 'adNative'];
    const out = {};
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) { out[id] = null; return; }
      const cs = getComputedStyle(el);
      out[id] = {
        slot: el.getAttribute('data-ad-slot'),
        display: cs.display,
        on: el.classList.contains('is-on'),
        aria: el.getAttribute('aria-hidden')
      };
    });
    out.closer = !!document.getElementById('adStickyX');
    out.nativeBox = !!document.getElementById('container-8a466ff3d4c93e29bba42607317f6266');
    return out;
  });
}

describe('step12 ads containers e2e', { timeout: 240_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('terminal desktop 1440 keeps side ads in the DOM but hidden', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.desktop });
    const st = await slotState(page);
    assert.equal(st.adSideL.slot, 'side-left');
    assert.equal(st.adSideR.slot, 'side-right');
    assert.equal(st.adSideL.display, 'none');
    assert.equal(st.adSideR.display, 'none');
    assert.equal(st.adSideL.aria, 'true');
    assert.equal(st.adNative.slot, 'native-footer');
    assert.equal(st.nativeBox, true);
    assert.equal(st.adStickyM.on, false);
    await page.close();
  });

  it('wide 1920 shows both skyscrapers without overlapping the shell', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.wide });
    const geo = await page.evaluate(() => {
      const shell = document.querySelector('.editorial-shell').getBoundingClientRect();
      const L = document.getElementById('adSideL');
      const R = document.getElementById('adSideR');
      const l = L.getBoundingClientRect();
      const r = R.getBoundingClientRect();
      return {
        Ld: getComputedStyle(L).display,
        Rd: getComputedStyle(R).display,
        shellL: shell.left,
        shellR: shell.right,
        Lr: l.right,
        Rl: r.left
      };
    });
    assert.equal(geo.Ld, 'flex');
    assert.equal(geo.Rd, 'flex');
    assert.ok(geo.Lr <= geo.shellL + 2, 'left ad overlaps shell ' + JSON.stringify(geo));
    assert.ok(geo.Rl + 2 >= geo.shellR, 'right ad overlaps shell ' + JSON.stringify(geo));
    await page.close();
  });

  it('mobile sticky turns on and the closer removes it for the session', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.mobile });
    const before = await page.$eval('#adStickyM', (el) => el.classList.contains('is-on'));
    assert.equal(before, true);
    const hasPad = await page.$eval('body', (el) => el.classList.contains('has-sticky-ad'));
    assert.equal(hasPad, true);
    await page.click('#adStickyX');
    await new Promise((r) => setTimeout(r, 80));
    const gone = await page.$('#adStickyM');
    assert.equal(gone, null);
    const stored = await page.evaluate(() => sessionStorage.getItem('sc_sticky_dismiss'));
    assert.ok(stored);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 400));
    const after = await page.$eval('#adStickyM', (el) => el.classList.contains('is-on'));
    assert.equal(after, false);
    await page.close();
  });

  it('forceAdBlock swaps the board for the fair-use gate and restores it', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const cards = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(cards > 3);
    await page.evaluate(() => window.forceAdBlock(true));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await page.$('.adgate-card') !== null, true);
    assert.equal(await page.$('#signalsGrid article.signal-card'), null);
    const title = await page.$eval('.adgate-card h3', (el) => el.textContent);
    assert.ok(title.trim().length > 0);
    await page.evaluate(() => window.forceAdBlock(false));
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(await page.$('.adgate-card'), null);
    const after = await page.$$eval('#signalsGrid article.signal-card', (els) => els.length);
    assert.ok(after > 3);
    await page.close();
  });

  it('landing exposes the same four slots and keeps the radar visible under WebDriver', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en', viewport: VIEWPORTS.desktop });
    const st = await slotState(page);
    assert.equal(st.adSideL.slot, 'side-left');
    assert.equal(st.adNative.slot, 'native-footer');
    const gate = await page.$eval('#radGateNote', (el) => getComputedStyle(el).display);
    assert.equal(gate, 'none');
    const row = await page.$('#radRow1');
    assert.ok(row);
    await page.close();
  });

  it('popunder script is not injected for WebDriver', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.click('#pairSearchInput');
    await page.keyboard.press('KeyA');
    await new Promise((r) => setTimeout(r, 200));
    const injected = await page.evaluate(() => !!document.querySelector('script[src*="eacc536c"]'));
    assert.equal(injected, false);
    await page.close();
  });
});
