import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const mark = 'function parseMarketNumber(', at = html.indexOf(mark);
const parse = Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, mark))();
function engine(handler) {
  return Function('fetchVenueJson', 'parseMarketNumber', 'VENUE_TTL', 'setTimeout', 'clearTimeout', 'refreshVenuePresentation', 'venueDataIsFresh', 'return (' + extractBalanced(html, 'const DexEngine = {') + ')')(
    handler, parse, 90000, () => 1, () => {}, () => {}, (t, now) => now >= t && now - t < 90000
  );
}
const pair = (sym, dex, price, liq) => ({ baseToken: { symbol: sym }, dexId: dex, priceUsd: price, liquidity: { usd: liq } });
function fromRows(rows) { return engine(url => url.includes('dexscreener') ? Promise.resolve({ pairs: rows }) : Promise.reject(new Error('offline'))); }
describe('step64 / DEX search ranking', () => {
  it('rejects ambiguous top-liquidity values regardless of answer order', async () => {
    const rows = [pair('BTC','a','10','100000'), pair('BTC','b','20','100000'), pair('BTC','c','30','90000')];
    for (const r of [rows, rows.slice().reverse()]) {
      const e = fromRows(r); await e.fetchAll(['BTC']);
      assert.deepEqual(e.wire, []); assert.equal(e.dexCount(), 0);
    }
    const e = fromRows([pair('BTC','a','10','100000'), pair('BTC','a','11','100000')]);
    await e.fetchAll(['BTC']); assert.deepEqual(e.wire, []);
  });
  it('accepts repeated equivalent top rows and ignores ambiguity below a clear winner', async () => {
    const rows = [pair('BTC','a','10','100000'), pair('BTC','a','10','100000'), pair('BTC','b','20','90000'), pair('BTC','c','30','90000')];
    const e = fromRows(rows); await e.fetchAll(['BTC']);
    assert.equal(e.wire.length, 1); assert.equal(e.wire[0].dex, 'A'); assert.equal(e.wire[0].price, 10);
  });
  it('orders wire by unrounded liquidity then symbol independent of request completion order', async () => {
    async function run(reverse) {
      const pending = {};
      const e = engine(url => {
        if (!url.includes('dexscreener')) return Promise.reject(new Error('offline'));
        const sym = new URL(url).searchParams.get('q');
        return new Promise(resolve => { pending[sym] = resolve; });
      });
      const task = e.fetchAll(['BTC','ETH','DOGE']);
      const rows = { BTC: pair('BTC','x','1','104000'), ETH: pair('ETH','y','2','104999'), DOGE: pair('DOGE','z','3','104999') };
      for (const sym of reverse ? ['BTC','ETH','DOGE'] : ['DOGE','ETH','BTC']) pending[sym]({ pairs: [rows[sym]] });
      await task;
      return e.wire.map(x => x.sym);
    }
    assert.deepEqual(await run(false), ['DOGE','ETH','BTC']);
    assert.deepEqual(await run(true), ['DOGE','ETH','BTC']);
  });
});
