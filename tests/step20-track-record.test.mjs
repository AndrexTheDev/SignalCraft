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
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json')); // Offline test fixture, never served to users.
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

describe('step20 / historical examples are not published', () => {
  it('does not display the historical track record or bundled example signals', () => {
    const markup = stripScripts(landing);
    assert.doesNotMatch(markup, /id="proofHitPct"|id="radRow1"/);
    assert.doesNotMatch(landJs, /var TRACK_SET|function renderProof/);
    assert.doesNotMatch(appJs, /const SEED_SIGNALS =/);
  });
});
