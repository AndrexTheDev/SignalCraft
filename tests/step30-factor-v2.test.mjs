import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  rsi, emaLast, adxWilder, riskAdjMom, obvTrend, bbWidthPercentile,
  factorScores, passesGateV2
} from './helpers/core-logic.mjs';

// Synthetic daily series. All factors use only closed candles (no lookahead).
function series(fn, n = 200) {
  const c = [], h = [], l = [];
  for (let i = 0; i < n; i++) {
    const v = fn(i);
    c.push(v);
    h.push(v * 1.01);
    l.push(v * 0.99);
  }
  return { c, h, l };
}
const flatVol = (n = 200, v = 1000) => new Array(n).fill(v);
// taker array: share of quote volume that was taker-buy, as fraction of qv
const takerFrac = (qv, f) => qv.map((v) => v * f);

describe('factor model v2 — trend & momentum math', () => {
  const up = series((i) => Math.pow(1.012, i));
  const down = series((i) => Math.pow(0.988, i));
  const chop = series((i) => 1 + 0.06 * Math.sin(i / 1.8));

  it('emaLast follows the series (smooth, lagging)', () => {
    const e = emaLast(up.c, 20);
    assert.ok(e > up.c[0] && e < up.c[up.c.length - 1]);
  });

  it('ADX is high in a strong trend and low in a chop', () => {
    const aUp = adxWilder(up.h, up.l, up.c, 14);
    const aChop = adxWilder(chop.h, chop.l, chop.c, 14);
    assert.ok(Number.isFinite(aUp.adx), 'adx finite for trend');
    assert.ok(aUp.adx >= 25, `trend ADX should be >= 25, got ${aUp.adx}`);
    assert.ok(aUp.plusDi > aUp.minusDi, 'uptrend: +DI leads');
    assert.ok(Number.isFinite(aChop.adx), 'adx finite for chop');
    assert.ok(aChop.adx < 20, `chop ADX should be < 20, got ${aChop.adx}`);
  });

  it('ADX direction flips in a downtrend', () => {
    const aDown = adxWilder(down.h, down.l, down.c, 14);
    assert.ok(aDown.minusDi > aDown.plusDi, 'downtrend: -DI leads');
  });

  it('risk-adjusted momentum is positive in an uptrend, negative in a downtrend', () => {
    assert.ok(riskAdjMom(up.c, 30) > 0.5, 'uptrend strongly positive');
    assert.ok(riskAdjMom(down.c, 30) < 0, 'downtrend negative');
  });

  it('obvTrend reads accumulation in an uptrend and distribution in a downtrend', () => {
    const upObv = obvTrend(up.c, flatVol(200, 1000), 20);
    const downObv = obvTrend(down.c, flatVol(200, 1000), 20);
    assert.equal(upObv.dir, 'up');
    assert.equal(downObv.dir, 'down');
  });

  it('obvTrend reads flat on a zero-drift market', () => {
    const r = obvTrend(chop.c.map(() => 1), flatVol(200, 1000), 20);
    assert.equal(r.dir, 'flat');
  });

  it('bbWidthPercentile is bounded 0-100 and low in a steady grind', () => {
    for (const s of [up, down, chop]) {
      const p = bbWidthPercentile(s.c, 20, 120);
      assert.ok(p >= 0 && p <= 100, `percentile in [0,100], got ${p}`);
    }
    const pChop = bbWidthPercentile(chop.c, 20, 120);
    assert.ok(pChop <= 25, `tight sideways range should sit in the squeeze zone, got ${pChop}`);
  });
});

describe('factor model v2 — component scores & gate', () => {
  const qvUp = flatVol(200, 1000);
  const tqUp = takerFrac(qvUp, 0.58);
  const up = series((i) => Math.pow(1.012, i));
  const down = series((i) => Math.pow(0.988, i));
  const chop = series((i) => 1 + 0.06 * Math.sin(i / 1.8));

  it('strong uptrend scores Grade-A material (>= 86) and passes the gate', () => {
    const f = factorScores(up.h, up.l, up.c, qvUp, tqUp);
    const score = f.comp.tr + f.comp.q + f.comp.mo + f.comp.vo + f.comp.pr + f.comp.st;
    assert.ok(score >= 86, `uptrend score should clear the board, got ${score} (${JSON.stringify(f.comp)})`);
    assert.equal(f.comp.tr, 25, 'all trend conditions met');
    assert.ok(f.comp.q >= 10, 'trend quality maxed');
    assert.equal(passesGateV2({ quantScore: score, metrics: { rsi: 64, volMio: 500, adx: f.adx, riskAdj30: f.riskAdj30 } }), true);
  });

  it('strong downtrend scores far below the board and is rejected', () => {
    const qvDn = flatVol(200, 1000);
    const tqDn = takerFrac(qvDn, 0.42);
    const f = factorScores(down.h, down.l, down.c, qvDn, tqDn);
    const score = f.comp.tr + f.comp.q + f.comp.mo + f.comp.vo + f.comp.pr + f.comp.st;
    assert.ok(score <= 40, `downtrend score should be rejected, got ${score} (${JSON.stringify(f.comp)})`);
    assert.equal(f.comp.tr, 0, 'no trend conditions met');
    assert.equal(f.comp.mo, 0, 'no momentum credit left');
    assert.equal(passesGateV2({ quantScore: score, metrics: { rsi: 40, volMio: 500, adx: f.adx, riskAdj30: f.riskAdj30 } }), false);
  });

  it('choppy sideways market scores far below the board (no fake trend credit)', () => {
    const f = factorScores(chop.h, chop.l, chop.c, qvUp, tqUp);
    const score = f.comp.tr + f.comp.q + f.comp.mo + f.comp.vo + f.comp.pr + f.comp.st;
    assert.ok(score < 78, `chop should not reach B+, got ${score} (${JSON.stringify(f.comp)})`);
    assert.ok(f.comp.q <= 6, 'chop earns no real ADX credit');
  });

  it('gate v2 rejects Grade-A scores without a live trend (ADX < 15)', () => {
    assert.equal(passesGateV2({ quantScore: 90, metrics: { rsi: 60, volMio: 25, adx: 12, riskAdj30: 0.4 } }), false);
    assert.equal(passesGateV2({ quantScore: 90, metrics: { rsi: 60, volMio: 25, adx: 20, riskAdj30: 0.4 } }), true);
  });

  it('gate v2 rejects negative risk-adjusted momentum even at Grade A', () => {
    assert.equal(passesGateV2({ quantScore: 90, metrics: { rsi: 60, volMio: 25, adx: 25, riskAdj30: -0.1 } }), false);
    assert.equal(passesGateV2({ quantScore: 90, metrics: { rsi: 60, volMio: 25, adx: 25, riskAdj30: 0 } }), false);
  });

  it('gate v2 falls back to the base gate when the new metrics are absent (build-seed data)', () => {
    assert.equal(passesGateV2({ quantScore: 88, metrics: { rsi: 70, volMio: 25 } }), true);
    assert.equal(passesGateV2({ quantScore: 88, metrics: undefined }), true);
    assert.equal(passesGateV2({ quantScore: 88, metrics: { rsi: 76, volMio: 25 } }), false);
  });
});
