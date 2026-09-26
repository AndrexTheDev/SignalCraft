import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AD_HOST, AD_KEYS, AD_POPUNDER_GAP_MS, AD_POPUNDER_DAY_MAX, AD_STICKY_DISMISS_MS,
  popunderCapOk, stickyIsDismissed, shouldRefillAdSlot, shouldHideFailedAd, isPinnedAdUrl
} from './helpers/core-logic.mjs';
import { read, inlineScripts } from './helpers/html.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');

describe('step11 / popunder cap', () => {
  const now = 1_000_000_000_000;
  const today = 'Sat Sep 26 2026';

  it('allows the first hit of the day', () => {
    assert.equal(popunderCapOk(now, 0, 0, 'Fri Sep 25 2026', today), true);
  });

  it('blocks inside the 2h gap', () => {
    assert.equal(popunderCapOk(now, now - AD_POPUNDER_GAP_MS + 1000, 1, today, today), false);
  });

  it('allows after the gap until DAY_MAX', () => {
    assert.equal(popunderCapOk(now, now - AD_POPUNDER_GAP_MS, 3, today, today), true);
    assert.equal(popunderCapOk(now, now - AD_POPUNDER_GAP_MS, AD_POPUNDER_DAY_MAX, today, today), false);
  });

  it('resets the day counter when the date stamp changes', () => {
    assert.equal(popunderCapOk(now, now - AD_POPUNDER_GAP_MS, 9, 'Fri Sep 25 2026', today), true);
  });
});

describe('step11 / sticky dismiss + heal', () => {
  it('treats a fresh dismiss as still dismissed for 30 minutes', () => {
    const now = 5_000_000;
    assert.equal(stickyIsDismissed(now, String(now - 1000)), true);
    assert.equal(stickyIsDismissed(now, String(now - AD_STICKY_DISMISS_MS - 1)), false);
    assert.equal(stickyIsDismissed(now, ''), false);
  });

  it('refills empty visible slots in err/ok, never filled or hidden ones', () => {
    assert.equal(shouldRefillAdSlot('err', false, 'flex'), true);
    assert.equal(shouldRefillAdSlot('ok', false, 'flex'), true);
    assert.equal(shouldRefillAdSlot('pending', false, 'flex'), false);
    assert.equal(shouldRefillAdSlot('err', true, 'flex'), false);
    assert.equal(shouldRefillAdSlot('err', false, 'none'), false);
  });

  it('hides persistent failures without an iframe', () => {
    assert.equal(shouldHideFailedAd('err', false), true);
    assert.equal(shouldHideFailedAd('err', true), false);
    assert.equal(shouldHideFailedAd('ok', false), false);
  });
});

describe('step11 / url pin + source sync', () => {
  it('accepts only https URLs on the pinned ad host', () => {
    assert.equal(isPinnedAdUrl('https://' + AD_HOST + '/' + AD_KEYS.side + '/invoke.js'), true);
    assert.equal(isPinnedAdUrl('http://' + AD_HOST + '/x.js'), false);
    assert.equal(isPinnedAdUrl('https://evil.example/' + AD_KEYS.side), false);
  });

  it('terminal source keeps the same cap constants and keys', () => {
    assert.match(appJs, new RegExp('DAY_MAX = ' + AD_POPUNDER_DAY_MAX));
    assert.match(app, new RegExp('GAP = 2 \\* 3600e3'));
    for (const key of Object.values(AD_KEYS)) assert.match(app, new RegExp(key));
    for (const key of Object.values(AD_KEYS)) assert.match(landing, new RegExp(key));
    assert.match(appJs, /window\.forceAdBlock = forceAdBlock/);
  });
});
