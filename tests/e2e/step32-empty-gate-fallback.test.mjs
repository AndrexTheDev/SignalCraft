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
const T0 = Math.floor(Date.now() / DAY) * DAY - (DAYS - 1) * DAY;

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
    const c = price, o = c / (1 + ret), h = Math.max(c, o) * 1.007, l = Math.min(c, o) * 0.993;
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
    assert.equal(cards, 10, 'board displays only the top 10 gate-clearing setups');
    assert.equal(await page.$eval('#statActiveCount', el => el.textContent), '10');
    assert.match(await page.$eval('[data-sector=all]', el => el.textContent), /\(10\)/);
    const gate = await page.$eval('#qualityGateNote', (el) => el.textContent);
    assert.match(gate, /0 OF 120/);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
  it('uses the oldest accepted ticker time for the cache and displayed signal snapshot', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
      await stubMarket(page, { klines: buildKlines('strong'), globalTicker: { timeOffset: -50000 }, usTicker: { timeOffset: -50000 } });
      const started = Date.now();
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''), { timeout: 20000 });
      const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('signalcraft_live_v2')));
      assert.equal(cache.version, 9);
      assert.ok(cache.t <= started - 48000, 'ticker age is not replaced by computation completion time');
      assert.ok(cache.signals.every(s => s.timestamp === cache.t));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('uses the rolling 24h ticker, not the current daily candle, for the gate and displayed metrics', async () => {
    const page = await freshPage(browser);
    await stubMarket(page, { klines: buildKlines('strong'), quoteVolume: 9_999_999, priceChangePercent: 42.7 });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /no setup clears the Grade-A gate/i.test(document.getElementById('toastMessage')?.textContent || ''), { timeout: 20000 });
    assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
    await page.close();

    const page2 = await freshPage(browser);
    await page2.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
    await stubMarket(page2, { klines: buildKlines('strong'), quoteVolume: 10_000_000, priceChangePercent: 42.7 });
    await page2.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
    await page2.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''), { timeout: 20000 });
    const cache = await page2.evaluate(() => JSON.parse(localStorage.getItem('signalcraft_live_v2')));
    assert.ok(cache.signals.length >= 100);
    assert.equal(cache.version, 9);
    assert.ok(cache.signals.every(sig => sig.pair.endsWith(' / USDT')), 'live calculations retain the actual quote unit');
    const close = buildKlines('strong').map(row => row[4]);
    const expectedSma200 = +(close.reduce((sum, value) => sum + value, 0) / 200).toPrecision(5);
    assert.equal(cache.signals[0].metrics.sma200, expectedSma200);
    for (const sig of cache.signals) {
      const [tp1, tp2] = sig.targets;
      assert.ok(sig.stopLoss > 0 && sig.stopLoss < sig.entryPrice && sig.entryPrice < tp1 && tp1 <= tp2);
      assert.ok((tp2 - sig.entryPrice) / (sig.entryPrice - sig.stopLoss) >= 2 - 1e-10);
    }
    assert.equal(cache.signals[0].gateMetrics.volMio, 10);
    assert.equal(cache.signals[0].metrics.chg24, 42.7);
    assert.ok(cache.signals[0].timestamp <= Date.now() + 60000, 'timestamp is not the future candle close');
    await page2.click('[data-toggle-sentiment]');
    const firstId = await page2.$eval('#signalsGrid article.signal-card', el => el.getAttribute('data-id'));
    const first = cache.signals.find(s => s.id === firstId);
    assert.ok(first);
    assert.equal(await page2.$eval('.sentiment-drawer-panel.is-open .taker-split', el => el.textContent), first.metrics.tb7.toFixed(1) + '% / ' + (100 - first.metrics.tb7).toFixed(1) + '%');
    assert.match(await page2.$eval('.sentiment-drawer-panel.is-open', el => el.textContent), /LIVE MARKET DATA/);
    assert.equal('bullPct' in first.sentiment, false);
    assert.deepEqual(page2._pageErrors, []);
    await page2.close();
  });

  it('never combines a ticker and candles from different venues', async () => {
    const page = await freshPage(browser);
    await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
    await stubMarket(page, { klines: buildKlines('strong'), globalTicker: { missing: true }, usTicker: { quoteVolume: 10_000_000, priceChangePercent: -12.3 } });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''), { timeout: 20000 });
    const cache = await page.evaluate(() => JSON.parse(localStorage.getItem('signalcraft_live_v2')));
    assert.ok(cache.signals.every(s => /BINANCE-US/i.test(s.venue)));
    assert.equal(cache.signals[0].metrics.chg24, -12.3);
    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });

  it('fails closed when both venue tickers are stale or absent', async () => {
    const page = await freshPage(browser);
    await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
    await stubMarket(page, { klines: buildKlines('strong'), globalTicker: { timeOffset: -300001 }, usTicker: { missing: true } });
    await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
    await page.click('#btnRefreshSentimentGlobal');
    await page.waitForFunction(() => /live data unavailable or incomplete/i.test(document.getElementById('toastMessage')?.textContent || ''), { timeout: 20000 });
    assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
    assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
    await page.close();
  });

  it('falls back to DEMO for insufficient or discontinuous daily history', async () => {
    const short = buildKlines('strong').slice(1);
    const broken = buildKlines('strong');
    broken[80][0] += DAY;
    broken[80][6] += DAY;
    for (const klines of [short, broken]) {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
        await stubMarket(page, { klines });
        await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
        await page.click('#btnRefreshSentimentGlobal');
        await page.waitForFunction(() => /live data unavailable or incomplete/i.test(document.getElementById('toastMessage')?.textContent || ''), { timeout: 20000 });
        assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
        assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });

  it('does not restore an old live cache created before the stricter history checks', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => {
        const signals = Array.from({ length: 100 }, (_, i) => ({ id: 'old-' + i, pair: 'BTC / USD', modelVersion: 3, gateMetrics: { rsi: 60, volMio: 20, adx: 20, riskAdj30: 1 } }));
        localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 4, t: Date.now(), signals }));
      });
      await stubMarket(page);
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#btnRefreshSentimentGlobal:not([disabled])');
      assert.match(await page.$eval('#meBadge', el => el.textContent), /DEMO/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

});
