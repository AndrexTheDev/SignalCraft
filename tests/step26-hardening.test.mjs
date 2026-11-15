import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, extractArray, writeReport
} from './helpers/html.mjs';
import {
  QUAL_MIN, qualityScore, passesQualityGate, filterSignals, pairSymbol,
  takeProfitLevels, escapeHtml, fmtP, copyLevelsText
} from './helpers/core-logic.mjs';

const app = read('app.html');
const appJs = inlineScripts(app).join('\n');
const seed = JSON.parse(extractArray(appJs, 'const SEED_SIGNALS ='));
const gated = filterSignals(seed, {});

describe('step26 / qualityScore gate', () => {
  it('missing, null and NaN quantScore are 0 and fail the Grade-A gate', () => {
    assert.equal(qualityScore({}), 0);
    assert.equal(qualityScore({ quantScore: null, confluenceScore: 99 }), 0);
    assert.equal(qualityScore({ quantScore: undefined, confluenceScore: 99 }), 0);
    assert.equal(qualityScore({ quantScore: NaN, confluenceScore: 99 }), 0);
    assert.equal(qualityScore({ quantScore: 'nope' }), 0);
    assert.equal(passesQualityGate({ quantScore: 77 }), false);
    assert.equal(passesQualityGate({ quantScore: QUAL_MIN }), true);
    assert.equal(passesQualityGate({ quantScore: 90 }), true);
    assert.equal(qualityScore({ quantScore: 90 }), 90);
    assert.equal(qualityScore({ quantScore: '80' }), 80);
  });

  it('filterSignals drops a high-confluence stub without a finite quantScore', () => {
    const poison = [
      { id: 'POISON-1', pair: 'EVIL / USD', quantScore: undefined, confluenceScore: 99, sector: 'majors', riskLevel: 'LOW', notes: 'x' },
      { id: 'POISON-2', pair: 'NAN / USD', quantScore: NaN, confluenceScore: 99, sector: 'majors', riskLevel: 'LOW', notes: 'x' },
      seed.find((s) => s.id === 'SIG-BTC-014')
    ];
    const out = filterSignals(poison, {});
    assert.deepEqual(out.map((s) => s.id), ['SIG-BTC-014']);
  });

  it('gated seed is the exclusive 10 Grade-A setups and terminal uses the same helper', () => {
    assert.equal(gated.length, 10);
    assert.equal(gated.every((s) => passesQualityGate(s)), true);
    assert.match(appJs, /function qualityScore\s*\(/);
    assert.match(appJs, /function passesQualityGate\s*\(/);
    assert.match(appJs, /if \(!passesQualityGate\(sig\)\) return false/);
    assert.equal(/if \(sig\.quantScore < QUAL_MIN\)/.test(appJs), false);
    assert.match(appJs, /filter\(passesQualityGate\)/);
    assert.match(appJs, /filter\(sg => !passesQualityGate\(sg\)\)/);
  });
});

describe('step26 / take-profit + pair guards', () => {
  it('takeProfitLevels falls back to +5% / +8% when targets are missing', () => {
    const t = takeProfitLevels({ entryPrice: 100 });
    assert.equal(t.tp1, 105);
    assert.equal(t.tp2, 108);
    const btc = seed.find((s) => s.id === 'SIG-BTC-014');
    assert.equal(takeProfitLevels(btc).tp1, btc.targets[0]);
    assert.equal(takeProfitLevels(btc).tp2, btc.targets[1]);
  });

  it('pairSymbol never throws on missing or non-string pair', () => {
    assert.equal(pairSymbol('BTC / USD'), 'BTC');
    assert.equal(pairSymbol(undefined), '—');
    assert.equal(pairSymbol(null), '—');
    assert.equal(pairSymbol(''), '—');
    assert.equal(pairSymbol(12), '12');
  });

  it('terminal guards card, dossier, chart and share against missing targets', () => {
    assert.match(appJs, /function takeProfitLevels\s*\(/);
    assert.match(appJs, /function pairSymbol\s*\(/);
    assert.equal(/const tp1 = sig\.targets\[0\]/.test(appJs), false);
    assert.equal(/sig\.targets\[0\] \* 1\.05/.test(appJs), false);
    assert.equal(/fmtP\(sig\.targets\[0\]\)/.test(appJs), false);
    assert.equal(/b\.pair\.split/.test(appJs), false);
    assert.equal(/sg\.pair\.split/.test(appJs), false);
    assert.match(appJs, /takeProfitLevels\(sig\)/);
    assert.match(appJs, /pairSymbol\(sig\.pair\)/);
    assert.match(appJs, /pairSymbol\(sg\.pair\)/);
    assert.match(appJs, /pairSymbol\(b && b\.pair\)/);
  });
});

describe('step26 / dossier on-chain + indicators', () => {
  it('dossier exposes no on-chain data and escapes what it renders', () => {
    assert.equal(/sig\.onchain|netflowM|whalePct/.test(appJs), false);
    assert.match(appJs, /escapeHtml\(String\(sig\.dexInfo\.dex\)\)/);
    assert.match(appJs, /sig\.metrics && sig\.metrics\.comp/);
    assert.match(appJs, /String\(ind/);
    assert.match(appJs, /escapeHtml\(sentChg\)/);
  });

  it('escapeHtml still wins on a poisoned on-chain field', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const out = escapeHtml(String(evil));
    assert.equal(out.includes('<img'), false);
    assert.equal(out.includes('&lt;img'), true);
  });
});

describe('step26 / enrich finite scores', () => {
  it('enrich coerces a missing confluence base instead of writing NaN', () => {
    assert.match(appJs, /Number\(sig\.confluenceScore\) \|\| 0/);
    assert.match(appJs, /Number\.isFinite\(q\) \? q : 0/);
    assert.match(appJs, /copyLevelsText\(sig\)/);
    const txt = copyLevelsText({ pair: 'AAA / USD', entryPrice: 100, stopLoss: 90, riskRewardRatio: '1:2.0' });
    assert.ok(txt.includes('TP: $' + fmtP(105) + ' / $' + fmtP(108)));
    assert.equal(copyLevelsText({ entryPrice: 100, stopLoss: 90, riskRewardRatio: '1:1' }).startsWith('— Setup'), true);
  });
});

writeReport('step26-hardening.json', {
  seed: seed.length,
  gated: gated.length,
  qualityMissing: qualityScore({ confluenceScore: 99 }),
  tpFallback: takeProfitLevels({ entryPrice: 100 }),
  pairMissing: pairSymbol(undefined)
});
