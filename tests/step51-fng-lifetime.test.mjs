import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const marker = 'function fetchVenueJson(';
const start = html.indexOf(marker);
const helperSource = html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker);
const engineSource = extractBalanced(html, 'const SentimentEngine = {');
function make(fetch) {
  const helper = Function('fetch', 'return ' + helperSource)(fetch);
  const freshMarker = 'function fngObservationFresh(';
  const freshStart = html.indexOf(freshMarker);
  const fresh = Function('return ' + html.slice(freshStart, html.indexOf('{', freshStart)) + extractBalanced(html, freshMarker))();
  const engine = Function('fetchVenueJson', 'fngObservationFresh', 'return (' + engineSource + ')')((url, options) => helper(url, options, 25), fresh);
  engine.scheduleFngExpiry = () => {};
  const history = [];
  engine.updateGlobalBadge = () => history.push([engine.fngValue, engine.fngClassification]);
  return { engine, history };
}
const never = () => new Promise(() => {});
const data = (value, classification = 'Greed') => ({ data: [{ value, value_classification: classification, timestamp: String(Math.floor(Date.now() / 1000)) }] });
const response = body => ({ ok: true, json: () => Promise.resolve(body) });
describe('step51 / independent Fear & Greed request lifetime', () => {
  it('bounds connection and body even when a fetch ignores abort', async () => {
    for (const stalled of ['connection', 'body']) {
      let signal;
      const { engine } = make((url, options) => { signal = options.signal; return stalled === 'connection' ? never() : Promise.resolve({ ok: true, json: never }); });
      engine.fngValue = 33; engine.fngClassification = 'Fear';
      await engine.fetchLiveFearAndGreed();
      assert.equal(signal.aborted, true);
      assert.equal(engine.fngValue, null);
      assert.equal(engine.fngClassification, null);
      assert.equal(engine._fngController, null);
    }
  });
  it('supersedes a stalled old response and does not let its late success overwrite the newer result', async () => {
    let resolveOld; let firstSignal; let calls = 0;
    const { engine, history } = make((url, options) => {
      calls++;
      if (calls === 1) { firstSignal = options.signal; return Promise.resolve({ ok: true, json: () => new Promise(resolve => { resolveOld = resolve; }) }); }
      return Promise.resolve(response(data('71')));
    });
    const old = engine.fetchLiveFearAndGreed();
    await new Promise(resolve => setImmediate(resolve));
    const current = engine.fetchLiveFearAndGreed();
    await Promise.all([old, current]);
    assert.equal(firstSignal.aborted, true);
    assert.equal(engine.fngValue, 71);
    resolveOld(data('12', 'Fear'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(engine.fngValue, 71);
    assert.equal(engine.fngClassification, 'Greed');
    assert.deepEqual(history.at(-1), [71, 'Greed']);
  });
  it('ignores a superseded error and rejects invalid values or HTTP errors', async () => {
    let rejectOld; let calls = 0;
    const { engine } = make(() => {
      if (++calls === 1) return new Promise((resolve, reject) => { rejectOld = reject; });
      return Promise.resolve(response(data(65, 'unexpected')));
    });
    const old = engine.fetchLiveFearAndGreed();
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all([old, engine.fetchLiveFearAndGreed()]);
    rejectOld(new Error('late failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(engine.fngValue, 65);
    assert.equal(engine.fngClassification, null);
    for (const result of [response(data('55oops')), response(data(101)), { ok: false }]) {
      const bad = make(() => Promise.resolve(result)).engine;
      await bad.fetchLiveFearAndGreed();
      assert.equal(bad.fngValue, null);
    }
  });
});
