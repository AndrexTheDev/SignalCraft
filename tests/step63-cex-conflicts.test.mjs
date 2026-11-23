import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
const html = read('app.html');
const names = Function('return ' + extractArray(html, 'const CEX_LIST ='))();
function make(fetcher) {
  const source = extractBalanced(html, 'const CexEngine = {');
  return Function('fetchVenueJson', 'CEX_LIST', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + source + ')')(
    fetcher, names, 90000, () => 1, () => {}, () => {}, (start, now) => now >= start && now - start < 90000
  );
}
function fetcher(binance, okx = []) {
  return url => url.includes('binance.vision') ? Promise.resolve(binance) : url.includes('okx.com') ? Promise.resolve({ data: okx }) : Promise.reject(new Error('offline'));
}
const btc = price => ({ symbol: 'BTCUSDT', price });
const eth = price => ({ symbol: 'ETHUSDT', price });
const ok = price => ({ instId: 'BTC-USDT', last: price });
describe('step63 / ambiguous CEX quotes', () => {
  it('drops duplicate quotes per venue and pair regardless of order or equal prices', async () => {
    for (const rows of [[btc('100'), btc('200')], [btc('200'), btc('100')], [btc('100'), btc('100')], [btc('100'), btc('200'), btc('100')]]) {
      const e = make(fetcher(rows, [ok('120')])); await e.fetchAll(['BTC']);
      assert.equal(e.online, 1);
      assert.deepEqual(e.data.BTC, { n: 1, med: 120, lo: 120, hi: 120, venues: ['OKX'] });
    }
  });
  it('keeps unrelated symbols from the same source and excludes malformed rows first', async () => {
    const e = make(fetcher([btc('100'), btc('200'), eth('40'), { ...eth(true) }, { ...eth('Infinity') }], [ok('120')]));
    await e.fetchAll(['BTC', 'ETH']);
    assert.equal(e.online, 2);
    assert.deepEqual(e.data.BTC.venues, ['OKX']);
    assert.deepEqual(e.data.ETH.venues, ['BINANCE']);
    assert.equal(e.data.ETH.med, 40);
  });
  it('uses no phantom venue or median when every valid quote conflicts', async () => {
    const e = make(fetcher([btc('100'), btc('200')], [ok('110'), ok('130')]));
    await e.fetchAll(['BTC']);
    assert.equal(e.online, 0);
    assert.deepEqual(e.data, {});
  });
  it('rejects duplicate quotes collected from separate requests to the same venue', async () => {
    let call = 0;
    const e = make(url => {
      if (!url.includes('coinbase.com')) return Promise.reject(new Error('offline'));
      const value = ++call === 1 ? '10' : '20';
      return Promise.resolve({ data: { base: 'BTC', currency: 'USDT', amount: value } });
    });
    await e.fetchAll(['BTC', 'BTC']);
    assert.equal(call, 2); assert.equal(e.online, 0); assert.equal(e.data.BTC, undefined);
  });
  it('keeps the even-count median correct for unambiguous remaining venues', async () => {
    const e = make(url => {
      if (url.includes('binance.vision')) return Promise.resolve([btc('90'), btc('190')]);
      if (url.includes('okx.com')) return Promise.resolve({ data: [ok('100')] });
      if (url.includes('bybit.com')) return Promise.resolve({ result: { list: [{ symbol: 'BTCUSDT', lastPrice: '120' }] } });
      return Promise.reject(new Error('offline'));
    });
    await e.fetchAll(['BTC']);
    assert.equal(e.online, 2); assert.equal(e.data.BTC.n, 2); assert.equal(e.data.BTC.med, 110);
  });
});
