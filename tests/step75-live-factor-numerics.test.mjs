import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
import { parseMarketNumber, factorWindowComputable } from './helpers/core-logic.mjs';
const app = read('app.html');
const mark = 'function validModelCandles(', at = app.indexOf(mark);
const valid = Function('parseMarketNumber', 'factorWindowComputable', 'return ' + app.slice(at, app.indexOf('{', at)) + extractBalanced(app, mark))(parseMarketNumber, factorWindowComputable);
const DAY = 86400000, start = Date.UTC(2024,0,1);
function rows(scale = 1, volume = 2e7) {
  let p = 100 * scale;
  return Array.from({ length: 200 }, (_, i) => {
    p *= 1 + 0.008 + 0.02 * Math.sin(i * 0.6 + 0.5) + 0.005 * Math.sin(i * 1.7);
    const t = start + i * DAY;
    return [t, p, p * 1.01, p * 0.99, p, 0, t + DAY - 1, volume, 0, 0, volume * ((i % 7) < 4 ? 0.52 : 0.60)];
  });
}
describe('step75 / LIVE factor numeric boundaries', () => {
  it('keeps normal and small but computable histories', () => {
    assert.equal(valid(rows()), true); assert.equal(valid(rows(1e-100)), true);
  });
  it('rejects finite raw inputs when volume accumulation overflows', () => {
    assert.equal(valid(rows(1, 1e307)), false);
  });
  it('rejects finite raw inputs when Bollinger variance overflows or underflows', () => {
    for (const n of [1e-200, 1e160]) assert.equal(valid(rows(n)), false, String(n));
  });
});
