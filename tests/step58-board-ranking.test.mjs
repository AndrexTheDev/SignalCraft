import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function load(name) {
  const marker = 'function ' + name + '('; const i = html.indexOf(marker);
  assert.ok(i >= 0, `missing ${name}`);
  return Function('return ' + html.slice(i, html.indexOf('{', i)) + extractBalanced(html, marker))();
}
describe('step58 / deterministic snapshot ranking', () => {
  it('orders by score, then displayed volume, then symbol instead of request completion', () => {
    const compare = load('compareMarketRanking');
    const make = (pair, score, vol) => ({ pair: `${pair} / USDT`, score, metrics: { volMio: vol } });
    const rows = [make('ZZ', 92, 20), make('AA', 92, 20), make('CC', 93, 1), make('BB', 92, 30), make('DD', 91, 99)];
    const order = ['CC', 'BB', 'AA', 'ZZ', 'DD'];
    for (const input of [rows, [...rows].reverse(), [rows[3], rows[0], rows[4], rows[1], rows[2]]]) {
      assert.deepEqual(input.slice().sort(compare).map(x => x.pair.split(' ')[0]), order);
    }
    assert.equal(compare(rows[0], rows[0]), 0);
    assert.match(html, /out\.sort\(compareMarketRanking\)/);
  });
  it('selects the same ten tied setups regardless of collection order', () => {
    const compare = load('compareMarketRanking');
    const rows = Array.from({ length: 12 }, (_, i) => ({ pair: `COIN${String(i).padStart(2, '0')} / USDT`, score: 90, metrics: { volMio: 20 } }));
    const top = input => input.slice().sort(compare).slice(0, 10).map(x => x.pair);
    assert.deepEqual(top(rows), top(rows.slice().reverse()));
    assert.ok(top(rows).includes('COIN09 / USDT'));
    assert.ok(!top(rows).includes('COIN10 / USDT'));
  });
});
