import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
const source = extractBalanced(html, 'const ME = {');
const marker = 'function compareMarketRanking(';
const at = html.indexOf(marker);
const compareMarketRanking = Function('return ' + html.slice(at, html.indexOf('{', at)) + extractBalanced(html, marker))();
function harness(initial, gatePass = true) {
  let cache = initial, deletes = 0;
  const seed = Array.from({ length: 100 }, (_, i) => ({ pair: `P${i}`, sector: 'test' }));
  const button = { disabled: false, setAttribute() {}, removeAttribute() {} };
  const me = Function('ME_STAMP', 'document', 'I18N', 'currentLang', 'MARKET_UNIVERSE', 'liveStateText', 'signalsData', 'pairSymbol', 'showToast', 'lsGet', 'lsSet', 'lsDel', 'passesQualityGate', 'snapshotIsFresh', 'isLiveCache', 'compareMarketRanking', 'const setMarketQuotes = () => {}; return (' + source + ')')(
    0, { getElementById: () => button }, { en: { meDemoToast: 'demo', meLiveToast: 'live' } }, 'en', seed.map(s => [s.pair, s.sector]), () => 'unavailable', [], s => s,
    () => {}, () => cache, (key, val) => { cache = val; }, () => { cache = null; deletes++; }, () => gatePass, (t, now, ttl) => Number.isFinite(t) && t <= now && now - t < ttl, () => true, compareMarketRanking
  );
  me.REFRESH_DEADLINE = 25;
  return { me, seed, get: () => cache, set: v => { cache = v; }, deletions: () => deletes, button };
}
describe('step44 / cached live data after failed refresh', () => {
  it('removes the old cache and shows unavailable on network failure', async () => {
    const h = harness('old'); h.me.tickers24h = async () => { throw new Error('offline'); };
    h.me.apply = (data, mode) => { assert.equal(mode, 'unavailable'); assert.equal(h.get(), null); };
    await h.me.refresh(true);
    assert.equal(h.deletions(), 1); assert.equal(h.button.disabled, false);
  });
  it('does not remove a cache another tab updated while a refresh was in flight', async () => {
    const h = harness('old'); let release;
    h.me.tickers24h = () => new Promise(resolve => { release = resolve; });
    h.me.apply = () => {};
    const refresh = h.me.refresh(true);
    h.set('new');
    await refresh;
    assert.equal(h.get(), 'new'); assert.equal(h.deletions(), 1);
    release({ binance: {}, 'binance-us': {} });
  });
  it('does not erase a newly created cache if none existed when the refresh began', async () => {
    const h = harness(null);
    h.me.tickers24h = () => new Promise(() => {});
    h.me.apply = () => {};
    const refresh = h.me.refresh(true); h.set('new'); await refresh;
    assert.equal(h.get(), 'new'); assert.equal(h.deletions(), 0);
  });
  it('keeps a valid empty-gate snapshot live and clears the old cache', async () => {
    const h = harness('old', false);
    const binance = Object.fromEntries(h.seed.map(s => [s.pair + 'USDT', { time: Date.now() }]));
    h.me.tickers24h = async () => ({ binance, 'binance-us': {} });
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(Date.now() / 86400000) * 86400000]], src = 'binance'; return { src, k, built: build(k, src) }; };
    h.me.build = sym => ({ pair: sym, src: 'binance', score: 50, metrics: { volMio: 20 } });
    h.me.toSignal = b => b;
    let mode;
    h.me.apply = (data, value) => { mode = value; h.me.status.mode = value; };
    await h.me.refresh(true);
    assert.equal(mode, 'live'); assert.equal(h.get(), null); assert.equal(h.deletions(), 1);
  });
  it('does not write fresh LIVE cache if rendering the new snapshot fails', async () => {
    const h = harness('old'); let live = 0, demo = 0;
    const binance = Object.fromEntries(h.seed.map(s => [s.pair + 'USDT', { time: Date.now() }]));
    h.me.tickers24h = async () => ({ binance, 'binance-us': {} });
    h.me.kGet = async (sym, sources, signal, build) => { const k = [[Math.floor(Date.now() / 86400000) * 86400000]], src = 'binance'; return { src, k, built: build(k, src) }; };
    h.me.build = sym => ({ pair: sym, src: 'binance', score: 90, metrics: { volMio: 20 } });
    h.me.toSignal = b => b;
    h.me.apply = (data, mode) => { if (mode === 'live') { live++; throw new Error('render failed'); } demo++; };
    await h.me.refresh(true);
    assert.equal(live, 1); assert.equal(demo, 1); assert.equal(h.get(), null);
    assert.equal(h.button.disabled, false);
  });
});
