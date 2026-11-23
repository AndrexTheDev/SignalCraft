import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp
} from '../helpers/browser.mjs';
import { read, inlineScripts, extractArray } from '../helpers/html.mjs';
import { filterSignals } from '../helpers/core-logic.mjs';

const appJs = inlineScripts(read('app.html')).join('\n');
const seed = JSON.parse(extractArray(appJs, 'const SEED_SIGNALS ='));
const gated = filterSignals(seed, {});
const btc = seed.find((s) => s.id === 'SIG-BTC-014');

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

  it('exclusive board shows exactly the 10 gated setups, not the raw 120 seed', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const n = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(n, 10);
    // pagination UI was removed with the exclusive board
    const pagin = await page.$('#paginationInfoLabel');
    assert.equal(pagin, null);
    const pills = await page.$$eval('.sector-pill', (els) => els.map((e) => e.textContent.trim()));
    assert.ok(pills.some((t) => /Alle \(10\)/.test(t)), JSON.stringify(pills));
    assert.ok(pills.some((t) => /Majors \(6\)/.test(t)), JSON.stringify(pills));
    assert.equal(pills.some((t) => /\(24\)/.test(t) || /\(120\)/.test(t) || /\(58\)/.test(t)), false, JSON.stringify(pills));
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('UTC stamp, copy-levels, risk-low=2, sort LOW first', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const stamp = await page.$eval('.signal-card[data-id]', (el) => el.textContent);
    assert.match(stamp, /23:59:59 UTC/);

    await page.evaluate(() => {
      window.__copied = '';
      navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    });
    await page.click('[data-copy-levels]');
    const copied = await page.evaluate(() => window.__copied);
    const firstId = await page.$eval('.signal-card[data-id]', (el) => el.getAttribute('data-id'));
    const first = gated.find((s) => s.id === firstId) || seed.find((s) => s.id === firstId);
    assert.ok(first, firstId);
    assert.ok(copied.startsWith(first.pair.split(' / ')[0] + ' / ? Setup | Entry: '));
    assert.match(copied, / \| SL: [^|]+ \?/);
    assert.match(copied, / \| TP: [^|]+ \?/);
    assert.match(copied, / \| R:R: /);
    assert.match(copied, /\(Signalcraft\) \| DEMO · \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
    assert.match(copied, /nicht verifiziert/);
    assert.ok(copied.includes(first.riskRewardRatio));

    await page.click('[data-filter="risk-low"]');
    await new Promise((r) => setTimeout(r, 200));
    const lowIds = await page.$$eval('.signal-card[data-id]', (els) => els.map((e) => e.getAttribute('data-id')));
    assert.deepEqual(lowIds.slice().sort(), ['SIG-BTC-014', 'SIG-TRX-021']);

    await page.click('[data-filter="all"]');
    await page.select('#sortSelect', 'risk');
    await new Promise((r) => setTimeout(r, 200));
    const firstAfter = await page.$eval('.signal-card[data-id]', (el) => el.getAttribute('data-id'));
    assert.equal(firstAfter, 'SIG-BTC-014');
    const lowBadge = await page.$eval('.signal-card[data-id] .risk-badge', (el) => el.className);
    assert.match(lowBadge, /risk-low/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('EN labels, exclusive count, XSS search stays empty, dossier chart paints', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const allPill = await page.$eval('.sector-pill[data-sector="all"]', (el) => el.textContent);
    assert.match(allPill, /All \(10\)/);

    const allN = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(allN, gated.length);
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
    assert.match(dos, /23:59:59 UTC/);
    assert.ok(btc);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
