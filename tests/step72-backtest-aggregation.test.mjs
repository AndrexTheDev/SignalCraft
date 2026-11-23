import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { aggregate, simulate } from '../tools/backtest.mjs';
const DAY = 86400000, start = Date.UTC(2024,0,1), now = Date.UTC(2026,0,1);
function candles(scale = 1) {
  const rows = []; let price = 100 * scale, n = 270;
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    price *= 1 + 0.0045 + 0.016 * Math.sin(i * 0.9) + 0.0088 * Math.sin(i * 1.9 + 1.7) + 0.0048 * Math.sin(i * 3.1 + 0.4);
    const v = 20e6 + 100e6 * progress * progress;
    rows.push([start + i * DAY, price * 1.01, price * 0.99, price, v, v * (0.44 + 0.22 * progress)]);
  }
  return rows;
}
const decision = (overrides = {}) => ({ fwdDays: 30, tp1Hit: false, slHit: false, ret7: 0.1, ret30: 0.2, ...overrides });
describe('step72 / historical outcome aggregation', () => {
  it('does not publish infinite or rounded-to-total-loss returns from valid extreme candles', () => {
    for (const scale of [1e-102, 1]) {
      const rows = candles(scale), first = simulate(rows, now)[0];
      assert.ok(first);
      const idx = (Date.parse(first.t + 'T00:00:00Z') - start) / DAY;
      for (const offset of [7, 30]) {
        const row = rows[idx + offset];
        if (scale < 1) { row[1] = 1e308; row[3] = 1e308; }
        else { row[2] = 1e-300; row[3] = 1e-300; }
      }
      const result = simulate(rows, now).find(x => x.t === first.t);
      assert.ok(result); assert.equal(result.ret7, null); assert.equal(result.ret30, null);
    }
  });
  it('averages large finite returns without overflowing the intermediate sum', () => {
    const stats = aggregate(Array.from({ length: 200 }, () => decision({ ret7: 1e306, ret30: 1e306 })));
    assert.equal(stats.avgRet7, '1e+308 %'); assert.equal(stats.avgRet30, '1e+308 %');
    assert.equal(stats.r7Count, 200); assert.equal(stats.r30Count, 200);
  });
  it('reports unrepresentable percentages as unavailable, never Infinity or NaN', () => {
    const stats = aggregate([decision({ ret7: 1e308, ret30: 1e308 })]);
    assert.equal(stats.avgRet7, 'n/a'); assert.equal(stats.avgRet30, 'n/a');
    assert.doesNotMatch(JSON.stringify(stats), /Infinity|NaN/);
  });
  it('exposes completed, unresolved, incomplete and valid-return denominators', () => {
    const stats = aggregate([
      decision({ tp1Hit: true, ret7: 0.1, ret30: 0.2 }),
      decision({ slHit: true, ret7: null, ret30: null }),
      decision({ ret7: Infinity, ret30: Infinity }),
      decision({ fwdDays: 8, tp1Hit: true, ret7: 0.3, ret30: null })
    ]);
    assert.equal(stats.decisions, 4); assert.equal(stats.closed, 3); assert.equal(stats.incomplete, 1);
    assert.equal(stats.tp1Hits, 1); assert.equal(stats.slHits, 1); assert.equal(stats.unresolved, 1);
    assert.equal(stats.hitRate, '33.3 %'); assert.equal(stats.r7Count, 1); assert.equal(stats.r30Count, 1);
    assert.equal(stats.avgRet7, '10.00 %'); assert.equal(stats.avgRet30, '20.00 %'); assert.equal(stats.winRate30, '100.0 %');
  });
  it('labels denominators and unresolved outcomes in the CLI report', () => {
    const run = spawnSync(process.execPath, ['tools/backtest.mjs', '--selftest'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /30.*vollständig/i); assert.match(run.stdout, /weder.*TP1.*Stop/i);
    assert.match(run.stdout, /r7Count/); assert.match(run.stdout, /r30Count/); assert.match(run.stdout, /unresolved/);
  });
});
