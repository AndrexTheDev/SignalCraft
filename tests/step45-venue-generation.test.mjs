import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
const html = read('app.html');
const cexList = Function('return ' + extractArray(html, 'const CEX_LIST ='))();
const marker = 'function parseMarketNumber(';
const at = html.indexOf(marker);
const parseMarketNumber = Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, marker))();
function engine(name, fetcher) {
  let timers = 0;
  const source = extractBalanced(html, `const ${name} = {`);
  const result = Function('fetchVenueJson', 'CEX_LIST', 'parseMarketNumber', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + source + ')')(
    fetcher, cexList, parseMarketNumber, 90000, () => { timers++; return timers; }, () => {}, () => {}, (t, now) => Number.isFinite(t) && now >= t && now - t < 90000
  );
  return { result, timers: () => timers };
}
describe('step45 / venue snapshot generations', () => {
  it('does not publish or schedule expiry for an obsolete CEX response', async () => {
    let resolve, current = true;
    const h = engine('CexEngine', url => url.includes('binance.vision')
      ? new Promise(r => { resolve = r; }) : Promise.reject(new Error('offline')));
    const promise = h.result.fetchAll(['BTC'], () => current);
    current = false; resolve([{ symbol: 'BTCUSDT', price: '42' }]);
    await promise;
    assert.deepEqual(h.result.data, {}); assert.equal(h.result.online, 0);
    assert.equal(h.timers(), 0); assert.equal(h.result.busy, false);
  });
  it('does not publish or schedule expiry for an obsolete DEX response', async () => {
    let resolve, current = true;
    const h = engine('DexEngine', url => url.includes('dexscreener')
      ? new Promise(r => { resolve = r; }) : Promise.reject(new Error('offline')));
    const promise = h.result.fetchAll(['BTC'], () => current);
    current = false;
    resolve({ pairs: [{ baseToken: { symbol: 'BTC' }, dexId: 'old-dex', priceUsd: '42', liquidity: { usd: 100000 } }] });
    await promise;
    assert.deepEqual(h.result.wire, []); assert.equal(h.result.dexCount(), 0);
    assert.equal(h.timers(), 0); assert.equal(h.result.busy, false);
  });
  it('always releases engine busy flags after a stale response', async () => {
    const h = engine('CexEngine', () => Promise.reject(new Error('offline')));
    await h.result.fetchAll(['BTC'], () => false);
    assert.equal(h.result.busy, false);
    await h.result.fetchAll(['BTC'], () => true);
    assert.equal(h.timers(), 1); assert.equal(h.result.busy, false);
  });
});
