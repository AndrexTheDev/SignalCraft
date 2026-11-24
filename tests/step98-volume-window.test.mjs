import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { factorScores } from './helpers/core-logic.mjs';
import { liveTestCandles } from './helpers/browser.mjs';

// Deterministic exchange-shaped candles, used only in tests.
function input() {
  const rows = liveTestCandles();
  // A small unfinished daily volume, with unchanged historical daily volumes.
  rows.at(-1)[7] = 1e6;
  rows.at(-1)[10] = 5e5;
  return { h: rows.map(r => +r[2]), l: rows.map(r => +r[3]), c: rows.map(r => +r[4]), qv: rows.map(r => +r[7]), tq: rows.map(r => +r[10]) };
}

describe('step98 / rolling-volume factor', () => {
  it('uses the supplied 24h ratio for the volume factor without altering other score components', () => {
    const { h, l, c, qv, tq } = input();
    const partial = factorScores(h, l, c, qv, tq);
    const rolling = factorScores(h, l, c, qv, tq, 1.25);
    assert.equal(rolling.comp.vo - partial.comp.vo, 4); // 5 versus 1 volume points; same OBV.
    for (const key of ['tr', 'q', 'mo', 'pr', 'st']) assert.equal(rolling.comp[key], partial.comp[key], key);
    assert.equal(rolling.obvDir, partial.obvDir);
  });
  it('preserves closed-day research behavior when no override is supplied', () => {
    const { h, l, c, qv, tq } = input();
    const average = qv.slice(-31, -1).reduce((a, b) => a + b, 0) / 30;
    assert.deepEqual(factorScores(h, l, c, qv, tq), factorScores(h, l, c, qv, tq, qv.at(-1) / average));
  });
  it('rejects invalid ratios instead of turning non-numbers or negative values into ordinary scores', () => {
    const { h, l, c, qv, tq } = input();
    for (const bad of [null, true, '1', -1, NaN, Infinity, -Infinity]) {
      assert.throws(() => factorScores(h, l, c, qv, tq, bad), /invalid-relative-volume/);
    }
    assert.ok(Number.isFinite(factorScores(h, l, c, qv, tq, 0).comp.vo));
  });
});
