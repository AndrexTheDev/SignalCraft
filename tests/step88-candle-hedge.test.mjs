import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function loadFetch(fetch) {
  const marker = 'function fetchVenueJson(', start = html.indexOf(marker);
  return Function('fetch', 'return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker))(fetch);
}
function engine(fetch) {
  const helper = loadFetch(fetch), source = extractBalanced(html, 'const ME = {');
  const e = Function('fetchVenueJson', 'validModelCandles', 'candlesAreCurrent', 'return (' + source + ')')(
    (url, options) => helper(url, options, 120), rows => Array.isArray(rows) && rows[0] !== 'BAD', () => true
  );
  e.CANDLE_HEDGE_MS = 10; return e;
}
const sources = { binance: { BTCUSDT: {} }, 'binance-us': { BTCUSDT: {} } };
const ok = rows => ({ ok: true, json: async () => rows });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
describe('step88 / validated hedged candle sources', () => {
  it('uses fast global data without issuing a Binance.US candle request', async () => {
    const urls = [], e = engine(url => { urls.push(url); return Promise.resolve(ok(['global'])); });
    const result = await e.kGet('BTC', sources, undefined, (rows, src) => ({ src, value: rows[0] }));
    await wait(20);
    assert.equal(result.src, 'binance'); assert.deepEqual(result.built, { src: 'binance', value: 'global' });
    assert.equal(urls.length, 1); assert.match(urls[0], /binance\.vision/);
  });
  it('accepts the valid US candidate when global stalls and aborts the loser', async () => {
    let globalSignal, late; const builds = [];
    const e = engine((url, options) => {
      if (url.includes('binance.us')) return Promise.resolve(ok(['us']));
      globalSignal = options.signal;
      return new Promise(resolve => { late = resolve; });
    });
    const result = await e.kGet('BTC', sources, undefined, (rows, src) => { builds.push(src); return { value: rows[0] }; });
    assert.equal(result.src, 'binance-us'); assert.equal(result.built.value, 'us'); assert.equal(globalSignal.aborted, true);
    late(ok(['late-global'])); await wait(10); assert.deepEqual(builds, ['binance-us']);
  });
  it('waits for valid global data if the speculative US attempt fails first', async () => {
    let releaseGlobal; const urls = [];
    const e = engine(url => {
      urls.push(url);
      if (url.includes('binance.us')) return Promise.reject(new Error('offline'));
      return new Promise(resolve => { releaseGlobal = resolve; });
    });
    const pending = e.kGet('BTC', sources, undefined, (rows, src) => ({ src, value: rows[0] }));
    await wait(25); assert.equal(urls.filter(x => x.includes('binance.us')).length, 1);
    releaseGlobal(ok(['global'])); const result = await pending;
    assert.equal(result.src, 'binance'); assert.deepEqual(result.built, { src: 'binance', value: 'global' });
  });
  it('does not publish an invalid fast candidate and tries the other venue immediately after global failure', async () => {
    const urls = []; const e = engine(url => {
      urls.push(url); return Promise.resolve(ok([url.includes('binance.us') ? 'good' : 'BAD']));
    });
    e.CANDLE_HEDGE_MS = 10000;
    const result = await e.kGet('BTC', sources, undefined, (rows, src) => ({ src, value: rows[0] }));
    assert.equal(result.src, 'binance-us'); assert.equal(result.built.value, 'good');
    assert.equal(urls.filter(x => x.includes('binance.us')).length, 1);
    assert.equal(urls.length, 3);
  });
  it('cancels both attempts on parent abort and ignores late responses', async () => {
    const signals = [], late = [], builds = [];
    const e = engine((url, options) => { signals.push(options.signal); return new Promise(resolve => late.push(resolve)); });
    const parent = new AbortController();
    const pending = e.kGet('BTC', sources, parent.signal, (rows, src) => builds.push(src));
    await wait(25); assert.equal(signals.length, 2); parent.abort();
    await assert.rejects(pending, /market-cancelled/);
    assert.ok(signals.every(s => s.aborted));
    late.forEach(resolve => resolve(ok(['late']))); await wait(10); assert.deepEqual(builds, []);
  });
  it('does not hedge without a validated US ticker', async () => {
    const urls = [], e = engine(url => { urls.push(url); return Promise.resolve(ok(['global'])); });
    const globalOnly = { binance: sources.binance, 'binance-us': {} };
    assert.equal((await e.kGet('BTC', globalOnly)).src, 'binance');
    await wait(20); assert.equal(urls.length, 1);
  });
  it('cancels a pending hedge before it can start', async () => {
    const urls = [], e = engine(url => { urls.push(url); return new Promise(() => {}); });
    e.CANDLE_HEDGE_MS = 30; const parent = new AbortController();
    const pending = e.kGet('BTC', sources, parent.signal); parent.abort();
    await assert.rejects(pending, /market-cancelled/);
    await wait(40); assert.equal(urls.filter(x => x.includes('binance.us')).length, 0);
  });
  it('tries the US venue when global history cannot produce a valid candidate', async () => {
    const e = engine(url => Promise.resolve(ok([url.includes('binance.us') ? 'us' : 'global'])));
    e.CANDLE_HEDGE_MS = 10000;
    const result = await e.kGet('BTC', sources, undefined, (rows, src) => {
      if (src === 'binance') throw new Error('bad trade plan');
      return { src, value: rows[0] };
    });
    assert.deepEqual(result.built, { src: 'binance-us', value: 'us' });
  });
  it('aborts a slow US hedge if the preferred global candidate wins', async () => {
    let releaseGlobal, usSignal;
    const e = engine((url, options) => {
      if (url.includes('binance.us')) { usSignal = options.signal; return new Promise(() => {}); }
      return new Promise(resolve => { releaseGlobal = resolve; });
    });
    const pending = e.kGet('BTC', sources); await wait(25);
    releaseGlobal(ok(['global'])); assert.equal((await pending).src, 'binance');
    assert.equal(usSignal.aborted, true);
  });
  it('returns no source if both candidate histories are invalid', async () => {
    const e = engine(() => Promise.resolve(ok(['BAD'])));
    await assert.rejects(e.kGet('BTC', sources), /no-source/);
  });
});
