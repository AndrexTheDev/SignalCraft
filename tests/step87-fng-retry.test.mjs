import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const source = extractBalanced(html, 'const SentimentEngine = {');
function engine() {
  return Function('return (' + source + ')')();
}
describe('step87 / independent index automatic refresh', () => {
  it('retries failed or old index requests no more often than the interval', () => {
    const e = engine(); let calls = 0;
    e.fetchLiveFearAndGreed = () => { calls++; };
    e._fngLastAttempt = 1000;
    e.refreshIfDue(1000 + e._fngRefreshInterval - 1); assert.equal(calls, 0);
    e.refreshIfDue(1000 + e._fngRefreshInterval); assert.equal(calls, 1);
    e._fngController = {}; e.refreshIfDue(1000 + 2 * e._fngRefreshInterval); assert.equal(calls, 1);
    e._fngController = null; e.refreshIfDue(999); assert.equal(calls, 2);
  });
  it('honors an online hint only for a missing index after the retry cooldown', () => {
    const e = engine(); let calls = 0; e.fetchLiveFearAndGreed = () => { calls++; };
    e._fngLastAttempt = 1000; e._fngOnlinePending = true;
    e.refreshIfDue(15999); assert.equal(calls, 0);
    e.refreshIfDue(16000); assert.equal(calls, 1);
    e.fngValue = 42; e.refreshIfDue(17000); assert.equal(calls, 1);
    e.fngValue = null; e._fngController = {}; e.refreshIfDue(18000); assert.equal(calls, 1);
  });
  it('records each real attempt before dispatching and leaves failure unavailable', async () => {
    const e = Function('fetchVenueJson', 'return (' + source + ')')(async () => { throw new Error('offline'); });
    e.updateGlobalBadge = () => {};
    const before = Date.now(); await e.fetchLiveFearAndGreed();
    assert.ok(e._fngLastAttempt >= before); assert.equal(e.fngValue, null); assert.equal(e._fngController, null);
  });
});
