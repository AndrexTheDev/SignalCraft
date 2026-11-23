import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
import { validLongPlan, isLiveCache as mirror } from './helpers/core-logic.mjs';
const app = read('app.html');
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json')); // Offline test fixture, never served to users.
const marker = 'function isLiveCache(';
const start = app.indexOf(marker);
const validate = Function('validLongPlan', 'return ' + app.slice(start, app.indexOf('{', start)) + extractBalanced(app, marker))(validLongPlan);
const base = Array.from({ length: 100 }, (_, i) => ({
  ...structuredClone(seed[0]), id: 'SIG-TEST-' + i, pair: 'TEST' + i + ' / USDT', modelVersion: 3,
  quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 },
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
const payload = '<img src=x onerror=alert(1)>';
function rejected(mutate) {
  const signals = structuredClone(base); mutate(signals[0]);
  assert.equal(validate({ signals }), false);
  assert.equal(mirror({ signals }), false);
}
describe('step50 / cached display-field integrity', () => {
  it('requires actual finite numbers in every displayed core metric', () => {
    for (const key of ['rsi', 'atr', 'atrPct', 'sma50', 'sma200', 'volX', 'tb7', 'perf7', 'perf30', 'hi90d', 'chg24', 'volMio']) {
      rejected(s => { s.metrics[key] = payload; });
      rejected(s => { delete s.metrics[key]; });
    }
  });
  it('rejects markup and objects in optional metrics and factor components', () => {
    for (const key of ['adx', 'plusDi', 'minusDi', 'riskAdj30', 'bbWidthPct', 'tbDelta']) rejected(s => { s.metrics[key] = payload; });
    rejected(s => { s.metrics.comp.tr = payload; });
    rejected(s => { s.metrics.comp = []; });
    rejected(s => { s.metrics.top = { toString: 0, valueOf: 0 }; });
    rejected(s => { s.metrics.obvDir = payload; });
  });
  it('rejects invalid fields that otherwise break rendering or DOM references', () => {
    for (const mutate of [
      s => { s.id = payload; }, s => { s.id = 'with spaces'; }, s => { s.sector = {}; },
      s => { s.sector = '__proto__'; }, s => { s.indicatorsUsed = {}; }, s => { s.indicatorsUsed = [{}]; },
      s => { s.venue = {}; }, s => { s.timeframe = {}; }, s => { s.notes = {}; },
      s => { s.sentiment = []; }, s => { s.sentiment.score = payload; }, s => { s.sentiment.label = {}; }
    ]) rejected(mutate);
  });
  it('accepts genuinely unavailable secondary numeric metrics', () => {
    const signals = structuredClone(base);
    for (const key of ['adx', 'plusDi', 'minusDi', 'riskAdj30', 'bbWidthPct', 'tbDelta']) signals[0].metrics[key] = null;
    assert.equal(validate({ signals }), true);
    assert.equal(mirror({ signals }), true);
  });
});
