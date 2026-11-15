/**
 * step32 — empty-gate live fallback (v3.6 regression)
 *
 * Why this exists: with v3.6 the live recompute is honest — when NO pair
 * clears the gate in a quiet market, the terminal used to paint an empty
 * board. The documented behaviour (README) is: show the clearly-labelled
 * DEMO build snapshot instead, never relax the gate. This spec locks that
 * in with two synthetic market fixtures:
 *
 *   weak   — downtrend, ~$5M/day volume: every pair fails the gate →
 *            board shows the DEMO seed (10 cards), badge ● DEMO, toast
 *            explains why (distinguishes this path from the network-error
 *            fallback, which would toast meDemoToast instead).
 *   strong — uptrend, ramping volume & taker share: pairs clear the gate →
 *            badge ● LIVE, board paints live setups, 0 of 120 filtered.
 *
 * Fixtures are deterministic daily candles served for /klines? (200 rows,
 * Binance array shape). The complement (gate rejects) was calibrated with
 * the same engine the app uses — weak scores 16, strong scores 87.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE
} from '../helpers/browser.mjs';

const DAY = 86_400_000;
const DAYS = 200;
const T0 = 1_730_000_000_000;

function buildKlines(kind) {
  const out = [];
  let price = 100;
  for (let t = 0; t < DAYS; t++) {
    const prog = t / (DAYS - 1);
    let ret, qv, tqRatio;
    if (kind === 'weak') {
      ret = -0.004 + 0.004 * Math.sin(t * 0.9) + 0.0024 * Math.sin(t * 2.3 + 1.7);
      qv = 5e6; tqRatio = 0.42;
    } else {
      ret = 0.0045 + 0.016 * Math.sin(t * 0.9) + 0.0088 * Math.sin(t * 1.9 + 1.7) + 0.0048 * Math.sin(t * 3.1 + 0.4);
      qv = 20e6 + 100e6 * prog * prog;
      tqRatio = 0.44 + 0.22 * prog;
    }
    price = Math.max(1, price * (1 + ret));
    const c = price, h = c * 1.007, l = c * 0.993, o = c / (1 + ret);
    out.push([
      T0 + t * DAY,
      +o.toFixed(6), +h.toFixed(6), +l.toFixed(6), +c.toFixed(6),
      +(qv / c).toFixed(4),
      T0 + t * DAY + DAY - 1,
      +qv.toFixed(2),
      1000 + t,
      +((qv * tqRatio) / c).toFixed(4),
      +(qv * tqRatio).toFixed(2),
      0
    ]);
  }
  return out;
}

let browser;

describe('step32 empty-gate live fallback', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('quiet market: live recompute clears 0 pairs → DEMO build snapshot, clearly labelled + toast', async () => {
    const page = await freshPage(browser);
    await stubMarket(page, { klines: buildKlines('weak') });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 20000 });
    // boot pre-paints DEMO synchronously; the empty-gate toast fires once the
    // 120 synthetic klines drained and the gate came out empty — wait for it.
    await page.waitForFunction(
      () => /no setup clears the Grade-A gate/i.test((document.getElementById('toastMessage') || {}).textContent || ''),
      { timeout: 20000 }
    );
    const badge = await page.$eval('#meBadge', (el) => el.textContent);
    assert.match(badge, /DEMO/);
    assert.equal(/LIVE/.test(badge), false);
    const cards = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(cards, 10); // DEMO seed board, not an empty grid
    const toast = await page.$eval('#toastMessage', (el) => el.textContent);
    assert.match(toast, /no setup clears the Grade-A gate/i); // distinguishes empty-gate fallback from network-error fallback
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('strong market: live recompute clears pairs → LIVE badge, live board, gate note reports 0 filtered', async () => {
    const page = await freshPage(browser);
    await stubMarket(page, { klines: buildKlines('strong') });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('#signalsGrid .signal-card', { timeout: 20000 });
    // boot pre-paints DEMO first; the live upgrade replaces it once klines drain.
    await page.waitForFunction(
      () => /LIVE/.test((document.getElementById('meBadge') || {}).textContent || ''),
      { timeout: 20000 }
    );
    const badge = await page.$eval('#meBadge', (el) => el.textContent);
    assert.match(badge, /LIVE/);
    const cards = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.ok(cards >= 1, 'live board should carry gate-clearing setups');
    const gate = await page.$eval('#qualityGateNote', (el) => el.textContent);
    assert.match(gate, /0 OF 120/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
