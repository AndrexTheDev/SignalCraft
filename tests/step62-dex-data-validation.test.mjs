import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function grab(name) {
  const mark = 'function ' + name + '(', at = html.indexOf(mark);
  return Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, mark))();
}
const parse = html.includes('function parseMarketNumber(') ? grab('parseMarketNumber') : Number;
function engine(handler) {
  return Function('fetchVenueJson', 'parseMarketNumber', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + extractBalanced(html, 'const DexEngine = {') + ')')(
    handler, parse, 90000, () => 1, () => {}, () => {}, (t, now) => now >= t && now - t < 90000
  );
}
const good = { baseToken: { symbol: 'BTC' }, dexId: 'real-dex', priceUsd: '1.25e-7', liquidity: { usd: '1e5' } };
const pair = (priceUsd, usd) => ({ baseToken: { symbol: 'BTC' }, dexId: 'fake-dex', priceUsd, liquidity: { usd } });
describe('step62 / DEX discovery data integrity', () => {
  it('rejects coercible prices and liquidity without dropping valid rows', async () => {
    for (const bad of [true, false, null, [], [10], {}, '', ' ', '0x10', 'Infinity', '1e999', '1e-999']) {
      const e = engine(url => url.includes('dexscreener') ? Promise.resolve({ pairs: [pair(bad, 100000000), pair('1', bad), good] }) : Promise.reject(new Error('offline')));
      await e.fetchAll(['BTC']);
      assert.equal(e.wire.length, 1, String(bad));
      assert.equal(e.wire[0].dex, 'REAL-DEX', String(bad));
      assert.equal(e.wire[0].price, 1.25e-7);
      assert.equal(e.dexCount(), 1);
    }
  });
  it('does not report malformed DEX search rows as feeds', async () => {
    for (const rows of [[pair(true, 100000)], [pair('1', [100000])], [pair('0x10', '1e5')], [pair('1', '40000')], [pair('0', '100000')]]) {
      const e = engine(url => url.includes('dexscreener') ? Promise.resolve({ pairs: rows }) : Promise.reject(new Error('offline')));
      await e.fetchAll(['BTC']);
      assert.deepEqual(e.wire, []); assert.equal(e.dexCount(), 0);
    }
  });
  it('counts Hyperliquid and dYdX only when they contain a real positive number', async () => {
    for (const bad of [true, false, null, [], [123], {}, '', ' ', '0x10', 'Infinity', '1e-999']) {
      const e = engine(url => url.includes('hyperliquid') ? Promise.resolve({ BTC: bad }) : url.includes('dydx') ? Promise.resolve({ markets: { BTC: { oraclePrice: bad } } }) : Promise.reject(new Error('offline')));
      await e.fetchAll([]);
      assert.equal(e.dexCount(), 0, String(bad));
    }
    const array = engine(url => url.includes('hyperliquid') ? Promise.resolve(['123']) : Promise.reject(new Error('offline')));
    await array.fetchAll([]); assert.equal(array.dexCount(), 0);
    const valid = engine(url => url.includes('hyperliquid') ? Promise.resolve({ BTC: '1e2' }) : url.includes('dydx') ? Promise.resolve({ markets: { BTC: { oraclePrice: 99.5 } } }) : Promise.reject(new Error('offline')));
    await valid.fetchAll([]); assert.equal(valid.dexCount(), 2);
  });
  it('chooses the highest valid liquidity and discards stale results on refresh', async () => {
    let enabled = true;
    const e = engine(url => enabled && url.includes('dexscreener') ? Promise.resolve({ pairs: [good, { ...good, dexId: 'larger', liquidity: { usd: '110000' }, priceUsd: 2 }] }) : Promise.reject(new Error('offline')));
    await e.fetchAll(['BTC']); assert.equal(e.wire[0].dex, 'LARGER'); assert.equal(e.wire[0].price, 2);
    enabled = false; await e.fetchAll(['BTC']); assert.deepEqual(e.wire, []); assert.equal(e.dexCount(), 0);
  });
});
