import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const marker = 'function calculateSpotPosition(';
const start = html.indexOf(marker);
const calculate = Function('return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker))();
describe('step54 / spot estimation numerical limits', () => {
  it('fails closed rather than reporting zero planned loss or gain after floating-point underflow', () => {
    assert.equal(calculate(1e-320, 1, 1, 0.9999999999999999, 2), null);
    assert.equal(calculate(1e-320, 1, 1, 0.5, 1.0000000000000002), null);
    assert.equal(calculate(1e-323, 1, 100, 90, 120), null);
  });
  it('still handles positive capital below one cent and common fractional quantities', () => {
    const p = calculate(0.001, 1, 100, 90, 120);
    assert.ok(p && p.units > 0 && p.plannedLoss > 0 && p.plannedGain > 0);
    assert.ok(Math.abs(p.positionValue - 0.0001) < 1e-15);
    assert.ok(Math.abs(p.plannedLoss - 0.00001) < 1e-15);
  });
  it('keeps computed risk and notional within budget and capital over varied magnitudes', () => {
    for (const power of [-20, -10, 0, 10, 20]) for (const pct of [1, 2]) for (const gap of [0.001, 0.1, 0.5]) {
      const entry = 100 * 10 ** power, equity = 1000 * 10 ** power;
      const p = calculate(equity, pct, entry, entry * (1 - gap), entry * 1.2);
      assert.ok(p);
      assert.ok(p.positionValue / equity <= 1 + 1e-12);
      assert.ok(p.plannedLoss / (equity * pct / 100) <= 1 + 1e-12);
      assert.ok(Math.abs(p.plannedGain / (p.units * entry * 0.2) - 1) < 1e-12);
    }
  });
});
