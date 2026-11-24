import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';

// Historical test-only transcription of 32 daily close values from Binance Vision,
// fetched 2026-11-24; the last value was an unfinished UTC daily candle.
// The live application never imports these observations. These are NOT signals.
// https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=32
// https://data-api.binance.vision/api/v3/klines?symbol=ETHUSDT&interval=1d&limit=32
// https://data-api.binance.vision/api/v3/klines?symbol=SOLUSDT&interval=1d&limit=32
const samples = {
  BTC: [80888.16,80154.09,80150.56,80909.77,81343.50,77991.89,77368.77,77582.02,78354.00,76816.00,77453.86,80504.01,76088.01,75844.00,75867.59,74851.44,75368.41,73796.06,74015.19,71460.00,68314.00,64150.00,65351.05,64882.87,64947.35,63068.22,61986.73,58951.51,60215.77,61271.08,61270.93,60020.01],
  ETH: [2358.82,2329.87,2324.55,2350.36,2359.68,2253.13,2245.54,2255.66,2275.31,2253.29,2274.77,2424.61,2238.01,2238.67,2240.24,2127.46,2135.24,2053.21,2056.36,2019.74,1929.88,1769.20,1835.35,1820.67,1824.88,1777.19,1757.32,1623.09,1685.63,1724.33,1710.65,1687.49],
  SOL: [102.38,101.40,100.95,101.35,102.44,95.64,96.38,95.54,94.53,91.98,92.83,95.61,89.33,90.13,89.81,86.54,86.74,83.35,83.28,81.72,78.19,70.28,72.77,71.58,75.19,73.64,73.15,68.88,70.31,70.73,72.03,70.80]
};
const app = read('app.html');
function load(name, ...deps) {
  const marker = 'function ' + name + '(';
  const start = app.indexOf(marker);
  assert.ok(start >= 0, name);
  return Function(...deps.map(d => d[0]), 'return ' + app.slice(start, app.indexOf('{', start)) + extractBalanced(app, marker))(...deps.map(d => d[1]));
}
const returnVol = load('returnVol');
const riskAdjMom = load('riskAdjMom', ['returnVol', returnVol]);
const qualityScore = load('qualityScore');
const passesQualityGate = load('passesQualityGate', ['qualityScore', qualityScore], ['BOARD_MIN', 86]);

// Independent reference: compute the population standard deviation of the 30
// daily returns rather than calling the model's returnVol helper.
function independent(closes) {
  const daily = closes.slice(-30).map((close, i) => close / closes[closes.length - 31 + i] - 1);
  const mean = daily.reduce((sum, v) => sum + v, 0) / daily.length;
  const stdev = Math.sqrt(daily.reduce((sum, v) => sum + (v - mean) ** 2, 0) / daily.length);
  const ret = closes.at(-1) / closes.at(-31) - 1;
  return { ret, adjusted: ret / (stdev * Math.sqrt(30)) };
}

describe('step97 / sampled real closing prices and long momentum gate', () => {
  for (const [symbol, closes] of Object.entries(samples)) it(`${symbol}: model and independent 30-day momentum agree and negative momentum fails the gate`, () => {
    assert.equal(closes.length, 32);
    const reference = independent(closes), actual = riskAdjMom(closes, 30);
    assert.ok(reference.ret < 0);
    assert.ok(Number.isFinite(actual) && actual < 0);
    assert.ok(Math.abs(actual - reference.adjusted) < 1e-12);
    const candidate = { live: true, modelVersion: 4, quantScore: 99, gateMetrics: { rsi: 50, volMio: 100, adx: 30, riskAdj30: actual } };
    assert.equal(passesQualityGate(candidate), false);
    candidate.gateMetrics.riskAdj30 = 0.1;
    assert.equal(passesQualityGate(candidate), true);
  });
});
