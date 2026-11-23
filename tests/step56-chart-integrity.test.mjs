import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function load(name, ...args) {
  const marker = 'function ' + name + '('; const i = html.indexOf(marker);
  return Function(...args, 'return ' + html.slice(i, html.indexOf('{', i)) + extractBalanced(html, marker));
}
const valid = load('validChartCandles')();
const candles = Array.from({ length: 24 }, () => [2, 3, 1, 2.5]);
function setup(context) {
  const canvas = { width: 600, height: 250, getContext: () => context };
  const draw = load('drawCandleChart', 'document', 'validChartCandles', 'takeProfitLevels', 'quotedPrice')(
    { getElementById: () => canvas }, valid, sig => ({ tp1: sig.targets[0] }), (sig, price) => `${price} USDT`
  );
  return { draw, canvas };
}
describe('step56 / candle chart data and rendering', () => {
  it('requires exactly 24 consistent finite OHLC rows', () => {
    assert.equal(valid(candles), true);
    for (const data of [[], null, candles.slice(1), Array(24), [...candles, candles[0]], candles.map((row, i) => i ? row : Array(4)), candles.map((row, i) => i ? row : [2, 1, 1, 2]), candles.map((row, i) => i ? row : [2, 3, 0, 2]), candles.map((row, i) => i ? row : [2, 3, 1, NaN])]) assert.equal(valid(data), false);
  });
  it('draws all candles and three actual levels using finite coordinates', () => {
    const calls = [];
    const ctx = { clearRect() {}, fillRect(...x) { calls.push(['rect', ...x]); }, beginPath() {}, moveTo(...x) { calls.push(['point', ...x]); }, lineTo(...x) { calls.push(['point', ...x]); }, stroke() {}, setLineDash() {}, fillText(...x) { calls.push(['text', ...x]); } };
    const { draw } = setup(ctx);
    assert.equal(draw('canvas', { k24: candles, entryPrice: 2, stopLoss: 1, targets: [4, 5] }), true);
    assert.equal(calls.filter(x => x[0] === 'rect').length, 25); // background plus 24 bodies
    assert.ok(calls.filter(x => x[0] === 'point').every(x => x.slice(1).every(Number.isFinite)));
    assert.equal(calls.filter(x => x[0] === 'text').length, 0); // labels remain readable outside the canvas
  });
  it('rejects unavailable contexts and invalid or nonfinite geometry', () => {
    assert.equal(setup(null).draw('canvas', { k24: candles }), false);
    const ctx = { clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
    const { draw, canvas } = setup(ctx);
    assert.equal(draw('canvas', { k24: [], entryPrice: 2, stopLoss: 1, targets: [4, 5] }), false);
    assert.equal(draw('canvas', { k24: candles, entryPrice: 2, stopLoss: 1, targets: [Number.MAX_VALUE, Number.MAX_VALUE] }), false);
    canvas.width = 100;
    assert.equal(draw('canvas', { k24: candles, entryPrice: 2, stopLoss: 1, targets: [4, 5] }), false);
  });
});
