import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Drift-guard: the factor-model mirror in tests/helpers/core-logic.mjs must stay
 * functionally identical to the implementation in app.html — otherwise the unit
 * tests could go green while the shipped engine behaves differently.
 * Normalization: comments stripped, single-arg arrow parens removed, whitespace removed.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function normalize(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\(([A-Za-z_$][\w$]*)\)\s*=>/g, '$1 =>')
    .replace(/\s+/g, '');
}

function grabFunction(text, name) {
  const i = text.indexOf('function ' + name + '(');
  assert.notEqual(i, -1, `function ${name} not found`);
  const j = text.indexOf('{', i);
  let depth = 0;
  for (let k = j; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}') {
      depth--;
      if (depth === 0) return text.slice(i, k + 1);
    }
  }
  assert.fail(`function ${name} is unbalanced`);
}

const appHtml = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
const appJs = appHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
const mirror = fs.readFileSync(path.join(ROOT, 'tests/helpers/core-logic.mjs'), 'utf8');

const FACTOR_FNS = ['parseMarketNumber', 'fmtP', 'priceChange', 'factorWindowComputable', 'emaSeries', 'emaLast', 'adxWilder', 'returnVol', 'riskAdjMom', 'obvTrend', 'bbWidthPercentile', 'factorScores', 'roundTargetUp', 'validLongPlan', 'isLiveCache', 'takeProfitLevels', 'quoteUnit', 'quotedPrice', 'copyLevelsText'];

describe('step31 / mirror sync — factor engine v2', () => {
  for (const name of FACTOR_FNS) {
    it(`tests mirror of ${name} is identical to app.html`, () => {
      const a = normalize(grabFunction(appJs, name));
      const b = normalize(grabFunction(mirror, name).replace(/export\s+/, ''));
      assert.equal(b, a, `${name}: mirror drifted from app.html`);
    });
  }

  it('gate v2 in app.html uses the same thresholds as the documented model (ADX 15, riskAdj > 0)', () => {
    assert.match(appJs, /adx < 15/);
    assert.match(appJs, /!\(ra > 0\)/);
  });

  it('cache key is signalcraft_live_v2 (v1 users get a clean refetch)', () => {
    assert.match(appJs, /CACHE_KEY: 'signalcraft_live_v2'/);
  });
});
