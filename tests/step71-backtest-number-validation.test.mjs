import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCandles, closedCandles, simulate } from '../tools/backtest.mjs';
const DAY = 86400000, start = Date.UTC(2024, 0, 1), now = Date.UTC(2026, 0, 1);
function simple() { return [start, 2, 1, 1.5, 2, 1]; }
function raw() { return [start, 1.5, 2, 1, 1.5, 'unused', start + DAY - 1, 2, 'unused', 'unused', 1]; }
function series() { return Array.from({ length: 210 }, (_, i) => { const row = simple(); row[0] += i * DAY; return row; }); }
describe('step71 / strict historical market numbers', () => {
  it('rejects array coercion in every used simple and raw field', () => {
    for (const [factory, keys] of [[simple, [0,1,2,3,4,5]], [raw, [0,1,2,3,4,6,7,10]]]) {
      for (const key of keys) {
        const row = factory(); row[key] = [row[key]];
        assert.throws(() => normalizeCandles([row]), undefined, `${factory.name} ${key}`);
      }
    }
  });
  it('rejects booleans, hexadecimal strings, missing values and non-finite strings', () => {
    for (const [factory, pairs] of [[simple, [[1,'0x2'],[2,true],[3,true],[4,true],[5,false],[0,'0x' + start.toString(16)]]], [raw, [[1,true],[2,'0x2'],[3,true],[4,true],[6,'0x' + (start + DAY - 1).toString(16)],[7,true],[10,false]]]]) {
      for (const [key, bad] of pairs) {
        const row = factory(); row[key] = bad;
        assert.throws(() => normalizeCandles([row]), undefined, `${factory.name} ${key}: ${bad}`);
      }
    }
    for (const bad of [null, undefined, '', ' ', {}, [], 'NaN', 'Infinity', '1e999']) {
      const row = simple(); row[4] = bad; row[5] = 0;
      assert.throws(() => normalizeCandles([row]), undefined, String(bad));
    }
  });
  it('rejects nonzero decimal underflow instead of treating it as zero volume', () => {
    for (const [factory, q, taker] of [[simple,4,5], [raw,7,10]]) {
      const a = factory(); a[q] = '1e-999'; a[taker] = 0;
      const b = factory(); b[taker] = '1e-999';
      assert.throws(() => normalizeCandles([a])); assert.throws(() => normalizeCandles([b]));
    }
  });
  it('accepts finite numeric and decimal/scientific strings with an intact UTC series', () => {
    const a = series().slice(0, 3), b = a.map(row => row.map(String));
    b[0][4] = '2e0'; b[0][5] = ' 1.0 ';
    assert.deepEqual(normalizeCandles(b), normalizeCandles(a));
    assert.equal(closedCandles(b, start + 2 * DAY).length, 2);
    assert.deepEqual(simulate(series(), now), simulate(series().map(row => row.map(String)), now));
  });
  it('rejects out-of-range dates instead of letting the simulation crash later', () => {
    const t = 100000001 * DAY;
    const row = simple(); row[0] = t;
    assert.throws(() => normalizeCandles([row]));
  });
  it('CLI skips a malformed pair, keeps a valid pair, and fails if none remain', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc71-'));
    try {
      const file = path.join(dir, 'data.json'); const bad = series(); bad[30][4] = [2];
      writeFileSync(file, JSON.stringify({ BAD: bad, GOOD: series() }));
      const mixed = spawnSync(process.execPath, ['tools/backtest.mjs', '--file', file], { encoding: 'utf8' });
      assert.equal(mixed.status, 0, mixed.stderr);
      assert.match(mixed.stderr, /Überspringe BAD/); assert.match(mixed.stdout, /GOOD\s+decisions=/);
      assert.doesNotMatch(mixed.stdout, /BAD\s+decisions=/);
      writeFileSync(file, JSON.stringify({ BAD: bad }));
      const invalid = spawnSync(process.execPath, ['tools/backtest.mjs', '--file', file], { encoding: 'utf8' });
      assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /Keine gültige Kerzenreihe/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
