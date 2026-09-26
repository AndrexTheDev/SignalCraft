import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUAL_MIN, gradeFromQuant, filterSignals, paginate, atrK, rsi, longLevels
} from './helpers/core-logic.mjs';
import { read, inlineScripts, extractArray } from './helpers/html.mjs';

const seed = JSON.parse(extractArray(inlineScripts(read('app.html')).join('\n'), 'const SEED_SIGNALS ='));
const gated = filterSignals(seed, {});

describe('step6 / filter matrix', () => {
  it('quality gate drops C-grade setups', () => {
    assert.equal(gated.every((s) => (s.quantScore ?? 0) >= QUAL_MIN), true);
    assert.ok(gated.length < seed.length);
    assert.ok(gated.length >= 20);
  });

  it('risk-high is a strict subset of the gated board', () => {
    const high = filterSignals(seed, { filter: 'risk-high' });
    assert.ok(high.length > 0);
    assert.equal(high.every((s) => s.riskLevel === 'HIGH'), true);
    assert.ok(high.length <= gated.length);
  });

  it('sector majors only returns majors', () => {
    const majors = filterSignals(seed, { sector: 'majors' });
    assert.ok(majors.length > 0);
    assert.equal(majors.every((s) => s.sector === 'majors'), true);
  });

  it('search BTC hits bitcoin and nothing unrelated', () => {
    const btc = filterSignals(seed, { q: 'BTC' });
    assert.ok(btc.some((s) => /BTC/i.test(s.pair)));
    assert.equal(btc.every((s) => /btc/i.test(s.pair + s.notes + s.sector)), true);
  });

  it('combined majors + risk-low never leaks other sectors', () => {
    const mix = filterSignals(seed, { sector: 'majors', filter: 'risk-low' });
    assert.equal(mix.every((s) => s.sector === 'majors' && s.riskLevel === 'LOW'), true);
  });

  it('impossible query is empty', () => {
    assert.equal(filterSignals(seed, { q: 'ZZZNOCOIN999' }).length, 0);
  });
});

describe('step6 / pagination math', () => {
  it('clamps a page past the end back to the last page', () => {
    const p = paginate(gated, 99, 25);
    assert.equal(p.current, p.totalPages);
    assert.ok(p.slice.length <= 25);
    assert.equal(p.end, p.total);
  });

  it('page 1 of 20 never exceeds the page size', () => {
    const p = paginate(gated, 1, 20);
    assert.ok(p.slice.length <= 20);
    assert.equal(p.start, 0);
  });

  it('empty list still reports one page', () => {
    const p = paginate([], 3, 25);
    assert.equal(p.totalPages, 1);
    assert.equal(p.current, 1);
    assert.deepEqual(p.slice, []);
  });
});

describe('step6 / market math', () => {
  it('ATR is zero on a flat series and positive on a ranging one', () => {
    const flat = Array(40).fill(100);
    assert.equal(atrK(flat, flat, flat), 0);
    const h = Array.from({ length: 40 }, (_, i) => 110 + (i % 5));
    const l = Array.from({ length: 40 }, (_, i) => 90 - (i % 5));
    const c = Array.from({ length: 40 }, (_, i) => 100 + (i % 3));
    assert.ok(atrK(h, l, c) > 5);
  });

  it('a 1.5 ATR stop / 3 ATR target is 1:2', () => {
    const last = 100, a = 2;
    const { rr2 } = longLevels(last, last - 1.5 * a, last + 1.5 * a, last + 3 * a);
    assert.ok(Math.abs(rr2 - 2) < 1e-9);
  });

  it('grade boundaries are exclusive below the next letter', () => {
    assert.equal(gradeFromQuant(92.9), 'A');
    assert.equal(gradeFromQuant(85.9), 'B+');
    assert.equal(gradeFromQuant(77.9), 'B');
  });

  it('RSI of mixed series stays in 0–100', () => {
    const c = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 8 + i * 0.05);
    const r = rsi(c);
    assert.ok(r >= 0 && r <= 100);
  });
});
