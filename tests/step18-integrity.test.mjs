import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, extractArray, stripScripts, writeReport
} from './helpers/html.mjs';
import {
  QUAL_MIN, gradeFromQuant, longPlanValid, safeJsonArray, clampPct, isLiveCache, escapeHtml
} from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json')); // Offline test fixture, never served to users.

describe('step18 / seed integrity', () => {
  it('every LONG has SL < entry < TP1 ≤ TP2', () => {
    const bad = seed.filter((s) => !longPlanValid(s)).map((s) => s.id);
    assert.deepEqual(bad, []);
  });

  it('sentiment, confluence and quant scores stay in 0–100', () => {
    for (const s of seed) {
      assert.ok(s.sentiment.score >= 0 && s.sentiment.score <= 100, s.id + ' sent');
      assert.ok(s.confluenceScore >= 0 && s.confluenceScore <= 100, s.id + ' conf');
      assert.ok(s.quantScore >= 0 && s.quantScore <= 100, s.id + ' quant');
      assert.equal(s.sentiment.bullPct + s.sentiment.bearPct, 100, s.id + ' split');
    }
  });

  it('k24 candles are 24 OHLC bars with high ≥ open/close ≥ low', () => {
    for (const s of seed) {
      assert.equal(s.k24.length, 24, s.id);
      for (const c of s.k24) {
        const [o, h, l, cl] = c.map(Number);
        assert.ok(h >= l && h >= o && h >= cl && l <= o && l <= cl, s.id);
      }
    }
  });

  it('runtime enrich overwrites grade from quantScore (Grade A at QUAL_MIN)', () => {
    assert.equal(QUAL_MIN, 86);
    assert.match(appJs, /sig\.grade = gradeFromQuant\(sig\.quantScore\)/);
    assert.match(appJs, /Number\(sig\.confluenceScore\) \|\| 0/);
    assert.equal(gradeFromQuant(85), 'B+');
    assert.equal(gradeFromQuant(77), 'B');
  });
});

describe('step18 / storage + cache hardening', () => {
  it('safeJsonArray rejects objects, poison and junk', () => {
    assert.deepEqual(safeJsonArray('[{"email":"a@b.c"}]').map((x) => x.email), ['a@b.c']);
    assert.deepEqual(safeJsonArray('{"__proto__":{"x":1}}'), []);
    assert.deepEqual(safeJsonArray('not-json'), []);
    assert.deepEqual(safeJsonArray('{"email":"x"}'), []);
    assert.deepEqual(safeJsonArray(null), []);
  });

  it('isLiveCache requires structurally valid unique LIVE records', () => {
    const ok = { signals: Array.from({ length: 110 }, (_, i) => ({ ...seed[0], id: 'SIG-' + i, pair: 'AAA' + i + ' / USDT', modelVersion: 3, quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } })) };
    assert.equal(isLiveCache(ok), true);
    assert.equal(isLiveCache({ signals: 'x'.repeat(120) }), false);
    assert.equal(isLiveCache({ signals: [] }), false);
    assert.equal(isLiveCache({ signals: Array.from({ length: 99 }, (_, i) => ({ id: 'SIG-' + i, pair: 'AAA / USD' })) }), false);
    assert.equal(isLiveCache({ signals: Array.from({ length: 120 }, () => 'nope') }), false);
  });

  it('terminal uses isLiveCache for the market cache and no lead store remains', () => {
    assert.match(appJs, /function isLiveCache\s*\(/);
    assert.match(appJs, /isLiveCache\(\{ signals: list \}\)/);
    assert.equal(/function safeJsonArray|signalcraft_leads/.test(appJs), false);
  });

  it('apply() refuses a non-array live list', () => {
    assert.match(appJs, /isLiveCache\(\{ signals: list \}\)/);
  });
});

describe('step18 / xss + numeric css', () => {
  it('dossier does not associate unverified DEX tokens or fabricate on-chain fields', () => {
    assert.doesNotMatch(appJs, /sig\.dexInfo\.dex/);
    assert.equal(/netflowM|whalePct|sig\.onchain|dexInfo\.netflow/.test(appJs), false);
  });

  it('sentiment meter width is clamped to 0–100', () => {
    assert.match(appJs, /function clampPct\s*\(/);
    assert.equal(clampPct(140), 100);
    assert.equal(clampPct(-4), 0);
    assert.equal(clampPct('80px'), 0);
    assert.equal(clampPct('onload'), 0);
    assert.match(appJs, /clampPct\(sent\.score\)/);
  });

  it('search haystack never calls toLowerCase on a missing notes field', () => {
    assert.match(appJs, /String\(displayed\.notes \|\| ''\)/);
    assert.match(appJs, /String\(displayed\.pair \|\| ''\)/);
  });

  it('escapeHtml still neutralizes tags', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>').includes('<img'), false);
  });
});

describe('step18 / links + referrer + scripts', () => {
  it('window.open always requests noopener', () => {
    const lines = appJs.split('\n').filter((l) => l.includes('window.open('));
    assert.ok(lines.length >= 1);
    for (const line of lines) assert.match(line, /noopener/);
  });

  it('no http:// script or stylesheet on either page', () => {
    const srcs = [...(app + landing).matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
    const http = srcs.filter((s) => /^http:\/\//i.test(s));
    assert.deepEqual(http, []);
  });

  it('both pages send a strict-origin-when-cross-origin referrer policy', () => {
    for (const html of [app, landing]) {
      assert.match(html, /name="referrer" content="strict-origin-when-cross-origin"/);
    }
  });

  it('invalid lang is ignored at init (I18N / L lookup)', () => {
    assert.match(appJs, /Object\.prototype\.hasOwnProperty\.call\(I18N, urlLang\)/);
    assert.match(landJs, /Object\.prototype\.hasOwnProperty\.call\(L, q\)/);
    assert.match(appJs, /if \(!I18N\[code\]\) code = 'en'/);
  });
});

describe('step18 / functional wiring still present', () => {
  it('copy dossier is wired; pagination was removed with the exclusive board', () => {
    assert.match(appJs, /btnCopyDossierData/);
    assert.equal(/btnPrevPageBottom|btnNextPageBottom|btnPrevPage\b|btnNextPage\b/.test(appJs), false);
    assert.equal(/id="btnPrevPage"|id="btnNextPage"/.test(stripScripts(app)), false);
  });

  it('saved theme is whitelisted', () => {
    assert.match(appJs, /\['gallery-dark', 'terminal-amber', 'paper-light'\]/);
    assert.match(appJs, /\.includes\(saved\)/);
  });

  it('writes the integrity report', () => {
    writeReport('step18-integrity.json', {
      seed: seed.length,
      longPlanOk: seed.every(longPlanValid),
      helpers: ['isLiveCache', 'clampPct']
    });
  });
});
