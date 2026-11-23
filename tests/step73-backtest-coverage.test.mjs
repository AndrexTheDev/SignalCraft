import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const DAY = 86400000, start = Date.UTC(2024,0,1);
function rows(n = 210) { return Array.from({ length: n }, (_, i) => [start + i * DAY, 2, 1, 1.5, 2e7, 1e7]); }
function run(args, preload) { return spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), 'tools/backtest.mjs', ...args], { encoding: 'utf8', timeout: 5000 }); }
function coverage(text) { const line = text.split('\n').find(x => x.startsWith('COVERAGE ')); assert.ok(line, text); return JSON.parse(line.slice(9)); }
describe('step73 / research coverage and CLI inputs', () => {
  it('reports requested, accepted and rejected file series and each actual UTC date range', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const file = path.join(dir, 'data.json'); const bad = rows(); bad[50][4] = [2e7];
      writeFileSync(file, JSON.stringify({ GOOD: rows(), BAD: bad }));
      const result = run(['--file', file]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(coverage(result.stdout), { requested: 2, processed: 1, skipped: 1 });
      assert.match(result.stderr, /Überspringe BAD/);
      assert.match(result.stdout, /GOOD\s+.*closedDays=210.*2024-01-01.*2024-07-28/);
      assert.match(result.stdout, /fehlgeschlagen|übersprungen/i);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('prints zero accepted coverage even when every pair is invalid', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const file = path.join(dir, 'data.json'); writeFileSync(file, JSON.stringify({ BAD: rows(5) }));
      const result = run(['--file', file]);
      assert.notEqual(result.status, 0); assert.deepEqual(coverage(result.stdout), { requested: 1, processed: 0, skipped: 1 });
      assert.match(result.stderr, /Keine gültige Kerzenreihe/); assert.doesNotMatch(result.stdout, /TOTALS/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('counts failed fetches and malformed responses without losing successful pairs', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const mock = path.join(dir, 'mock.mjs');
      writeFileSync(mock, `globalThis.fetch = async u => { const s = new URL(u).searchParams.get('symbol'); if (s === 'DOWNUSDT') return { ok:false, status:503 }; if (s === 'BADUSDT') return { ok:true, json: async () => [null] }; return { ok:true, json:async () => ${JSON.stringify(rows())} }; };`);
      const result = run(['--pairs', 'GOOD,DOWN,BAD'], mock);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(coverage(result.stdout), { requested: 3, processed: 1, skipped: 2 });
      assert.match(result.stdout, /GOOD\s+.*closedDays=210/);
      assert.match(result.stderr, /Überspringe DOWN.*503/); assert.match(result.stderr, /Überspringe BAD/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects repeated or escaped-equivalent JSON pair keys instead of silently overwriting them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const file = path.join(dir, 'data.json');
      for (const second of ['BTC', String.raw`\u0042TC`]) {
        writeFileSync(file, `{"BTC":${JSON.stringify(rows())},"${second}":${JSON.stringify(rows())}}`);
        const result = run(['--file', file]);
        assert.notEqual(result.status, 0, second); assert.match(result.stderr, /Doppelter Paar-Schlüssel/); assert.doesNotMatch(result.stdout, /TOTALS/);
      }
      writeFileSync(file, `{"B\\u0054C":${JSON.stringify(rows())}}`);
      const valid = run(['--file', file]);
      assert.equal(valid.status, 0, valid.stderr); assert.deepEqual(coverage(valid.stdout), { requested: 1, processed: 1, skipped: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('does not mistake escaped quotes or nested data inside raw candles for pair keys', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const file = path.join(dir, 'data.json');
      const raw = rows().map(([t,h,l,c,q,tq]) => [t,c,h,l,c,'text: } , \" nested',t + DAY - 1,q,{ inner: ['}', 'BTC', { BTC: 1 }] },0,tq]);
      writeFileSync(file, JSON.stringify({ GOOD: raw, OTHER: rows() }, null, 2));
      const result = run(['--file', file]);
      assert.equal(result.status, 0, result.stderr); assert.deepEqual(coverage(result.stdout), { requested: 2, processed: 2, skipped: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('uses only completed days for the reported UTC range', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const fixed = Date.UTC(2025, 0, 10, 12), dayStart = Date.UTC(2025, 0, 10);
      const data = Array.from({ length: 212 }, (_, i) => [dayStart - 210 * DAY + i * DAY, 2, 1, 1.5, 2e7, 1e7]);
      const file = path.join(dir, 'data.json'), mock = path.join(dir, 'clock.mjs');
      writeFileSync(file, JSON.stringify({ GOOD: data })); writeFileSync(mock, `Date.now = () => ${fixed};`);
      const result = run(['--file', file], mock);
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /closedDays=210/);
      assert.match(result.stdout, /range=2024-06-14\.\.2025-01-09/);
      assert.deepEqual(coverage(result.stdout), { requested: 1, processed: 1, skipped: 0 });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('skips unsafe pair keys without echoing terminal controls', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const file = path.join(dir, 'data.json'); writeFileSync(file, JSON.stringify({ GOOD: rows(), ['BAD\u001b[2J']: rows() }));
      const result = run(['--file', file]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(coverage(result.stdout), { requested: 2, processed: 1, skipped: 1 });
      assert.match(result.stderr, /ungültigen Paar-Schlüssel/); assert.doesNotMatch(result.stdout + result.stderr, /\u001b/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects duplicate or invalid requested pairs before any network request', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const mock = path.join(dir, 'mock.mjs'); writeFileSync(mock, `globalThis.fetch = async () => { console.error('FETCH CALLED'); throw Error('network'); };`);
      for (const pairs of ['BTC,BTC', 'BTC,,ETH', 'BTC,eth', 'BTC, ETH']) {
        const result = run(['--pairs', pairs], mock);
        assert.notEqual(result.status, 0, pairs); assert.doesNotMatch(result.stderr, /FETCH CALLED/, pairs);
        assert.match(result.stderr, /Paar|Symbol/, pairs);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects missing values and invalid limits instead of silently using defaults or accessing network', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sc73-'));
    try {
      const mock = path.join(dir, 'mock.mjs'); writeFileSync(mock, `globalThis.fetch = async () => { console.error('FETCH CALLED'); throw Error('network'); };`);
      for (const args of [['--file'], ['--file','--pairs','BTC'], ['--pairs'], ['--limit','0'], ['--limit','-1'], ['--limit','1.5'], ['--limit','abc'], ['--limit'], ['--unknown'], ['--pairs','BTC','--limit','1'], ['--limit','1','--limit','2'], ['--selftest','--limit','1']]) {
        const result = run(args, mock);
        assert.notEqual(result.status, 0, args.join(' ')); assert.doesNotMatch(result.stderr, /FETCH CALLED/, args.join(' '));
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
