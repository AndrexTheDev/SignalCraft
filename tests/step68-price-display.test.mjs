import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
import { fmtP as mirror } from './helpers/core-logic.mjs';
const html = read('app.html');
const mark = 'function fmtP(', at = html.indexOf(mark);
const fmtP = Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, mark))();
describe('step68 / trading-level display precision', () => {
  for (const [name, fmt] of [['app', fmtP], ['mirror', mirror]]) {
    it(`${name}: keeps distinct representable entry, stop and targets distinct`, () => {
      const levels = [1.00000000000001, 1.00000000000002, 1.00000000000003, 1.00000000000004];
      const shown = levels.map(fmt);
      assert.equal(new Set(shown).size, levels.length);
      assert.deepEqual(shown.map(Number), levels);
    });
    it(`${name}: retains locale separators for close-set levels`, () => {
      const original = Number.prototype.toLocaleString;
      try {
        Number.prototype.toLocaleString = function (_locale, options) { return original.call(this, 'de-DE', options); };
        assert.equal(fmt(1.00000000000001), '1,00000000000001');
        assert.equal(fmt(1.00000000000002), '1,00000000000002');
      } finally { Number.prototype.toLocaleString = original; }
    });
    it(`${name}: keeps extreme positive values compact and round-trippable`, () => {
      for (const n of [Number.MIN_VALUE, 1e-100, 1.234567890123456e-100, 1e100, Number.MAX_VALUE]) {
        const shown = fmt(n);
        assert.ok(shown.length < 30, shown);
        assert.equal(Number(shown), n, shown);
      }
    });
    it(`${name}: retains ordinary locale formatting and existing invalid placeholders`, () => {
      for (const n of [0, 1.2345, 1000000, -12.34]) assert.equal(fmt(n), n.toLocaleString(undefined, { maximumSignificantDigits: 12 }));
      for (const n of [null, undefined, '', ' ', NaN, Infinity, -Infinity]) assert.equal(fmt(n), '-');
    });
  }
});
