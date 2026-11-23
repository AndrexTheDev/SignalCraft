import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
const html = read('app.html');
const names = Function('return ' + extractArray(html, 'const CEX_LIST ='))();
function getFunction(name, deps = []) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  return Function(...deps, 'return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker));
}
const isFresh = getFunction('venueDataIsFresh', ['VENUE_TTL'])(90000);
const parseMarketNumber = getFunction('parseMarketNumber')();
function harness(name, clock) {
  const pending = [], timers = [];
  class FakeDate extends Date { static now() { return clock.now; } }
  const fetcher = url => url.includes(name === 'CexEngine' ? 'binance.vision' : 'dexscreener')
    ? new Promise(resolve => pending.push(resolve)) : Promise.reject(new Error('offline'));
  const engine = Function('Date', 'fetchVenueJson', 'CEX_LIST', 'parseMarketNumber', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + extractBalanced(html, `const ${name} = {`) + ')')(
    FakeDate, fetcher, names, parseMarketNumber, 90000, (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, () => {}, () => {}, isFresh
  );
  const payload = name === 'CexEngine' ? [{ symbol: 'BTCUSDT', price: '100' }] : { pairs: [{ baseToken: { symbol: 'BTC' }, dexId: 'test', priceUsd: '1', liquidity: { usd: 100000 } }] };
  return { engine, pending, timers, payload };
}
describe('step47 / venue age and browser clock', () => {
  it('checks boundaries and rejects invalid or backward clock movement', () => {
    assert.equal(isFresh(1000, 90999), true); assert.equal(isFresh(1000, 91000), false);
    assert.equal(isFresh(1000, 999), false);
    for (const [start, now] of [[null, 3], [NaN, 3], [4, NaN], [Infinity, Infinity]]) assert.equal(isFresh(start, now), false);
  });
  for (const name of ['CexEngine', 'DexEngine']) {
    it(`${name}: counts request duration towards the age and discards overly delayed results`, async () => {
      const clock = { now: 1000000 }, h = harness(name, clock);
      let run = h.engine.fetchAll(['BTC']);
      clock.now += 80000; h.pending.shift()(h.payload); await run;
      assert.equal(h.engine.startedAt, 1000000); assert.equal(h.timers[0].ms, 10000);
      assert.equal(h.engine.expireIfStale(clock.now), false);
      clock.now += 10000; assert.equal(h.engine.expireIfStale(clock.now), true);
      assert.equal(h.engine.startedAt, null);
      if (name === 'CexEngine') assert.deepEqual(h.engine.data, {});
      else assert.deepEqual(h.engine.wire, []);
      run = h.engine.fetchAll(['BTC']);
      clock.now += 90000; h.pending.shift()(h.payload); await run;
      assert.equal(h.engine.startedAt, null); assert.equal(h.engine.busy, false); assert.equal(h.timers.length, 1);
    });
    it(`${name}: fails closed if the system clock moves backwards`, async () => {
      const clock = { now: 1000000 }, h = harness(name, clock);
      const run = h.engine.fetchAll(['BTC']); h.pending.shift()(h.payload); await run;
      clock.now--; assert.equal(h.engine.expireIfStale(clock.now), true);
      assert.equal(h.engine.startedAt, null);
    });
  }
});
