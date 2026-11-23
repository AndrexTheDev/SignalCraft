import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function functionFactory(name, ...params) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  assert.ok(start >= 0, name);
  return Function(...params, 'return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker));
}
function engine(fetcher, valid = () => true, current = () => true) {
  const helper = functionFactory('fetchVenueJson', 'fetch')(fetcher);
  const bounded = (url, options) => helper(url, options, 20);
  const source = extractBalanced(html, 'const ME = {');
  const parser = functionFactory('parse24hTickers', 'parseMarketNumber')(functionFactory('parseMarketNumber')());
  return Function('ME_STAMP', 'fetchVenueJson', 'validModelCandles', 'candlesAreCurrent', 'parse24hTickers', 'return (' + source + ')')(
    0, bounded, valid, current, parser
  );
}
const stall = () => new Promise(() => {});

describe('step42 / bounded market refresh requests', () => {
  it('retries the next endpoint if the first response body stalls even after headers', async () => {
    const urls = []; let firstSignal;
    const me = engine((url, options) => {
      urls.push(url);
      if (url.includes('binance.vision')) { firstSignal = options.signal; return Promise.resolve({ ok: true, json: stall }); }
      return Promise.resolve({ ok: true, json: async () => ['fallback'] });
    });
    assert.deepEqual(await me.get('/test'), ['fallback']);
    assert.equal(firstSignal.aborted, true);
    assert.equal(urls.length, 2);
    assert.equal(me.eps, 1);
  });
  it('times out when fetch ignores abort, or JSON parsing fails, and does not pin the preferred endpoint', async () => {
    let count = 0;
    const me = engine(() => { count++; return count === 1 ? stall() : Promise.resolve({ ok: true, json: () => Promise.reject(new Error('bad json')) }); });
    await assert.rejects(me.get('/test'), /market-unreachable/);
    assert.equal(count, 2); assert.equal(me.eps, 0);
    const sync = engine(() => { throw new Error('synchronous fetch failure'); });
    await assert.rejects(sync.get('/test'), /market-unreachable/);
  });
  it('bounds Binance US ticker and keeps a valid global ticker when the US response hangs', async () => {
    const now = Date.now();
    const me = engine(url => url.includes('binance.us') ? Promise.resolve({ ok: true, json: stall }) : Promise.resolve({ ok: true, json: async () => [{ symbol: 'BTCUSDT', quoteVolume: '20000000', priceChangePercent: '1', closeTime: now }] }));
    const result = await me.tickers24h();
    assert.equal(result.binance.BTCUSDT.volume, 20000000);
    assert.equal(result['binance-us'].BTCUSDT, undefined);
  });
  it('does not build a candidate or try the alternate source after cancellation', async () => {
    let release, builds = 0, usCalls = 0;
    const me = engine(() => { usCalls++; return Promise.resolve({ ok: true, json: async () => [] }); });
    me.get = () => new Promise(resolve => { release = resolve; });
    const parent = new AbortController();
    const request = me.kGet('BTC', { binance: { BTCUSDT: {} }, 'binance-us': { BTCUSDT: {} } }, parent.signal, () => { builds++; });
    parent.abort(); release(['late']);
    await assert.rejects(request, /market-cancelled/);
    assert.equal(builds, 0); assert.equal(usCalls, 0);
  });
  it('bounds Binance US candle response bodies and rejects them rather than fabricating a fallback', async () => {
    let signal;
    const me = engine((url, options) => { signal = options.signal; return Promise.resolve({ ok: true, json: stall }); });
    await assert.rejects(me.kGet('BTC', { binance: {}, 'binance-us': { BTCUSDT: {} } }), /no-source/);
    assert.equal(signal.aborted, true);
  });  it('releases the refresh button even if the fallback rendering itself throws', async () => {
    const source = extractBalanced(html, 'const ME = {');
    const button = { disabled: false, busy: false, setAttribute() { this.busy = true; }, removeAttribute() { this.busy = false; } };
    const me = Function('ME_STAMP', 'document', 'I18N', 'currentLang', 'SEED_SIGNALS', 'signalsData', 'pairSymbol', 'lsGet', 'lsDel', 'return (' + source + ')')(
      0, { getElementById: () => button }, { en: {} }, 'en', [], [], s => s, () => null, () => {}
    );
    me.tickers24h = async () => { throw new Error('network'); };
    me.apply = () => { throw new Error('render failure'); };
    await assert.rejects(me.refresh(true), /render failure/);
    assert.equal(me.busy, false); assert.equal(button.disabled, false); assert.equal(button.busy, false);
  });

});
