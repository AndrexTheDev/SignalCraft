import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, extractArray, writeReport
} from './helpers/html.mjs';
import {
  QUAL_MIN, filterSignals, copyLevelsText, sortSignalsList,
  fmtUtcTime, sectorCounts, isLiveCache, parseBoardQuery,
  serializeBoardQuery, fmtP, escapeHtml
} from './helpers/core-logic.mjs';

const LANGS = ['de', 'en', 'es', 'ar', 'zh'];
const app = read('app.html');
const appJs = inlineScripts(app).join('\n');
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json')); // Offline test fixture, never served to users.
const gated = filterSignals(seed, {});
const counts = sectorCounts(seed);
function qualMinGate() { return gated.length; }

function i18nKeys(block) {
  return [...block.matchAll(/^\s{8}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
}

function langChunks(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'missing ' + marker);
  const rest = src.slice(start);
  const nextConst = rest.search(/\n    const [A-Z_]/);
  const slice = rest.slice(0, nextConst > 0 ? nextConst : 80_000);
  const out = {};
  for (let i = 0; i < LANGS.length; i++) {
    const lang = LANGS[i];
    const needle = '\n      ' + lang + ': {';
    const at = slice.indexOf(needle);
    assert.ok(at >= 0, marker + ' ' + lang);
    let next = LANGS[i + 1] ? slice.indexOf('\n      ' + LANGS[i + 1] + ': {', at + 1) : -1;
    if (next < 0) {
      const close = slice.indexOf('\n    }', at);
      next = close >= 0 ? close : slice.length;
    }
    out[lang] = slice.slice(at, next);
  }
  return out;
}

describe('step24 / copyLevelsText', () => {
  it('formats pair, entry, SL, both TPs and R:R', () => {
    const btc = seed.find((s) => s.id === 'SIG-BTC-014');
    assert.ok(btc);
    const txt = copyLevelsText(btc);
    assert.match(txt, /^BTC \/ USD Setup \| Entry: /);
    assert.ok(txt.includes('SL: ' + fmtP(btc.stopLoss) + ' USD'));
    assert.ok(txt.includes('TP: ' + fmtP(btc.targets[0]) + ' USD / ' + fmtP(btc.targets[1]) + ' USD'));
    assert.ok(txt.includes('R:R: ' + btc.riskRewardRatio));
    assert.match(txt, /\(Signalcraft\)$/);
  });

  it('does not fabricate TP levels when targets are missing', () => {
    const txt = copyLevelsText({
      pair: 'AAA / USD', entryPrice: 100, stopLoss: 90, riskRewardRatio: '1:2.0'
    });
    assert.ok(txt.includes('TP: - USD / - USD'));
  });

  it('terminal helper stays in sync with the unit mirror', () => {
    assert.match(appJs, /function copyLevelsText\s*\(/);
    assert.match(appJs, /pair \+ ' Setup \| Entry: '/);
    assert.match(appJs, /function fmtUtcTime\s*\(/);
    assert.match(appJs, /function sortSignalsList\s*\(/);
  });
});

describe('step24 / filter + sort', () => {
  it('gated board is the exclusive 10 Grade-A setups, never 120', () => {
    assert.equal(seed.length, 120);
    assert.equal(qualMinGate(), 10);
    assert.equal(gated.every((s) => (s.quantScore ?? 0) >= QUAL_MIN), true);
  });

  it('sector pills must count gated setups, not the raw 24-per-bucket seed', () => {
    assert.equal(counts.all, 10);
    assert.equal(counts.majors, 6);
    assert.equal(counts['layer1-2'], 1);
    assert.equal(counts.defi, 2);
    assert.equal(counts.ai, 1);
    assert.equal(counts.memes, undefined);
    assert.equal(Object.values(counts).filter((n) => n === 24).length, 0);
  });

  it('risk-low on the gated board is exactly BTC and TRX', () => {
    const low = filterSignals(seed, { filter: 'risk-low' });
    assert.deepEqual(low.map((s) => s.id).sort(), ['SIG-BTC-014', 'SIG-TRX-021']);
  });

  it('sort by risk puts LOW ahead of HIGH; confluence puts the top score first', () => {
    const byRisk = sortSignalsList(gated, 'risk');
    assert.equal(byRisk[0].riskLevel, 'LOW');
    assert.equal(byRisk[0].id, 'SIG-BTC-014');
    assert.equal(byRisk[byRisk.length - 1].riskLevel, 'HIGH');
    const byConf = sortSignalsList(gated, 'confluence');
    assert.equal(byConf[0].id, 'SIG-G-003');
    assert.ok(byConf[0].confluenceScore >= byConf[1].confluenceScore);
  });
});

describe('step24 / clocks, cache, query', () => {
  it('fmtUtcTime is timezone-proof (seed close is 23:59:59 UTC)', () => {
    assert.equal(fmtUtcTime(1790035199999), '23:59:59 UTC');
    assert.equal(fmtUtcTime('nope'), '—');
    assert.equal(fmtUtcTime(undefined), '—');
  });

  it('terminal stamps cards in UTC, not local time labelled UTC', () => {
    assert.match(appJs, /fmtUtcTime\(sig\.timestamp\)/);
    assert.equal(/toLocaleTimeString\(\)\s*\} UTC/.test(appJs), false);
  });

  it('isLiveCache rejects the wrong length and non-objects', () => {
    const one = i => ({ ...seed[0], id: 'SIG-' + i, pair: 'AAA' + i + ' / USDT', modelVersion: 4, quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } });
    assert.equal(isLiveCache({ signals: Array.from({ length: 120 }, (_, i) => one(i)) }), true);
    assert.equal(isLiveCache({ signals: Array.from({ length: 99 }, (_, i) => one(i)) }), true);
    assert.equal(isLiveCache({ signals: [] }), false);
    assert.equal(isLiveCache({ signals: Array.from({ length: 100 }, (_, i) => one(i)) }), true);
    assert.equal(isLiveCache({ signals: Array.from({ length: 120 }, () => null) }), false);
    assert.equal(isLiveCache({ signals: Array.from({ length: 100 }, () => one(1)) }), false);
  });

  it('parse/serialize keep lang and drop default board keys', () => {
    const st = parseBoardQuery('?lang=en&sector=all&sort=confluence&q=');
    assert.equal(st.lang, 'en');
    const qs = serializeBoardQuery({
      sector: 'majors', risk: 'risk-low', sort: 'time', q: 'SOL', sig: ''
    }, '?lang=en');
    const again = parseBoardQuery('?' + qs);
    assert.equal(again.sector, 'majors');
    assert.equal(again.risk, 'risk-low');
    assert.equal(again.sort, 'time');
    assert.equal(again.q, 'SOL');
    assert.match(qs, /lang=en/);
    assert.equal(qs.includes('sig='), false);
  });
});

describe('step24 / xss + i18n contracts', () => {
  it('escapeHtml still wins on a poisoned pair; copy text stays plaintext', () => {
    const evil = '<img src=x onerror=alert(1)>';
    assert.equal(escapeHtml(evil).includes('<img'), false);
    const txt = copyLevelsText({
      pair: evil, entryPrice: 1, stopLoss: 0.5, targets: [1.5, 2], riskRewardRatio: '1:2.0'
    });
    assert.equal(txt.includes('<img'), true);
    assert.equal(txt.includes('onerror'), true);
  });

  it('dossier interpolates socialChange through escapeHtml', () => {
    assert.match(appJs, /escapeHtml\(sentChg\)/);
    assert.equal(/\$\{sig\.sentiment\.socialChange\}/.test(appJs), false);
  });

  it('share-card levels use fmtP, not locale rounding', () => {
    assert.match(appJs, /quotedPrice\(sig, sig\.entryPrice\)/);
    assert.match(appJs, /quotedPrice\(sig, sig\.stopLoss\)/);
    assert.equal(/Number\(sig\.entryPrice\)\.toLocaleString\(\)/.test(appJs), false);
  });

  it('sort toast is not the theme toast; live badge is language-neutral', () => {
    assert.match(appJs, /tx\('sortToast'/);
    assert.equal(appJs.includes("'Live-Quelle:"), false);
    assert.equal(appJs.includes("'Build-Daten"), false);
  });

  it('I18N / EXTRA_I18N / STATIC_I18N key sets match across 5 languages', () => {
    const packs = [
      langChunks(appJs, 'const I18N = {'),
      langChunks(appJs, 'const EXTRA_I18N = {'),
      langChunks(appJs, 'const STATIC_I18N = {')
    ];
    for (const chunks of packs) {
      const sets = Object.fromEntries(LANGS.map((l) => [l, new Set(i18nKeys(chunks[l]))]));
      const union = new Set();
      LANGS.forEach((l) => sets[l].forEach((k) => union.add(k)));
      for (const lang of LANGS) {
        const missing = [...union].filter((k) => !sets[lang].has(k));
        assert.deepEqual(missing, [], lang + ' missing ' + missing.join(','));
      }
    }
  });

  it('pagination remnants are gone from markup and i18n packs', () => {
    assert.equal(/paginTpl|btnPrevPage|btnNextPage/.test(appJs), false);
  });
});

writeReport('step24-runtime.json', {
  seed: seed.length,
  gated: gated.length,
  sectors: counts,
  riskLow: filterSignals(seed, { filter: 'risk-low' }).map((s) => s.id),
  utcSample: fmtUtcTime(1790035199999)
});
