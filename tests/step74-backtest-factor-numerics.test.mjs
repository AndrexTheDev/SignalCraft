import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCandles, simulate } from '../tools/backtest.mjs';
const DAY = 86400000, start = Date.UTC(2024,0,1), now = Date.UTC(2026,0,1);
function rows(priceScale = 1, volume = 2e7) {
  let p = 100 * priceScale; const out = [];
  for (let i = 0; i < 270; i++) {
    p *= 1 + 0.008 + 0.02 * Math.sin(i * 0.6 + 0.5) + 0.005 * Math.sin(i * 1.7);
    out.push([start + i * DAY, p * 1.01, p * 0.99, p, volume, volume * ((i % 7) < 4 ? 0.52 : 0.60)]);
  }
  return out;
}
describe('step74 / backtest factor numeric boundaries', () => {
  it('does not score a window whose cumulative volume makes OBV and relative volume overflow', () => {
    const ordinary = rows(), extreme = rows(1, 1e307);
    assert.ok(simulate(ordinary, now).length > 0, 'fixture has ordinary qualifying signals');
    assert.equal(normalizeCandles(extreme).length, extreme.length, 'individual input values are finite');
    assert.deepEqual(simulate(extreme, now), []);
  });
  it('does not invent Bollinger percentiles when price variance overflows or underflows', () => {
    assert.ok(simulate(rows(1), now).length > 0);
    assert.ok(simulate(rows(1e-100), now).length > 0, 'small but representable intermediate values still work');
    for (const scale of [1e-200, 1e160]) {
      const data = rows(scale); assert.equal(normalizeCandles(data).length, data.length);
      assert.deepEqual(simulate(data, now), [], String(scale));
    }
  });
  it('reports numerically skipped windows separately from a valid zero-signal result', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc74-'));
    try {
      const file = path.join(dir, 'data.json');
      writeFileSync(file, JSON.stringify({ BIG: rows(1, 1e307) }));
      const run = spawnSync(process.execPath, ['tools/backtest.mjs', '--file', file], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /BIG\s+decisions=\s*0/);
      assert.match(run.stdout, /unsafeWindows=71/);
      assert.match(run.stdout, /unsafeWindows.*numerisch/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('excludes only affected rolling windows, not earlier valid signals', () => {
    const input = rows(), cutoff = 240;
    for (let i = cutoff; i < input.length; i++) { input[i][4] = 1e307; input[i][5] = 5.5e306; }
    const result = simulate(input, now), cutoffDate = new Date(start + cutoff * DAY).toISOString().slice(0,10);
    const overflowDate = new Date(start + (cutoff + 17) * DAY).toISOString().slice(0,10);
    assert.ok(result.length > 0);
    assert.ok(result.every(x => x.t < overflowDate));
    const key = x => [x.t, x.score, x.entry, x.sl, x.tp1, x.tp2];
    const before = simulate(rows(), now).filter(x => x.t < cutoffDate).map(key);
    assert.deepEqual(result.filter(x => x.t < cutoffDate).map(key), before);
  });
});
