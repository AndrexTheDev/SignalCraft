import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, writeReport
} from './helpers/html.mjs';
import { r5 } from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const mainJs = inlineScripts(app).find((s) => s.includes('SEED_SIGNALS')) || appJs;

describe('step28 / storage helpers', () => {
  it('terminal exposes lsGet / lsSet / lsDel', () => {
    assert.match(appJs, /function lsGet\s*\(/);
    assert.match(appJs, /function lsSet\s*\(/);
    assert.match(appJs, /function lsDel\s*\(/);
    assert.match(appJs, /try \{ return localStorage\.getItem\(k\); \}/);
    assert.match(appJs, /try \{ localStorage\.setItem\(k, v\); \}/);
    assert.match(appJs, /try \{ localStorage\.removeItem\(k\); \}/);
  });

  it('leads, live cache, lang, theme and unlock go through the helpers', () => {
    assert.match(mainJs, /lsGet\('signalcraft_leads'\)/);
    assert.match(mainJs, /lsSet\('signalcraft_leads'/);
    assert.match(mainJs, /lsDel\('signalcraft_leads'\)/);
    assert.match(mainJs, /lsGet\(this\.CACHE_KEY\)/);
    assert.match(mainJs, /lsSet\(this\.CACHE_KEY/);
    assert.match(mainJs, /lsGet\('signalcraft_lang'\)/);
    assert.match(mainJs, /lsSet\('signalcraft_lang'/);
    assert.match(mainJs, /lsGet\('unlocked_themes'\)/);
    assert.match(mainJs, /lsSet\('unlocked_themes'/);
    assert.match(mainJs, /lsSet\('signalcraft_theme'/);
    assert.equal(/localStorage\.getItem\('signalcraft_leads'\)/.test(mainJs), false);
    assert.equal(/localStorage\.setItem\('signalcraft_leads'/.test(mainJs), false);
    assert.equal(/localStorage\.removeItem\('signalcraft_leads'\)/.test(mainJs), false);
    assert.equal(/localStorage\.getItem\('signalcraft_lang'\)/.test(mainJs), false);
    assert.equal(/localStorage\.setItem\('signalcraft_lang'/.test(mainJs), false);
    assert.equal(/localStorage\.getItem\('unlocked_themes'\)/.test(mainJs), false);
    assert.equal(/localStorage\.setItem\('unlocked_themes'/.test(mainJs), false);
    assert.equal(/localStorage\.getItem\(this\.CACHE_KEY\)/.test(mainJs), false);
  });

  it('landing language persist uses guarded helpers', () => {
    assert.match(landJs, /function lsGet\s*\(/);
    assert.match(landJs, /function lsSet\s*\(/);
    assert.match(landJs, /lsGet\('signalcraft_lang'\)/);
    assert.match(landJs, /lsSet\('signalcraft_lang'/);
    assert.equal(/localStorage\.getItem\('signalcraft_lang'\)/.test(landJs), false);
  });
});

describe('step28 / clipboard + pair + r5', () => {
  it('copyText swallows a missing clipboard; unlock and copy-levels use it', () => {
    assert.match(appJs, /function copyText\s*\(/);
    assert.match(appJs, /copyText\(txt\)/);
    assert.match(appJs, /copyText\('https:\/\/signalcraft\.click\/app\.html'\)/);
    assert.equal(/navigator\.clipboard\.writeText\('https:\/\/signalcraft\.click/.test(appJs), false);
  });

  it('dex wire and share filename never call pair.replace', () => {
    assert.equal(/sg\.pair\.replace\(' \/ USD'/.test(appJs), false);
    assert.equal(/sig\.pair\.replace\('\/'/.test(appJs), false);
    assert.match(appJs, /pairSymbol\(sg\.pair\)/);
    assert.match(appJs, /pairSymbol\(sig && sig\.pair\)/);
  });

  it('r5 never throws on missing / NaN and terminal matches the helper', () => {
    assert.equal(r5(undefined), 0);
    assert.equal(r5(null), 0);
    assert.equal(r5(NaN), 0);
    assert.equal(r5('nope'), 0);
    assert.equal(r5(123.456789), 123.46);
    assert.equal(r5(86097), 86097);
    assert.match(appJs, /Number\.isFinite\(n\) \? \+n\.toPrecision\(5\) : 0/);
  });

  it('live toSignal guards missing metrics; FNG ignores a non-finite index', () => {
    assert.match(appJs, /const m = \(b && b\.metrics\) \|\| \{\}/);
    assert.match(appJs, /if \(!Number\.isFinite\(n\)\) return;/);
    assert.match(appJs, /this\.fngValue = n;/);
  });
});

writeReport('step28-storage.json', {
  r5Missing: r5(undefined),
  r5NaN: r5(NaN),
  r5Sample: r5(123.456789),
  hasLsDel: /function lsDel\s*\(/.test(appJs),
  hasCopyText: /function copyText\s*\(/.test(appJs)
});
