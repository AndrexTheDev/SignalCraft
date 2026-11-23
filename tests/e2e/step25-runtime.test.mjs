import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp
} from '../helpers/browser.mjs';
import { read, inlineScripts, extractArray } from '../helpers/html.mjs';
import { filterSignals } from '../helpers/core-logic.mjs';

let browser;

describe('step25 runtime e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('exclusive board shows exactly the 10 gated setups, not the raw 120 evaluated pairs', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const n = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(n, 10);
    // pagination UI was removed with the exclusive board
    const pagin = await page.$('#paginationInfoLabel');
    assert.equal(pagin, null);
    const pills = await page.$$eval('.sector-pill', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(pills.some((t) => /Alle \(10\)/.test(t)), JSON.stringify(pills));
    assert.ok(pills.some((t) => /Majors \(\d+\)/.test(t)), JSON.stringify(pills));
    assert.equal(pills.some((t) => /\(24\)/.test(t) || /\(120\)/.test(t) || /\(58\)/.test(t)), false, JSON.stringify(pills));
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('UTC stamp, live copy levels, risk filtering and sorting', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const stamp = await page.$eval('.signal-card[data-id]', (el) => el.textContent);
    assert.match(stamp, /\d{2}:\d{2}:\d{2} UTC/g);

    await page.evaluate(() => {
      window.__copied = '';
      navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    });
    await page.click('[data-copy-levels]');
    const copied = await page.evaluate(() => window.__copied);
    assert.match(copied, /\/ USDT Setup \| Entry: /);
    assert.match(copied, / \| SL: [^|]+ USDT/);
    assert.match(copied, / \| TP: [^|]+ USDT/);
    assert.match(copied, / \| R:R: /);
    assert.match(copied, /\(Signalcraft\) \| LIVE · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
    const expectedLow = await page.$$eval('.signal-card .risk-low', els => els.length);
    await page.click('[data-filter="risk-low"]');
    assert.equal(await page.$$eval('.signal-card', els => els.length), expectedLow);
    await page.click('[data-filter="all"]');
    await page.select('#sortSelect', 'risk');
    assert.equal(await page.$$eval('.signal-card', els => els.length), 10);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('EN labels, exclusive count, XSS search stays empty, dossier chart paints', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const allPill = await page.$eval('.sector-pill[data-sector="all"]', (el) => el.textContent);
    assert.match(allPill, /All \(10\)/);

    const allN = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(allN, 10);

    await page.type('#pairSearchInput', '<img src=x onerror=alert(1)>');
    await new Promise((r) => setTimeout(r, 250));
    const cards = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(cards, 0);
    const imgs = await page.$$eval('#signalsGrid img', (els) => els.length);
    assert.equal(imgs, 0);
    const empty = await page.$eval('#signalsGrid', (el) => el.textContent);
    assert.ok(empty.trim().length > 0);

    await page.click('#clearSearchBtn');
    await new Promise((r) => setTimeout(r, 200));
    await page.click('[data-toggle-chart]');
    await page.waitForSelector('.chart-drawer-panel.is-open');
    await new Promise((r) => setTimeout(r, 400));
    const painted = await page.evaluate(() => {
      const c = document.querySelector('.chart-drawer-panel.is-open canvas');
      if (!c) return { ok: false, why: 'no-canvas' };
      const ctx = c.getContext('2d');
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let px = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i] + data[i + 1] + data[i + 2] + data[i + 3] > 0) px++;
      }
      return { ok: px > 10, px, w: c.width, h: c.height };
    });
    assert.equal(painted.ok, true, JSON.stringify(painted));
    await page.click('[data-inspect-sig]');
    await page.waitForSelector('#dossierModalBackdrop.is-visible', { timeout: 5000 });
    const dos = await page.$eval('#dossierBody', (el) => el.textContent);
    assert.match(dos, /\d{2}:\d{2}:\d{2} UTC/g);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
