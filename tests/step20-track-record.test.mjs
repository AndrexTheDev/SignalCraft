import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, extractArray, stripScripts, writeReport
} from './helpers/html.mjs';
import {
  QUAL_MIN, gradeFromQuant, simulateLongTp1, trackRecordSetups, passesQualityGate
} from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const seed = JSON.parse(extractArray(appJs, 'const SEED_SIGNALS ='));
const gated = seed.filter((s) => passesQualityGate(s));

describe('step20 / simulateLongTp1', () => {
  const path = (rows) => rows.map((r) => [r[0], r[1], r[2], r[3]]);

  it('counts a TP1 print after fill as a hit', () => {
    const k = path([
      [9, 10, 8, 9],
      [9, 13, 8.5, 12]
    ]);
    assert.equal(simulateLongTp1(9, 7, 12, k, 0), 'hit');
  });

  it('counts a stop print after fill as a stop', () => {
    const k = path([
      [9, 10, 8, 9],
      [9, 10, 6.5, 7]
    ]);
    assert.equal(simulateLongTp1(9, 7, 12, k, 0), 'stop');
  });

  it('treats same-bar SL+TP as a stop (conservative)', () => {
    const k = path([[9, 13, 6, 10]]);
    assert.equal(simulateLongTp1(9, 7, 12, k, 0), 'stop');
  });

  it('returns open when filled but neither level prints', () => {
    const k = path([[9, 10, 8, 9], [9.2, 10.5, 8.5, 9.4]]);
    assert.equal(simulateLongTp1(9, 7, 12, k, 0), 'open');
  });

  it('returns none when price never trades through entry', () => {
    const k = path([[4, 5, 3, 4], [4.2, 5.1, 4, 4.5]]);
    assert.equal(simulateLongTp1(9, 7, 12, k, 0), 'none');
  });
});

describe('step20 / trackRecordSetups (non-overlapping per setup)', () => {
  it('simulates exactly one path per setup (no overlapping rolling closes)', () => {
    const setups = [{
      id: 'T-HIT', g: 'A+', e: 100, sl: 90, tp: 110,
      k: [[100, 101, 99, 100], [100, 112, 98, 111], [111, 112, 110, 111]]
    }, {
      id: 'T-STOP', g: 'A', e: 100, sl: 90, tp: 110,
      k: [[100, 101, 99, 100], [99, 105, 88, 90], [90, 91, 89, 90]]
    }];
    const tr = trackRecordSetups(setups);
    assert.equal(tr.setups, 2);
    assert.equal(tr.resolved, 2);
    assert.equal(tr.hit, 1);
    assert.equal(tr.stop, 1);
    assert.equal(tr.pct, 50);
    assert.equal(tr.byGrade['A+'].hit, 1);
    assert.equal(tr.byGrade['A+'].n, 1);
    assert.equal(tr.byGrade.A.stop, 1);
    assert.equal(tr.byGrade.A.n, 1);
  });

  it('ignores junk rows instead of throwing', () => {
    const tr = trackRecordSetups([null, { e: 0, sl: 0, tp: 0, k: [] }, { g: 'A+' }]);
    assert.equal(tr.setups, 0);
    assert.equal(tr.pct, null);
  });
});

describe('step20 / landing is computed, not invented', () => {
  it('proof figure is a live node, not a hardcoded 71%', () => {
    const markup = stripScripts(landing);
    assert.match(markup, /id="proofHitPct"/);
    assert.equal(/id="proofHitPct"[^>]*>\s*71%/.test(markup), false);
    assert.equal(/class="proof-num"[^>]*>\s*71%/.test(markup), false);
  });

  it('copy templates use explicit counts ({resolved}/{hit}/{stop}) and never a made-up 71%', () => {
    assert.match(landJs, /pr_d:[\s\S]{0,280}\{resolved\}/);
    assert.match(landJs, /pr_d:[\s\S]{0,280}\{hit\}/);
    assert.match(landJs, /pr_d:[\s\S]{0,280}\{stop\}/);
    assert.equal(/pr_d:[\s\S]{0,280}71%/.test(landJs), false);
    assert.equal(/\{pct\}/.test(landJs), false);
  });

  it('og:title no longer advertises an invented 71%', () => {
    assert.equal(/og:title"[^>]*71%/.test(landing), false);
  });

  it('ships simulateLongTp1 + trackRecordSetups and paints the proof band', () => {
    assert.match(landJs, /function simulateLongTp1\s*\(/);
    assert.match(landJs, /function trackRecordSetups\s*\(/);
    assert.match(landJs, /function renderProof\s*\(/);
    assert.match(landJs, /proofHitPct/);
    assert.match(landJs, /proofG1/);
    assert.match(landJs, /proofG2/);
  });
});

describe('step20 / TRACK_SET matches the gated terminal seed', () => {
  const raw = extractArray(landJs, 'var TRACK_SET =');
  it('TRACK_SET is present and parseable', () => {
    assert.ok(raw, 'missing var TRACK_SET =');
  });

  it('one compact row per Grade-A board setup, same id / levels / k24', () => {
    const track = Function('return (' + raw + ')')();
    assert.equal(track.length, gated.length);
    assert.equal(track.length, 10);
    const byId = Object.fromEntries(track.map((t) => [t.id, t]));
    for (const s of gated) {
      const t = byId[s.id];
      assert.ok(t, 'missing ' + s.id);
      assert.equal(t.e, s.entryPrice);
      assert.equal(t.sl, s.stopLoss);
      assert.equal(t.tp, s.targets[0]);
      assert.equal(t.g, gradeFromQuant(s.quantScore));
      assert.deepEqual(t.k, s.k24);
    }
  });

  it('computed TP1 hit rate is a real 0–100 integer from resolved paths', () => {
    const track = Function('return (' + raw + ')')();
    const tr = trackRecordSetups(track);
    assert.equal(tr.setups, 10);
    assert.equal(tr.resolved, 10);
    assert.equal(Number.isInteger(tr.pct), true);
    assert.ok(tr.pct >= 1 && tr.pct <= 99, 'pct ' + tr.pct);
    assert.ok(tr.byGrade['A+'] && tr.byGrade.A, 'both grades reported');
    assert.equal(tr.byGrade['A+'].n + tr.byGrade.A.n, 10);
    writeReport('step20-track-record.json', {
      setups: tr.setups,
      resolved: tr.resolved,
      hits: tr.total.hit,
      stops: tr.total.stop,
      pct: tr.pct,
      byGrade: Object.fromEntries(Object.entries(tr.byGrade).map(([g, b]) => [g, { pct: b.pct, hit: b.hit, stop: b.stop }]))
    });
  });
});
