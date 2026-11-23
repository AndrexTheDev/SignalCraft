import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
import { isLiveCache as mirror, takeProfitLevels as mirrorLevels, validLongPlan } from './helpers/core-logic.mjs';
const app = read('app.html');
const seed = JSON.parse(extractArray(app, 'const SEED_SIGNALS ='));
function load(name, deps = []) {
  const marker = 'function ' + name + '(';
  const start = app.indexOf(marker);
  return Function(...deps, 'return ' + app.slice(start, app.indexOf('{', start)) + extractBalanced(app, marker));
}
const validate = load('isLiveCache', ['validLongPlan'])(validLongPlan);
const levels = load('takeProfitLevels')();
function records(n = 100) {
  return Array.from({ length: n }, (_, i) => ({ ...structuredClone(seed[0]), id: 'ID-' + i, pair: 'A' + i + ' / USDT', modelVersion: 3, quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
}
function rejected(mutate) {
  const signals = records(); mutate(signals[0], signals);
  assert.equal(validate({ signals }), false);
  assert.equal(mirror({ signals }), false);
}
describe('step49 / live cache and trade-plan integrity', () => {
  it('accepts at least 100 distinct coherent USDT long plans', () => {
    assert.equal(validate({ signals: records(100) }), true);
    assert.equal(mirror({ signals: records(120) }), true);
    assert.equal(validate({ signals: records(99) }), false);
  });
  it('validates a single candidate only when explicitly requested without relaxing whole-cache coverage', () => {
    const signals = records(1);
    for (const fn of [validate, mirror]) {
      assert.equal(fn({ signals }), false);
      assert.equal(fn({ signals }, true), true);
      assert.equal(fn({ signals }, 0), false);
      const invalid = structuredClone(signals); invalid[0].metrics.volX = Infinity;
      assert.equal(fn({ signals: invalid }, true), false);
      assert.equal(fn({ signals: [signals[0], signals[0]] }, true), false);
    }
  });
  it('allows explicitly unknown optional indicators without fabricating them', () => {
    const signals = records(); signals[0].gateMetrics.adx = null; signals[1].gateMetrics.riskAdj30 = null;
    assert.equal(validate({ signals }), true);
    assert.equal(mirror({ signals }), true);
  });
  it('rejects missing or duplicate identities and unverified quote units', () => {
    for (const mutate of [
      s => { s.id = ''; }, s => { s.pair = 'A0 / USD'; }, s => { s.pair = 'A0 / ?'; },
      (s, all) => { s.id = all[1].id; }, (s, all) => { s.pair = all[1].pair; },
      s => { s.pair = '<bad> / USDT'; }, s => { s.live = false; }, s => { s.modelVersion = 2; }, s => { s.type = 'SHORT'; }
    ]) rejected(mutate);
  });
  it('rejects invalid, missing or inconsistent trade plans rather than guessing levels', () => {
    for (const mutate of [
      s => { delete s.targets; }, s => { s.targets = [s.targets[0]]; }, s => { s.targets[1] = null; },
      s => { s.stopLoss = 0; }, s => { s.stopLoss = s.entryPrice; }, s => { s.targets[0] = s.entryPrice; },
      s => { s.targets[1] = s.entryPrice * 1.01; }, s => { s.entryPrice = '5'; },
      s => { s.riskRewardRatio = '1:99.9'; }, s => { delete s.riskRewardRatio; }
    ]) rejected(mutate);
    for (const fn of [levels, mirrorLevels]) {
      assert.ok(Number.isNaN(fn({ entryPrice: 100 }).tp1));
      assert.ok(Number.isNaN(fn({ targets: [110, null] }).tp2));
      assert.equal(fn({ targets: [110, 120] }).tp1, 110);
    }
  });
  it('rejects non-finite or out-of-range raw gate metrics and malformed candle series', () => {
    for (const mutate of [
      s => { s.quantScore = NaN; }, s => { s.quantScore = 101; }, s => { s.confluenceScore = 99; }, s => { s.metrics.score = 99; }, s => { delete s.metrics; },
      s => { s.gateMetrics.rsi = 101; }, s => { s.gateMetrics.adx = -1; },
      s => { s.gateMetrics.volMio = -1; }, s => { delete s.gateMetrics.riskAdj30; }, s => { s.gateMetrics.adx = NaN; },
      s => { s.k24.pop(); }, s => { s.k24[0][1] = 0; }, s => { s.k24[0][0] = Infinity; }
    ]) rejected(mutate);
  });
});
