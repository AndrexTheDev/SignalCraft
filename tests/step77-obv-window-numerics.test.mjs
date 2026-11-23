import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { factorWindowComputable, obvTrend, factorScores } from './helpers/core-logic.mjs';
import { normalizeCandles, simulate } from '../tools/backtest.mjs';

const DAY = 86400000, start = Date.UTC(2024, 0, 1), now = Date.UTC(2026, 0, 1);
function inputs() {
  const c = Array.from({ length: 200 }, (_, i) => 100 + i + Math.sin(i));
  return { c, h: c.map(v => v * 1.01), l: c.map(v => v * 0.99), qv: Array(200).fill(1000), tq: Array(200).fill(550) };
}
function obv(x) { return obvTrend(x.c, x.qv, 20); }
describe('step77 / OBV window numeric independence', () => {
  it('ignores ancient volumes while preserving the last 20 price changes', () => {
    const normal = inputs(), oldSpike = inputs();
    oldSpike.qv[10] = 1e100; oldSpike.tq[10] = 5e99;
    assert.equal(factorWindowComputable(oldSpike.h, oldSpike.c, oldSpike.qv, oldSpike.tq), true);
    assert.deepEqual(obv(oldSpike), obv(normal));
    assert.equal(obv(oldSpike).dir, 'up');
    assert.equal(factorScores(oldSpike.h, oldSpike.l, oldSpike.c, oldSpike.qv, oldSpike.tq).comp.vo,
      factorScores(normal.h, normal.l, normal.c, normal.qv, normal.tq).comp.vo);
  });
  it('does not treat a positive subnormal 20-day total as zero', () => {
    const x = inputs(); x.qv.fill(0); x.tq.fill(0);
    x.qv[169] = 1e-320; x.qv[194] = Number.MIN_VALUE; x.qv[199] = Number.MIN_VALUE;
    assert.equal(factorWindowComputable(x.h, x.c, x.qv, x.tq), true);
    assert.deepEqual(obv(x), { pct: 1, dir: 'up' });
    assert.equal(factorScores(x.h, x.l, x.c, x.qv, x.tq).obvDir, 'up');
  });
  it('matches the cumulative definition on ordinary data, including the 20-day boundary', () => {
    let state = 1777;
    const random = () => { state = (state * 48271) % 2147483647; return state; };
    for (let n = 0; n < 100; n++) {
      const c = [100], qv = [1000];
      for (let i = 1; i < 200; i++) { c.push(c.at(-1) + ((random() % 3) - 1)); qv.push(1 + random() % 10000); }
      let cumulative = 0, atStart = 0;
      for (let i = 1; i < c.length; i++) {
        cumulative += Math.sign(c[i] - c[i - 1]) * qv[i];
        if (i === c.length - 21) atStart = cumulative;
      }
      const expected = (cumulative - atStart) / qv.slice(-20).reduce((a, b) => a + b, 0);
      assert.equal(obvTrend(c, qv, 20).pct, expected);
      assert.equal(obvTrend(c, qv, 20).dir, expected > 0.05 ? 'up' : expected < -0.05 ? 'down' : 'flat');
    }
  });
  it('keeps true zero-volume windows flat', () => {
    const x = inputs(); x.qv.fill(0); assert.deepEqual(obv(x), { pct: 0, dir: 'flat' });
  });
  it('keeps research signals unchanged after a large volume outside the OBV and relative-volume windows', () => {
    let price = 100;
    const rows = Array.from({ length: 270 }, (_, i) => {
      price *= 1 + 0.008 + 0.02 * Math.sin(i * 0.6 + 0.5) + 0.005 * Math.sin(i * 1.7);
      return [start + i * DAY, price * 1.01, price * 0.99, price, 2e7, 2e7 * ((i % 7) < 4 ? 0.52 : 0.60)];
    });
    const spiked = rows.map(r => [...r]); spiked[10][4] = 1e100; spiked[10][5] = 5e99;
    assert.equal(normalizeCandles(spiked).length, 270);
    const ordinary = simulate(rows, now), altered = simulate(spiked, now);
    assert.ok(ordinary.length > 0, 'fixture yields a research setup');
    assert.deepEqual(altered, ordinary);
  });
});
