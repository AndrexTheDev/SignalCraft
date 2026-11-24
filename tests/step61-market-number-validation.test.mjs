import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
import { factorWindowComputable } from './helpers/core-logic.mjs';
const app = read('app.html');
function grab(name, ...deps) {
  const marker = 'function ' + name + '('; const i = app.indexOf(marker);
  assert.ok(i >= 0, name);
  return Function(...deps.map(x => x[0]), 'return ' + app.slice(i, app.indexOf('{', i)) + extractBalanced(app, marker))(...deps.map(x => x[1]));
}
const parseNumber = app.includes('function parseMarketNumber(') ? grab('parseMarketNumber') : Number;
const candles = grab('validModelCandles', ['parseMarketNumber', parseNumber], ['factorWindowComputable', factorWindowComputable]);
const tickers = grab('parse24hTickers', ['parseMarketNumber', parseNumber]);
const day = 86400000, now = 1800000000000;
function bars() { return Array.from({ length: 200 }, (_, i) => { const t = (20000 + i) * day; return [t, '10', '12', '9', '11', '0', t + day - 1, '100', '0', '0', '60']; }); }
const valid = { symbol: 'BTCUSDT', quoteVolume: '20000000', priceChangePercent: '-1.25', closeTime: now };
describe('step61 / strict market inputs', () => {
  it('accepts decimal and scientific numeric values but not JavaScript coercions', () => {
    for (const input of [0, -1, 1e-8, ' 10.25 ', '-1.25', '+2', '.5', '1e-8', '0e-999', '-0.000']) assert.equal(parseNumber(input), Number(input));
    for (const input of [true, false, null, [], [1], {}, '', ' ', '0x10', '0b10', 'Infinity', '1e999', '1e-999', '-1e-999', '5x']) assert.ok(Number.isNaN(parseNumber(input)), String(input));
  });
  it('rejects invalid types and number forms in ticker values and unsafe timestamps', () => {
    for (const [key, value] of [['quoteVolume', [20000000]], ['quoteVolume', '0x1312d00'], ['priceChangePercent', true], ['priceChangePercent', ['1']], ['closeTime', [now]], ['closeTime', now + 0.5], ['closeTime', String(now) + '.5']]) {
      assert.equal(tickers([{ ...valid, [key]: value }], now).BTCUSDT, undefined, key + ': ' + String(value));
    }
    assert.deepEqual(tickers([{ ...valid, closeTime: String(now), quoteVolume: '2e7' }], now).BTCUSDT, { volume: 20000000, change: -1.25, time: now });
    assert.equal(tickers([valid], NaN).BTCUSDT, undefined);
  });
  it('accepts an optional positive last price without letting invalid prices poison model tickers', () => {
    assert.equal(tickers([{ ...valid, lastPrice: '60123.456789' }], now).BTCUSDT.price, 60123.456789);
    for (const price of [undefined, null, true, [], '0', '-1', '1e999', '1e-999', '<img>', '0x10']) {
      const result = tickers([{ ...valid, lastPrice: price }], now).BTCUSDT;
      assert.ok(result); assert.equal(result.price, undefined, String(price));
    }
    assert.equal(tickers([{ ...valid, closeTime: now + 60001, lastPrice: '1' }], now).BTCUSDT, undefined);
    assert.equal(tickers([{ ...valid, lastPrice: '1' }, { ...valid, lastPrice: '2' }], now).BTCUSDT, undefined);
  });
  it('drops ambiguous duplicate valid ticker symbols, not unrelated or malformed rows', () => {
    const eth = { ...valid, symbol: 'ETHUSDT' };
    for (const rows of [[valid, { ...valid, quoteVolume: '30000000' }, eth], [eth, { ...valid, quoteVolume: '30000000' }, valid], [valid, valid, valid, eth]]) {
      const result = tickers(rows, now);
      assert.equal(result.BTCUSDT, undefined);
      assert.ok(result.ETHUSDT);
    }
    assert.ok(tickers([valid, { ...valid, quoteVolume: true }], now).BTCUSDT);
  });
  it('validates all 200 OHLC and volume fields before numeric coercion', () => {
    assert.equal(candles(bars()), true);
    for (const [index, value] of [[0, [bars()[1][0]]], [1, [10]], [2, '0x0c'], [3, true], [4, [11]], [6, [bars()[1][6]]], [7, [100]], [10, [60]]]) {
      const rows = bars(); rows[1][index] = value;
      assert.equal(candles(rows), false, 'field ' + index + ': ' + String(value));
    }
    const sparse = bars(); delete sparse[10]; assert.equal(candles(sparse), false);
    const numeric = bars(); numeric[1][1] = '1e1'; numeric[1][7] = '1e2';
    assert.equal(candles(numeric), true);
  });
});
