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
  const expiry = functionFactory('snapshotExpiry')();
  const fresh = functionFactory('snapshotIsFresh', 'snapshotExpiry')(expiry);
  return Function('ME_STAMP', 'fetchVenueJson', 'validModelCandles', 'candlesAreCurrent', 'parse24hTickers', 'MARKET_UNIVERSE', 'snapshotIsFresh', 'const setMarketQuotes = () => {}; return (' + source + ')')(
    0, bounded, valid, current, parser, [['BTC', 'majors']], fresh
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
  it('tries each endpoint once even if another concurrent worker changes the preference', async () => {
    const urls = []; let rejectFirst;
    const me = Function('ME_STAMP', 'fetchVenueJson', 'const setMarketQuotes = () => {}; return (' + extractBalanced(html, 'const ME = {') + ')')(
      0, url => {
        urls.push(url);
        if (urls.length === 1) return new Promise((resolve, reject) => { rejectFirst = reject; });
        return Promise.resolve(['alternate']);
      }
    );
    const pending = me.get('/test');
    me.eps = 1; // A separate successful worker changed the shared preference.
    rejectFirst(new Error('first endpoint failed'));
    assert.deepEqual(await pending, ['alternate']);
    assert.match(urls[0], /binance\.vision/);
    assert.match(urls[1], /api\.binance\.com/);
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
  it('retries an alternate endpoint after a malformed successful ticker response', async () => {
    const urls = [], now = Date.now();
    const me = engine(url => {
      urls.push(url);
      const data = url.includes('binance.vision') ? { malformed: true } : url.includes('binance.us') ? [] : [{ symbol:'BTCUSDT', quoteVolume:'20000000', priceChangePercent:'1', closeTime:now }];
      return Promise.resolve({ok:true,json:async () => data});
    });
    const result = await me.tickers24h();
    assert.equal(result.binance.BTCUSDT.volume, 20000000);
    assert.ok(urls.some(url => url.includes('api.binance.com')));
  });
  it('retries when a valid response contains no ticker for the configured universe', async () => {
    const urls = [], now = Date.now();
    const me = engine(url => {
      urls.push(url);
      const symbol = url.includes('binance.vision') ? 'OTHERUSDT' : 'BTCUSDT';
      const rows = url.includes('binance.us') ? [] : [{ symbol, quoteVolume:'20000000', priceChangePercent:'1', closeTime:now }];
      return Promise.resolve({ ok: true, json: async () => rows });
    });
    const tickers = await me.tickers24h();
    assert.equal(tickers.binance.BTCUSDT.volume, 20000000);
    assert.ok(urls.some(url => url.includes('api.binance.com')));
  });
  it('retries a global response whose universe tickers cannot anchor a live snapshot', async () => {
    const urls = [], now = Date.now();
    const me = engine(url => {
      urls.push(url);
      const age = url.includes('binance.vision') ? 120000 : 0;
      const rows = url.includes('binance.us') ? [] : [{ symbol:'BTCUSDT', quoteVolume:'20000000', priceChangePercent:'1', closeTime:now - age }];
      return Promise.resolve({ok:true,json:async () => rows});
    });
    const tickers = await me.tickers24h();
    assert.ok(urls.some(url => url.includes('api.binance.com')));
    assert.equal(tickers.binance.BTCUSDT.time, now);
  });
  it('filters each ticker at the snapshot age and UTC-day boundary', () => {
    const me = engine(() => Promise.reject(new Error('unused')));
    const now = Date.UTC(2026, 3, 5, 12);
    const row = (symbol, time) => ({symbol, quoteVolume:'10', priceChangePercent:'1', closeTime:time});
    const tickers = me.usableTickers([row('BTCUSDT', now - 89999), row('ETHUSDT', now - 90000), row('SOLUSDT', now + 60000)], now);
    assert.ok(tickers.BTCUSDT); assert.equal(tickers.ETHUSDT, undefined); assert.ok(tickers.SOLUSDT);
    const midnight = Date.UTC(2026, 3, 6);
    const across = me.usableTickers([row('BTCUSDT', midnight - 1), row('ETHUSDT', midnight)], midnight);
    assert.equal(across.BTCUSDT, undefined); assert.ok(across.ETHUSDT);
  });
  it('filters stale US rows independently even when a different ticker is fresh', async () => {
    const now = Date.now();
    const me = engine(url => Promise.resolve({ok:true,json:async () => url.includes('binance.us') ? [
      {symbol:'BTCUSDT',quoteVolume:'10',priceChangePercent:'1',closeTime:now - 120000},
      {symbol:'ETHUSDT',quoteVolume:'10',priceChangePercent:'1',closeTime:now}
    ] : []}));
    const tickers = await me.tickers24h();
    assert.equal(tickers['binance-us'].BTCUSDT, undefined); assert.ok(tickers['binance-us'].ETHUSDT);
  });
  it('retries the alternate global endpoint for invalid candles or an invalid candidate', async () => {
    for (const mode of ['candles','candidate']) {
      const urls = [];
      const me = engine(url => {
        urls.push(url);
        const rows = url.includes('binance.vision') ? ['BAD'] : ['GOOD'];
        return Promise.resolve({ok:true,json:async () => rows});
      }, rows => mode !== 'candles' || rows[0] === 'GOOD');
      const result = await me.kGet('BTC', {binance:{BTCUSDT:{}},'binance-us':{}}, undefined, rows => {
        if (mode === 'candidate' && rows[0] === 'BAD') throw new Error('bad candidate');
        return {value:rows[0]};
      });
      assert.equal(result.src,'binance'); assert.equal(result.built.value,'GOOD');
      assert.match(urls[0],/binance\.vision/); assert.match(urls[1],/api\.binance\.com/);
    }
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
    const me = Function('ME_STAMP', 'document', 'I18N', 'currentLang', 'SEED_SIGNALS', 'signalsData', 'pairSymbol', 'lsGet', 'lsDel', 'const setMarketQuotes = () => {}; return (' + source + ')')(
      0, { getElementById: () => button }, { en: {} }, 'en', [], [], s => s, () => null, () => {}
    );
    me.tickers24h = async () => { throw new Error('network'); };
    me.apply = () => { throw new Error('render failure'); };
    await assert.rejects(me.refresh(true), /render failure/);
    assert.equal(me.busy, false); assert.equal(button.disabled, false); assert.equal(button.busy, false);
  });

});
