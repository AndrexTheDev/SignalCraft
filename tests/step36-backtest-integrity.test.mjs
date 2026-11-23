import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeCandles, closedCandles, passesResearchGate, simulate, aggregate, atrWilder } from '../tools/backtest.mjs';
import { read, extractBalanced } from './helpers/html.mjs';
import { factorScores, rsi, sma, r5, roundTargetUp, validLongPlan, adxWilder, riskAdjMom, factorWindowComputable } from './helpers/core-logic.mjs';

const DAY = 86400000;
const start = Date.UTC(2024, 0, 1);
const now = Date.UTC(2026, 0, 1);
function candles(n = 270) {
  const out = []; let price = 100;
  for (let i = 0; i < n; i++) {
    const progress = i / (n - 1);
    const ret = 0.0045 + 0.016 * Math.sin(i * 0.9) + 0.0088 * Math.sin(i * 1.9 + 1.7) + 0.0048 * Math.sin(i * 3.1 + 0.4);
    price = Math.max(1, price * (1 + ret));
    const volume = 20e6 + 100e6 * progress * progress;
    out.push([start + i * DAY, price * 1.01, price * 0.99, price, volume, volume * (0.44 + 0.22 * progress)]);
  }
  return out;
}
function dateFor(i) { return new Date(start + i * DAY).toISOString().slice(0, 10); }

