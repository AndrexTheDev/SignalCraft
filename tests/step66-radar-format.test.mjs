import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function load() {
  const mark = 'function fmtRadarNumber(', at = html.indexOf(mark);
  assert.notEqual(at, -1, 'radar has its own bounded formatter');
  return Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, mark))();
}
describe('step66 / radar number formatting', () => {
  it('preserves meaningful decimals around one and ordinary USD liquidity', () => {
    const fmt = load();
    assert.notEqual(fmt(1.00001), fmt(1.00004));
    assert.equal(fmt(1.00001), '1.00001');
    assert.equal(fmt(40001 / 1e6), '0.040001');
    assert.equal(fmt(100000 / 1e6), '0.1');
  });
  it('uses bounded scientific notation for extreme finite positive values', () => {
    const fmt = load();
    for (const value of [Number.MIN_VALUE, 1e-100, 1e-7, 1e12, 1e100, Number.MAX_VALUE]) {
      const output = fmt(value);
      assert.match(output, /e[+-]\d+$/); assert.ok(output.length <= 16, output);
      assert.ok(Number(output) > 0 && Number.isFinite(Number(output)), output);
    }
  });
  it('does not coerce invalid inputs or turn tiny positive values into zero', () => {
    const fmt = load();
    for (const value of [null, undefined, true, '1', [], {}, NaN, Infinity, -1, 0]) assert.equal(fmt(value), '–');
    assert.notEqual(Number(fmt(Number.MIN_VALUE)), 0);
  });
});
