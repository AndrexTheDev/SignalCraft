import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced, extractArray } from './helpers/html.mjs';
const html = read('app.html');
const names = Function('return ' + extractArray(html, 'const CEX_LIST ='))();
const source = extractBalanced(html, 'const CexEngine = {');
function make(fetcher) {
  return Function('fetchVenueJson', 'CEX_LIST', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + source + ')')(
    fetcher, names, 90000, () => 1, () => {}, () => {}, (start, now) => now >= start && now - start < 90000
  );
}
function sample(binance, okx, bybit) {
  return url => {
    if (url.includes('binance.vision')) return Promise.resolve(binance);
    if (url.includes('okx.com')) return Promise.resolve({ data: okx });
    if (url.includes('bybit.com')) return Promise.resolve({ result: { list: bybit } });
    return Promise.reject(new Error('offline'));
  };
}
describe('step53 / CEX price aggregation and malformed rows', () => {
  it('uses the statistical median for one, two and three distinct venues', async () => {
    const a = [{ symbol: 'BTCUSDT', price: '100.12345678' }];
    const b = [{ instId: 'BTC-USDT', last: '110.12345678' }];
    const c = [{ symbol: 'BTCUSDT', lastPrice: '120.12345678' }];
    const engine = make(sample(a, b, c));
    await engine.fetchAll(['BTC']);
    assert.equal(engine.data.BTC.n, 3);
    assert.equal(engine.data.BTC.med, 110.12345678);
    const two = make(sample(a, b, [])); await two.fetchAll(['BTC']);
    assert.equal(two.data.BTC.n, 2);
    assert.equal(two.data.BTC.med, 105.12345678);
    const one = make(sample(a, [], [])); await one.fetchAll(['BTC']);
    assert.equal(one.data.BTC.n, 1); assert.equal(one.data.BTC.med, 100.12345678);
  });
  it('avoids overflowing the median of two very large finite positive values', async () => {
    const engine = make(sample([{ symbol: 'BTCUSDT', price: 1.6e308 }], [{ instId: 'BTC-USDT', last: 1.7e308 }], []));
    await engine.fetchAll(['BTC']);
    assert.ok(Number.isFinite(engine.data.BTC.med));
    assert.ok(Math.abs(engine.data.BTC.med / 1.65e308 - 1) < 1e-15);
  });
  it('skips malformed rows without dropping valid rows from the same exchange', async () => {
    const binance = [null, 5, {}, { symbol: null }, { symbol: 'BTCUSDT', price: '1.00001' }];
    const okx = [null, { instId: 42 }, { instId: 'BTC-USDT', last: '1.00003' }];
    const bybit = [null, {}, { symbol: 'BTCUSDT', lastPrice: '1e0' }];
    const engine = make(sample(binance, okx, bybit)); await engine.fetchAll(['BTC']);
    assert.equal(engine.online, 3); assert.equal(engine.data.BTC.n, 3);
    assert.equal(engine.data.BTC.med, 1.00001);
  });
  it('rejects coercible non-prices while accepting ordinary decimal and scientific prices', async () => {
    const rejected = [true, false, null, {}, [], '', ' ', '0x10', '-1', 'Infinity', 'NaN', '12x', '1e999'];
    for (const value of rejected) {
      const engine = make(sample([{ symbol: 'BTCUSDT', price: value }], [], []));
      await engine.fetchAll(['BTC']);
      assert.equal(engine.online, 0, String(value));
      assert.equal(engine.data.BTC, undefined, String(value));
    }
    for (const value of ['.00001', ' 1.00001 ', '1e-8', 42]) {
      const engine = make(sample([{ symbol: 'BTCUSDT', price: value }], [], []));
      await engine.fetchAll(['BTC']);
      assert.equal(engine.data.BTC.med, Number(value));
    }
  });
  it('only accepts an actual Kraken last-price array and Coinbase USDT numeric price', async () => {
    const engine = make(url => {
      if (url.includes('kraken.com')) return Promise.resolve({ result: { XBTUSDT: { c: '123' } } });
      if (url.includes('coinbase.com')) return Promise.resolve({ data: { base: 'BTC', currency: 'USDT', amount: true } });
      return Promise.reject(new Error('offline'));
    });
    await engine.fetchAll(['BTC']);
    assert.equal(engine.online, 0);
    assert.equal(engine.data.BTC, undefined);
  });
});
