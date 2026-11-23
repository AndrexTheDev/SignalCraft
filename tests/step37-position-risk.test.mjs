import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, jsonLdBlocks } from './helpers/html.mjs';

const app = read('app.html');
const marker = 'function calculateSpotPosition(';
const start = app.indexOf(marker);
assert.ok(start >= 0);
const calculateSpotPosition = Function('return ' + app.slice(start, app.indexOf('{', start)) + extractBalanced(app, marker))();

describe('step37 / spot position risk', () => {
  it('sizes an unleveraged position from a planned risk budget', () => {
    const p = calculateSpotPosition(1000, 1, 100, 90, 120);
    assert.deepEqual(p, { units: 1, positionValue: 100, plannedLoss: 10, plannedGain: 20, capped: false });
    const p2 = calculateSpotPosition(1000, 2, 100, 90, 120);
    assert.equal(p2.units, 2);
    assert.equal(p2.plannedLoss, 20);
  });

  it('caps notional at available capital and reports the smaller actual planned stop loss', () => {
    const p = calculateSpotPosition(1000, 1, 100, 99.9, 101);
    assert.equal(p.capped, true);
    assert.equal(p.units, 10);
    assert.equal(p.positionValue, 1000);
    assert.ok(Math.abs(p.plannedLoss - 1) < 1e-9);
    assert.equal(p.plannedGain, 10);
    assert.ok(p.plannedLoss < 10);
  });

  it('does not turn invalid inputs or impossible trade plans into zero or negative positions', () => {
    for (const args of [
      [0, 1, 100, 90, 110], [-100, 1, 100, 90, 110], [NaN, 1, 100, 90, 110],
      [Infinity, 1, 100, 90, 110], [1000, 0, 100, 90, 110], [1000, 3, 100, 90, 110],
      [1000, 1, 0, 0, 110], [1000, 1, 100, 0, 110], [1000, 1, 100, 100, 110],
      [1000, 1, 100, 101, 110], [1000, 1, 100, 90, null], [1000, 1, 100, 90, 99],
      [Number.MAX_VALUE, 2, 1e-300, 5e-301, 2e-300]
    ]) assert.equal(calculateSpotPosition(...args), null, String(args));
  });

  it('publishes a risk warning in the FAQ structured data and does not promise a fixed max loss', () => {
    const faq = JSON.parse(jsonLdBlocks(app)[0])['@graph'].find(x => x['@type'] === 'FAQPage');
    const rr = faq.mainEntity.find(x => /Risk:Reward/.test(x.name));
    assert.match(rr.acceptedAnswer.text, /nicht garantiert/);
    assert.doesNotMatch(rr.acceptedAnswer.text, /40%|mathematisch profitabel/);
    assert.doesNotMatch(app, /posLoss: "(?:Max loss|Max\. Verlust|Pérdida máx\.|أقصى خسارة|最大亏损)"/);
  });
});
