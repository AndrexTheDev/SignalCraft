import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
import { factorScores, rsi, sma, r5, roundTargetUp, validLongPlan, adxWilder, riskAdjMom, factorWindowComputable } from './helpers/core-logic.mjs';
import { atrWilder } from '../tools/backtest.mjs';

const app = read('app.html');
function grab(name) {
  const marker = 'function ' + name + '(';
  const start = app.indexOf(marker);
  assert.ok(start >= 0, name);
  return Function('return ' + app.slice(start, app.indexOf('{', start)) + extractBalanced(app, marker))();
}
const high90Text = grab('high90Text');
const begin = app.indexOf('      build(sym, sec, k, src, ticker) {');
const end = app.indexOf('      toSignal(b, rank, snapshotAt) {', begin);
assert.ok(begin >= 0 && end > begin);
const method = app.slice(begin, end).trim().replace(/,\s*$/, '');
const build = Function('validModelCandles', 'factorScores', 'adxWilder', 'riskAdjMom', 'roundTargetUp', 'validLongPlan', 'buyPressure', 'pressureLabel', 'return ({' + method + '}).build')(
  Function('parseMarketNumber', 'factorWindowComputable', 'return ' + grab('validModelCandles').toString())(grab('parseMarketNumber'), factorWindowComputable), factorScores, adxWilder, riskAdjMom, roundTargetUp, validLongPlan, grab('buyPressure'), grab('pressureLabel')
);
function candles(high) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: 200 }, (_, i) => {
    const t = start + i * 86400000;
    const c = 100, h = i === 198 ? high : 101;
    return [t, c, h, 99, c, 100, t + 86400000 - 1, 1000000, 100, 50, 550000];
  });
}

describe('step39 / 90-day high explanation', () => {
  it('reports rise from the close, not the different percentage decline from the high', () => {
    const built = build.call({ rsi, atrK: atrWilder, sma, r5 }, 'BTC', 'majors', candles(150), 'binance', { volume: 20000000, change: 0 });
    assert.equal(built.metrics.hi90d, 50);
    assert.ok(Math.abs((150 - 100) / 150 * 100 - 100 / 3) < 1e-10);
    assert.equal(high90Text(built.metrics.hi90d), '50%');
    assert.equal(high90Text(0), '0%');
  });

  it('keeps the existing model thresholds based on the close denominator', () => {
    const arr = candles(150);
    const h = arr.map(x => x[2]), l = arr.map(x => x[3]), c = arr.map(x => x[4]), q = arr.map(x => x[7]), t = arr.map(x => x[10]);
    const base = factorScores(h, l, c, q, t).comp.st;
    h[198] = 125; assert.equal(factorScores(h, l, c, q, t).comp.st, base + 1);
    h[198] = 112; assert.equal(factorScores(h, l, c, q, t).comp.st, base + 3);
    h[198] = 105; assert.equal(factorScores(h, l, c, q, t).comp.st, base + 4);
    h[198] = 105.01; assert.equal(factorScores(h, l, c, q, t).comp.st, base + 3);
  });

  it('does not present invalid or injected metrics as a high distance', () => {
    for (const v of [undefined, null, NaN, Infinity, -1, '50', '<img src=x>']) assert.equal(high90Text(v), '—');
  });
});
