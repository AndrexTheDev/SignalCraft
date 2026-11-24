import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function factory(name, ...params) {
  const marker = 'function ' + name + '(', start = html.indexOf(marker);
  return Function(...params, 'return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker));
}
function engine(fetch) {
  const helper = factory('fetchVenueJson', 'fetch')(fetch);
  const parser = factory('parse24hTickers', 'parseMarketNumber')(factory('parseMarketNumber')());
  const fresh = factory('snapshotIsFresh', 'snapshotExpiry')(factory('snapshotExpiry')());
  const e = Function('fetchVenueJson', 'parse24hTickers', 'snapshotIsFresh', 'MARKET_UNIVERSE', 'return (' + extractBalanced(html, 'const ME = {') + ')')(
    (url, options) => helper(url, options, 250), parser, fresh, [['BTC', 'majors']]
  );
  e.TICKER_GRACE_MS = 30;
  return e;
}
const ticker = symbol => [{ symbol: symbol + 'USDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: Date.now() }];
const response = rows => ({ ok: true, json: async () => rows });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
describe('step89 / bounded ticker source grace period', () => {
  for (const stalled of ['global', 'us']) it(`uses the responsive source and aborts a stalled ${stalled} source`, async () => {
    let late, slowSignal; const urls = [];
    const e = engine((url, options) => {
      urls.push(url); const us = url.includes('binance.us');
      if ((stalled === 'us') === us) { slowSignal = options.signal; return new Promise(resolve => { late = resolve; }); }
      return Promise.resolve(response(ticker('BTC')));
    });
    const result = await e.tickers24h();
    assert.deepEqual(result.skipped, [stalled === 'us' ? 'Binance.US' : 'Binance']);
    assert.ok(result[stalled === 'us' ? 'binance' : 'binance-us'].BTCUSDT);
    assert.equal(result[stalled === 'us' ? 'binance-us' : 'binance'].BTCUSDT, undefined);
    assert.equal(slowSignal.aborted, true);
    late(response(ticker('BTC'))); await wait(10);
    assert.equal(urls.length, 2); assert.equal(result[stalled === 'us' ? 'binance-us' : 'binance'].BTCUSDT, undefined);
  });
  it('retains both sources when the second arrives within the grace period', async () => {
    let release; const e = engine(url => url.includes('binance.us') ? new Promise(resolve => { release = resolve; }) : Promise.resolve(response(ticker('BTC'))));
    e.TICKER_GRACE_MS = 100; const pending = e.tickers24h(); await wait(10); release(response(ticker('BTC')));
    const result = await pending; assert.ok(result.binance.BTCUSDT); assert.ok(result['binance-us'].BTCUSDT); assert.deepEqual(result.skipped, []);
  });
  for (const unusable of [ticker('OTHER'), { unexpected: true }]) it('does not start grace for an unrelated or malformed US response', async () => {
    let release; const e = engine(url => url.includes('binance.us') ? Promise.resolve(response(unusable)) : new Promise(resolve => { release = resolve; }));
    const pending = e.tickers24h(); await wait(50); release(response(ticker('BTC')));
    const result = await pending; assert.ok(result.binance.BTCUSDT); assert.deepEqual(result.skipped, []);
  });
  it('aborts both sources on cancellation and ignores late data', async () => {
    const signals = [], late = [], e = engine((url, options) => { signals.push(options.signal); return new Promise(resolve => late.push(resolve)); });
    const controller = new AbortController(), pending = e.tickers24h(controller.signal);
    await wait(10); controller.abort(); const result = await pending;
    assert.ok(signals.every(s => s.aborted)); assert.equal(signals.length, 2);
    late.forEach(resolve => resolve(response(ticker('BTC')))); await wait(10);
    assert.equal(Object.keys(result.binance).length, 0); assert.equal(Object.keys(result['binance-us']).length, 0);
    assert.deepEqual(result.skipped, []);
  });
  it('cancels an active grace period without treating a parent abort as a slow source', async () => {
    const signals = []; const e = engine((url, options) => {
      if (url.includes('binance.us')) signals.push(options.signal);
      return url.includes('binance.us') ? new Promise(() => {}) : Promise.resolve(response(ticker('BTC')));
    });
    e.TICKER_GRACE_MS = 100; const controller = new AbortController();
    const pending = e.tickers24h(controller.signal); await wait(10); controller.abort();
    const result = await pending; assert.deepEqual(result.skipped, []); assert.ok(signals.every(s => s.aborted));
  });
  it('starts no fetch when already cancelled', async () => {
    let calls = 0; const e = engine(() => { calls++; return Promise.resolve(response([])); });
    const controller = new AbortController(); controller.abort(); await e.tickers24h(controller.signal);
    assert.equal(calls, 0);
  });
});
