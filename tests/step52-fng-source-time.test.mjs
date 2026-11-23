import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function load(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  return Function('return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker))();
}
const isFresh = load('fngObservationFresh');
const source = extractBalanced(html, 'const SentimentEngine = {');
function engineWith(data) {
  const engine = Function('fetchVenueJson', 'fngObservationFresh', 'return (' + source + ')')(async () => data, isFresh);
  engine.updateGlobalBadge = () => {};
  engine.scheduleFngExpiry = () => {};
  return engine;
}
const now = Date.now();
const row = timestamp => ({ data: [{ value: '63', timestamp, value_classification: 'Greed' }] });
describe('step52 / source timestamp and conservative display age', () => {
  it('checks the 48-hour boundary, small future skew and backward device clocks', () => {
    assert.equal(isFresh(now - 48 * 3600000 + 1, now, now), true);
    assert.equal(isFresh(now - 48 * 3600000, now, now), false);
    assert.equal(isFresh(now + 60000, now, now), true);
    assert.equal(isFresh(now + 60001, now, now), false);
    assert.equal(isFresh(now - 10000, now, now - 1), false);
    for (const stamp of [null, NaN, Infinity, 0, -1, 1.2]) assert.equal(isFresh(stamp, now, now), false);
  });
  it('rejects absent, invalid, old or implausibly future API timestamps', async () => {
    for (const timestamp of [undefined, null, '', '123oops', -1, '1.5', 1.5, 0, String(Math.floor(now / 1000) - 172801), String(Math.ceil(now / 1000) + 61), String(now)]) {
      const engine = engineWith(row(timestamp));
      await engine.fetchLiveFearAndGreed();
      assert.equal(engine.fngValue, null, String(timestamp));
      assert.equal(engine.fngTimestamp, null, String(timestamp));
    }
  });
  it('accepts and retains a valid source time in seconds without replacing it by fetch time', async () => {
    const seconds = Math.floor(now / 1000) - 86400;
    const engine = engineWith(row(String(seconds)));
    await engine.fetchLiveFearAndGreed();
    assert.equal(engine.fngValue, 63);
    assert.equal(engine.fngTimestamp, seconds * 1000);
    assert.equal(engine.fngClassification, 'Greed');
  });
  it('clears previously accepted data on a backwards clock or expiry', async () => {
    const engine = engineWith(row(Math.floor(now / 1000)));
    await engine.fetchLiveFearAndGreed();
    engine._fngReceivedAt = Date.now() + 1000;
    assert.equal(engine.ensureFngFresh(), false);
    assert.equal(engine.fngValue, null);
    assert.equal(engine.fngTimestamp, null);
  });
});
