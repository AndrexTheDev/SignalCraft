import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';

const app = read('app.html');
const cexNames = Function('return ' + extractArray(app, 'const CEX_LIST ='))();
function extractFunction(name, ...parameters) {
  const start = app.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  const signature = app.slice(start, app.indexOf('{', start));
  return Function(...parameters, 'return ' + signature + extractBalanced(app, 'function ' + name + '('));
}
function createEngine(name, fetcher, timers, onExpire) {
  const source = extractBalanced(app, 'const ' + name + ' = {');
  assert.ok(source, name);
  return Function('fetchVenueJson', 'CEX_LIST', 'parseMarketNumber', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + source + ')')(
    fetcher, cexNames, extractFunction('parseMarketNumber')(), 90000, timers.set, timers.clear, onExpire, (t, now) => Number.isFinite(t) && now >= t && now - t < 90000
  );
}
function fakeTimers() {
  const pending = new Map(); let next = 0;
  return {
    set(fn, delay) { assert.ok(delay > 0 && delay <= 90000); const id = ++next; pending.set(id, fn); return id; },
    clear(id) { pending.delete(id); },
    fire() { const jobs = [...pending.values()]; pending.clear(); jobs.forEach(fn => fn()); },
    count() { return pending.size; }
  };
}

describe('step35 / venue integrity', () => {
  it('bounds stalled network requests and response bodies, and rejects HTTP errors', async () => {
    let signal;
    const stallFetch = (url, options) => { signal = options.signal; return new Promise(() => {}); };
    const stalled = extractFunction('fetchVenueJson', 'fetch')(stallFetch);
    await assert.rejects(stalled('https://example.invalid', {}, 20), /venue-timeout/);
    assert.equal(signal.aborted, true);
    const stalledBody = extractFunction('fetchVenueJson', 'fetch')(() => Promise.resolve({ ok: true, json: () => new Promise(() => {}) }));
    await assert.rejects(stalledBody('https://example.invalid', {}, 20), /venue-timeout/);
    const failure = extractFunction('fetchVenueJson', 'fetch')(() => Promise.resolve({ ok: false }));
    await assert.rejects(failure('https://example.invalid', {}, 20), /venue-unavailable/);
  });

  it('rejects duplicate CEX quotes, clears failed refreshes and expires', async () => {
    let active = true, redraws = 0;
    const timers = fakeTimers();
    const fetcher = url => active && url.includes('/ticker/price') && url.includes('binance')
      ? Promise.resolve([{ symbol: 'BTCUSDT', price: '100' }, { symbol: 'BTCUSDT', price: '101' }, { symbol: 'ETHUSDT', price: 'Infinity' }])
      : Promise.reject(new Error('offline'));
    const cex = createEngine('CexEngine', fetcher, timers, () => redraws++);
    await cex.fetchAll(['BTC', 'ETH']);
    assert.equal(cex.online, 0);
    assert.equal(cex.data.BTC, undefined);
    assert.equal(cex.data.ETH, undefined);
    active = false;
    await cex.fetchAll(['BTC', 'ETH']);
    assert.equal(cex.online, 0);
    assert.deepEqual(cex.data, {});
    assert.equal(timers.count(), 1);
    active = true;
    await cex.fetchAll(['BTC']);
    timers.fire();
    assert.equal(cex.online, 0);
    assert.deepEqual(cex.data, {});
    assert.equal(redraws, 1);
    assert.equal(cex.busy, false);
  });

  it('never mixes USD prices with USDT radar quotes, even during a depeg', async () => {
    const urls = [], timers = fakeTimers();
    const fetcher = url => {
      urls.push(url);
      if (url.includes('binance.vision')) return Promise.resolve([{ symbol: 'BTCUSD', price: '200' }, { symbol: 'BTCUSDT', price: '100' }]);
      if (url.includes('okx.com')) return Promise.resolve({ data: [{ instId: 'BTC-USDT', last: '110' }, { instId: 'BTC-USD', last: '1000' }] });
      if (url.includes('kraken.com')) return Promise.resolve({ result: { XXBTZUSD: { c: ['1000'] }, XBTUSDT: { c: ['120'] } } });
      if (url.includes('coinbase.com')) return Promise.resolve({ data: { base: 'BTC', currency: 'USD', amount: '1000' } });
      return Promise.reject(new Error('offline'));
    };
    const cex = createEngine('CexEngine', fetcher, timers, () => {});
    await cex.fetchAll(['BTC']);
    assert.equal(cex.online, 3);
    assert.equal(cex.data.BTC.n, 3);
    assert.equal(cex.data.BTC.lo, 100);
    assert.equal(cex.data.BTC.med, 110);
    assert.equal(cex.data.BTC.hi, 120);
    assert.ok(urls.some(url => url === 'https://api.kraken.com/0/public/Ticker'));
    assert.ok(urls.some(url => /BTC-USDT\/spot/.test(url)));
    assert.equal(urls.some(url => /BTC-USD\/spot/.test(url)), false);
    const coinbase = createEngine('CexEngine', url => url.includes('coinbase.com')
      ? Promise.resolve({ data: { base: 'BTC', currency: 'USDT', amount: '101.5' } })
      : Promise.reject(new Error('offline')), fakeTimers(), () => {});
    await coinbase.fetchAll(['BTC']);
    assert.equal(coinbase.data.BTC.med, 101.5);
    assert.deepEqual(coinbase.data.BTC.venues, ['COINBASE']);
  });

  it('retains Kraken quotes when other requested symbols are unlisted and rejects API errors', async () => {
    let invalid = false; const urls = [];
    const fetcher = url => {
      if (!url.includes('kraken.com')) return Promise.reject(new Error('offline'));
      urls.push(url);
      return Promise.resolve(invalid
        ? { error: ['EQuery:Unknown asset pair'], result: { XBTUSDT: { c: ['99'] } } }
        : { error: [], result: { XBTUSDT: { c: ['100'] }, ETHUSDT: { c: ['10'] }, XXBTZUSD: { c: ['90'] } } });
    };
    const cex = createEngine('CexEngine', fetcher, fakeTimers(), () => {});
    await cex.fetchAll(['BTC', 'ETH', 'NOTLISTED']);
    assert.deepEqual(urls, ['https://api.kraken.com/0/public/Ticker']);
    assert.equal(cex.data.BTC.med, 100); assert.equal(cex.data.ETH.med, 10);
    assert.equal(cex.data.NOTLISTED, undefined);
    invalid = true; await cex.fetchAll(['BTC']);
    assert.deepEqual(cex.data, {}); assert.equal(cex.online, 0);
  });

  it('replaces DEX discovery results, rejects invalid prices and expires the feed', async () => {
    let active = true, redraws = 0;
    const timers = fakeTimers();
    const fetcher = url => {
      if (!active) return Promise.reject(new Error('offline'));
      if (url.includes('dexscreener')) return Promise.resolve({ pairs: [
        { baseToken: { symbol: 'BTC' }, dexId: 'example-dex', priceUsd: '10', liquidity: { usd: 100000 } },
        { baseToken: { symbol: 'BTC' }, dexId: 'other', priceUsd: 'Infinity', liquidity: { usd: 999999 } },
        { baseToken: { symbol: 'BTC' }, dexId: '<img>', priceUsd: '1', liquidity: { usd: 999999 } }
      ] });
      if (url.includes('dydx')) return Promise.resolve({ markets: { 'BTC-USD': { status: 'ACTIVE', oraclePrice: '10' } } });
      return Promise.reject(new Error('offline'));
    };
    const dex = createEngine('DexEngine', fetcher, timers, () => redraws++);
    await dex.fetchAll(['BTC']);
    assert.equal(dex.wire.length, 1);
    assert.equal(dex.wire[0].dex, 'EXAMPLE-DEX');
    assert.equal(dex.dexCount(), 2);
    await dex.fetchAll(['BTC']);
    assert.equal(dex.wire.length, 1, 'no duplicate results after refresh');
    active = false;
    await dex.fetchAll(['BTC']);
    assert.equal(dex.wire.length, 0);
    assert.equal(dex.dexCount(), 0);
    active = true;
    await dex.fetchAll(['BTC']);
    timers.fire();
    assert.equal(dex.wire.length, 0);
    assert.equal(dex.dexCount(), 0);
    assert.equal(redraws, 1);
    assert.equal(dex.busy, false);
  });

  it('removes outdated attachments and never assigns symbol-only DEX results to a signal', () => {
    const signals = [{ pair: 'BTC / USD', entryPrice: 100, dexInfo: { dex: 'FAKE' }, cexN: 12, cexMed: 200, cexSpread: '50' }];
    const cex = { data: { BTC: { n: 1, med: 100, venues: ['BINANCE'] } } };
    const attach = extractFunction('attachVenueData', 'signalsData', 'pairSymbol', 'CexEngine')(signals, pair => pair.split(' / ')[0], cex);
    attach();
    assert.equal(signals[0].cexN, 1);
    assert.equal(signals[0].dexInfo, undefined);
    cex.data = {};
    attach();
    for (const prop of ['dexInfo', 'cexN', 'cexMed', 'cexSpread', 'venueLabel']) assert.equal(prop in signals[0], false, prop);
    assert.doesNotMatch(app, /sig\.dexInfo\.dex/);
    for (const label of ['DEX-SUCHE · SYMBOL NICHT VERIFIZIERT', 'DEX SEARCH · UNVERIFIED SYMBOLS', 'BÚSQUEDA DEX · SÍMBOLOS SIN VERIFICAR', 'بحث DEX · رموز غير موثّقة', 'DEX 搜索 · 代号未验证']) assert.ok(app.includes(label));
  });
});
