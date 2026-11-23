import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const DAY = 86_400_000;
function code(name) {
  const marker = 'function ' + name + '(';
  const start = html.indexOf(marker);
  return html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker);
}
const compareMarketRanking = Function('return ' + code('compareMarketRanking'))();
const expiry = Function('return ' + code('snapshotExpiry'))();
const fresh = Function('snapshotExpiry', 'return ' + code('snapshotIsFresh'))(expiry);
function harness(time, count = 100) {
  const clock = { now: time };
  class FakeDate extends Date { static now() { return clock.now; } }
  const seed = Array.from({ length: count }, (_, i) => ({ pair: 'P' + i, sector: 'test' }));
  let cache = null, applied = [];
  const me = Function('Date', 'ME_STAMP', 'document', 'I18N', 'currentLang', 'MARKET_UNIVERSE', 'liveStateText', 'signalsData', 'pairSymbol', 'showToast', 'lsGet', 'lsSet', 'lsDel', 'passesQualityGate', 'snapshotIsFresh', 'isLiveCache', 'compareMarketRanking', 'return (' + extractBalanced(html, 'const ME = {') + ')')(
    FakeDate, 1, { getElementById: () => null }, { en: {} }, 'en', seed.map(s => [s.pair, s.sector]), () => 'unavailable', [], x => x, () => {}, () => cache, (k, v) => { cache = v; }, () => { cache = null; }, () => true, fresh, () => true, compareMarketRanking
  );
  me.build = sym => ({ pair: sym, score: 90, src: 'binance', metrics: { volMio: 20 } });
  me.toSignal = (b, i, at) => ({ pair: b.pair, timestamp: at, modelVersion: 3, gateMetrics: {} });
  me.apply = (signals, mode, at) => { applied.push({ signals, mode, at }); me.status.mode = mode; };
  return { me, seed, clock, get cache() { return cache && JSON.parse(cache); }, applied };
}
function tickers(seed, time) {
  return { binance: Object.fromEntries(seed.map(s => [s.pair + 'USDT', { time }])), 'binance-us': {} };
}
describe('step46 / conservative live snapshot timing', () => {
  const midday = Math.floor(1_800_000_000_000 / DAY) * DAY + 12 * 60 * 60 * 1000;
  it('expires at 90 seconds or UTC midnight, and rejects invalid or future timestamps', () => {
    assert.equal(expiry(midday, 90000), midday + 90000);
    assert.equal(fresh(midday, midday + 89999, 90000), true);
    assert.equal(fresh(midday, midday + 90000, 90000), false);
    const endOfDay = Math.floor(midday / DAY) * DAY + DAY;
    assert.equal(expiry(endOfDay - 10000, 90000), endOfDay);
    assert.equal(fresh(endOfDay - 10000, endOfDay - 1, 90000), true);
    assert.equal(fresh(endOfDay - 10000, endOfDay, 90000), false);
    for (const t of [NaN, Infinity, 0, -1, midday + 1]) assert.equal(fresh(t, midday, 90000), false);
  });
  it('timestamps the whole snapshot and cache no later than the oldest ticker', async () => {
    const h = harness(midday, 101), rows = tickers(h.seed, midday - 1000);
    rows.binance.P0USDT.time = midday - 30000;
    rows.binance.P100USDT.time = midday - 90000;
    h.me.tickers24h = async () => rows;
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(midday / DAY) * DAY]], src = 'binance'; return { src, k, built: build(k, src) }; };
    await h.me.refresh(true);
    assert.equal(h.applied[0].mode, 'live');
    assert.equal(h.applied[0].at, midday - 30000);
    assert.equal(h.cache, null);
    assert.equal(h.applied[0].signals.length, 100);
    assert.ok(h.applied[0].signals.every(s => s.timestamp === h.applied[0].at));
    assert.ok(!h.applied[0].signals.some(s => s.pair === 'P100'));
  });
  it('produces the same LIVE ranking when candle requests complete in different orders', async () => {
    async function run(reverse) {
      const h = harness(midday), rows = tickers(h.seed, midday - 1000);
      h.me.tickers24h = async () => rows;
      const completed = [];
      h.me.kGet = (sym, sources, signal, build) => new Promise(resolve => {
        const i = Number(sym.slice(1));
        const delay = reverse ? (5 - i % 6) : (i % 6);
        setTimeout(() => { completed.push(sym); const k = [[Math.floor(midday / DAY) * DAY]], src = 'binance'; resolve({ src, k, built: build(k, src) }); }, delay);
      });
      await h.me.refresh(true);
      assert.equal(h.applied[0].mode, 'live');
      return { ranking: h.applied[0].signals.map(s => s.pair), completed };
    }
    const [forward, reverse] = await Promise.all([run(false), run(true)]);
    assert.notDeepEqual(forward.completed, reverse.completed);
    assert.deepEqual(forward.ranking, reverse.ranking);
    assert.deepEqual(forward.ranking, forward.ranking.slice().sort());
  });
  it('never extends the timestamp just because collection finishes later', async () => {
    const h = harness(midday), rows = tickers(h.seed, midday + 30000);
    h.me.tickers24h = async () => { h.clock.now = midday + 30000; return rows; };
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(midday / DAY) * DAY]], src = 'binance'; return { src, k, built: build(k, src) }; };
    await h.me.refresh(true);
    assert.equal(h.applied[0].mode, 'live'); assert.equal(h.applied[0].at, midday); assert.equal(h.cache, null);
  });
  it('falls back when too few tickers remain fresh', async () => {
    const h = harness(midday), rows = tickers(h.seed, midday - 90000);
    h.me.tickers24h = async () => rows;
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(midday / DAY) * DAY]], src = 'binance'; return { src, k, built: build(k, src) }; };
    await h.me.refresh(true);
    assert.equal(h.applied[0].mode, 'unavailable'); assert.equal(h.cache, null);
  });
  it('rejects candles collected on the previous UTC day when collection crosses midnight', async () => {
    const midnight = Math.floor(midday / DAY) * DAY + DAY;
    const h = harness(midnight - 1000), rows = tickers(h.seed, midnight - 1000);
    h.me.tickers24h = async () => rows;
    h.me.kGet = async (sym, sources, signal, build) => { h.clock.now = midnight + 100; const k = [[midnight - DAY]], src = 'binance'; return { src, k, built: build(k, src) }; };
    await h.me.refresh(true);
    assert.equal(h.applied[0].mode, 'unavailable'); assert.equal(h.cache, null);
  });
  it('refuses to cache a live snapshot if rendering finishes after its expiry', async () => {
    const h = harness(midday), rows = tickers(h.seed, midday - 80000);
    h.me.tickers24h = async () => rows;
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(midday / DAY) * DAY]], src = 'binance'; return { src, k, built: build(k, src) }; };
    h.me.apply = (signals, mode, at) => { h.applied.push({ signals, mode, at }); h.me.status.mode = mode; if (mode === 'live') h.clock.now += 10001; };
    await h.me.refresh(true);
    assert.deepEqual(h.applied.map(x => x.mode), ['live', 'unavailable']); assert.equal(h.cache, null);
  });
});
