import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';

const app = read('app.html').replace('    ME.refresh(false);', '    window.__vol98 = { ME, factorScores, passesQualityGate, isLiveCache }; ME.refresh(false);');
let browser;
describe('step98 / live model rolling-volume integration', { timeout: 30000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('uses the chosen venue ticker for the volume score, displayed ratio and pressure, rejecting invalid arithmetic', async () => {
    const page = await freshPage(browser);
    try {
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (req.url().startsWith(BASE + '/app.html')) return req.respond({ status: 200, contentType: 'text/html', body: app }).catch(() => {});
        if (!req.url().startsWith(BASE + '/')) return req.abort().catch(() => {});
        return req.continue().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__vol98 && !window.__vol98.ME.busy);
      const candles = liveTestCandles();
      candles.at(-1)[7] = 1e6; candles.at(-1)[10] = 5e5;
      const result = await page.evaluate(rows => {
        const { ME, factorScores, passesQualityGate, isLiveCache } = window.__vol98;
        const qv = rows.map(r => +r[7]), avg = qv.slice(-31, -1).reduce((a, b) => a + b, 0) / 30;
        const ticker = { volume: avg * 1.25, change: 0, time: Date.now() };
        const build = ME.build('BTC', 'majors', rows, 'binance-us', ticker);
        const h = rows.map(r => +r[2]), l = rows.map(r => +r[3]), c = rows.map(r => +r[4]), tq = rows.map(r => +r[10]);
        const old = factorScores(h, l, c, qv, tq), updated = factorScores(h, l, c, qv, tq, ticker.volume / avg);
        const signal = ME.toSignal(build, 1, Date.now());
        const oldVersion = { ...signal, modelVersion: 3 };
        let underflowRejected = false, negativeRejected = false;
        try { ME.build('BTC', 'majors', rows, 'binance', { ...ticker, volume: Number.MIN_VALUE }); } catch { underflowRejected = true; }
        try { ME.build('BTC', 'majors', rows, 'binance', { ...ticker, volume: -1 }); } catch { negativeRejected = true; }
        return { build, old, updated, signal, oldVersionValid: isLiveCache({ signals: [oldVersion] }, true), oldVersionGate: passesQualityGate(oldVersion), underflowRejected, negativeRejected };
      }, candles);
      assert.equal(result.build.src, 'binance-us');
      assert.equal(result.build.metrics.volX, 1.3); // rounded for presentation only
      const qv7 = candles.slice(-7).reduce((sum, row) => sum + row[7], 0);
      const taker7 = candles.slice(-7).reduce((sum, row) => sum + row[10], 0);
      const expectedPressure = Math.max(42, Math.min(78, Math.round(50 + (taker7 / qv7 * 100 - 50) * 1.15 + (1.25 - 1) * 1.5)));
      assert.equal(result.build.ss, expectedPressure);
      assert.equal(result.build.metrics.comp.vo, result.updated.comp.vo);
      assert.equal(result.updated.comp.vo - result.old.comp.vo, 4);
      assert.equal(result.signal.venue, 'BINANCE-US SPOT');
      assert.equal(result.signal.modelVersion, 4);
      assert.equal(result.oldVersionValid, false); assert.equal(result.oldVersionGate, false);
      assert.equal(result.underflowRejected, true); assert.equal(result.negativeRejected, true);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