describe('step36 / historical research integrity', () => {
  it('validates both supported formats and excludes incomplete or future days', () => {
    const simple = candles(4);
    const raw = simple.map(([t, h, l, c, v, tq]) => [t, c, h, l, c, 0, t + DAY - 1, v, 0, 0, tq, 0]);
    assert.deepEqual(normalizeCandles(simple), normalizeCandles(raw));
    assert.equal(closedCandles(simple, start + 2 * DAY + 12345).length, 2);
    assert.equal(closedCandles(simple, start + 2 * DAY - 1).length, 1);
    for (const change of [
      rows => { rows[1][0] += DAY; },
      rows => { rows[1][1] = rows[1][2] - 1; },
      rows => { rows[1][3] = 0; },
      rows => { rows[1][4] = null; },
      rows => { rows[1][5] = rows[1][4] + 1; },
      rows => { rows[1][0] += 1; },
      rows => { rows[1] = ['bad']; }
    ]) {
      const rows = candles(4); change(rows);
      assert.throws(() => normalizeCandles(rows));
    }
    raw[2][6]--;
    assert.throws(() => normalizeCandles(raw), /ungültige/);
  });

  it('uses unrounded gate metrics and fails closed at each threshold', () => {
    const m = { rsi: 75, volMio: 10, adx: 15, riskAdj30: 0.00001 };
    assert.equal(passesResearchGate(86, m), true);
    assert.equal(passesResearchGate(85, m), false);
    for (const [key, value] of [['rsi', 75.01], ['volMio', 9.999], ['adx', 14.999], ['riskAdj30', 0], ['adx', null], ['rsi', NaN]]) {
      assert.equal(passesResearchGate(90, { ...m, [key]: value }), false, key);
    }
    assert.equal(passesResearchGate(90, null), false);
  });

  it('is deterministic, starts with 200 candles, and never uses future data for a decision', () => {
    const rows = candles();
    const first = simulate(rows, now);
    assert.ok(first.length > 0, 'fixture needs qualifying decisions');
    assert.deepEqual(first, simulate(rows, now));
    assert.ok(first.every(item => item.t >= dateFor(199)));
    const altered = rows.map(r => r.slice());
    for (let i = 240; i < altered.length; i++) {
      altered[i][1] *= 1.7; altered[i][2] *= 1.7; altered[i][3] *= 1.7;
    }
    const pickDecisions = results => results.filter(r => r.t < dateFor(240)).map(({ t, score, entry, sl, tp1, tp2 }) => ({ t, score, entry, sl, tp1, tp2 }));
    assert.deepEqual(pickDecisions(first), pickDecisions(simulate(altered, now)));
    const truncated = simulate(rows, start + 240 * DAY);
    assert.ok(truncated.every(item => item.t < dateFor(240)));
    assert.deepEqual(pickDecisions(first), pickDecisions(truncated));
  });

  it('matches the terminal score, raw gate and rounded plan for an identical 200-day window', () => {
    const app = read('app.html');
    const grab = name => {
      const marker = 'function ' + name + '(';
      const start = app.indexOf(marker);
      const header = app.slice(start, app.indexOf('{', start));
      return Function('return ' + header + extractBalanced(app, marker))();
    };
    const startAt = app.indexOf('      build(sym, sec, k, src, ticker) {');
    const endAt = app.indexOf('      toSignal(b, rank, snapshotAt) {', startAt);
    assert.ok(startAt >= 0 && endAt > startAt);
    const method = app.slice(startAt, endAt).trim().replace(/,\s*$/, '');
    const build = Function('validModelCandles', 'factorScores', 'adxWilder', 'riskAdjMom', 'roundTargetUp', 'validLongPlan', 'buyPressure', 'pressureLabel', 'return ({' + method + '}).build')(
      Function('parseMarketNumber', 'factorWindowComputable', 'return ' + grab('validModelCandles').toString())(grab('parseMarketNumber'), factorWindowComputable), factorScores, adxWilder, riskAdjMom, roundTargetUp, validLongPlan, grab('buyPressure'), grab('pressureLabel')
    );
    const rows = candles();
    const historical = simulate(rows, now)[0];
    const idx = (Date.parse(historical.t + 'T00:00:00Z') - start) / DAY;
    const window = rows.slice(idx - 199, idx + 1).map(([t, h, l, c, v, tq]) => [t, c, h, l, c, 0, t + DAY - 1, v, 0, 0, tq, 0]);
    const terminal = build.call({ rsi, atrK: atrWilder, sma, r5 }, 'BTC', 'majors', window, 'binance', { volume: rows[idx][4], change: 0, time: rows[idx][0] });
    assert.equal(terminal.score, historical.score);
    assert.equal(passesResearchGate(terminal.score, terminal.gateMetrics), true);
    assert.deepEqual([terminal.entry, terminal.sl, terminal.tp1, terminal.tp2], [historical.entry, historical.sl, historical.tp1, historical.tp2]);
  });

  it('uses stop-first for ambiguous next-day candles and preserves 1:2 after rounding', () => {
    const rows = candles();
    const result = simulate(rows, now);
    assert.ok(result.length);
    const signal = result[0];
    assert.ok((signal.tp2 - signal.entry) / (signal.entry - signal.sl) >= 2 - 1e-10);
    const idx = (Date.parse(signal.t + 'T00:00:00Z') - start) / DAY;
    const altered = rows.map(r => r.slice());
    altered[idx + 1][1] = Math.max(altered[idx + 1][1], signal.tp1 * 1.01);
    altered[idx + 1][2] = Math.min(altered[idx + 1][2], signal.sl * 0.99);
    const hit = simulate(altered, now).find(x => x.t === signal.t);
    assert.ok(hit);
    assert.equal(hit.slHit, true);
    assert.equal(hit.tp1Hit, false);
  });

  it('excludes incomplete future periods from aggregated outcomes', () => {
    const stats = aggregate([
      { fwdDays: 30, tp1Hit: true, slHit: false, ret7: 0.1, ret30: 0.2 },
      { fwdDays: 4, tp1Hit: true, slHit: false, ret7: null, ret30: null }
    ]);
    assert.equal(stats.decisions, 2);
    assert.equal(stats.closed, 1);
    assert.equal(stats.tp1Hits, 1);
    assert.equal(stats.avgRet30, '20.00 %');
  });

  it('CLI fails for invalid input and labels synthetic and file-based research assumptions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'signalcraft-backtest-'));
    try {
      const file = path.join(dir, 'dump.json');
      writeFileSync(file, JSON.stringify({ BTC: candles() }));
      const valid = spawnSync(process.execPath, ['tools/backtest.mjs', '--file', file], { encoding: 'utf8' });
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /FORSCHUNGSDIAGNOSE/);
      assert.match(valid.stdout, /keine Live-Board-Rekonstruktion/);
      assert.match(valid.stdout, /keine realisierte Rendite/);
      writeFileSync(file, JSON.stringify({ BTC: candles(199) }));
      const invalid = spawnSync(process.execPath, ['tools/backtest.mjs', '--file', file], { encoding: 'utf8' });
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /weniger als 200/);
      const selftest = spawnSync(process.execPath, ['tools/backtest.mjs', '--selftest'], { encoding: 'utf8' });
      assert.equal(selftest.status, 0, selftest.stderr);
      assert.match(selftest.stdout, /synthetisch/);
      assert.match(selftest.stdout, /zwei unabhängige/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
