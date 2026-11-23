import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
const html = read('app.html');
function helper(fetch) {
  const marker = 'function fetchVenueJson(';
  const start = html.indexOf(marker);
  return Function('fetch', 'return ' + html.slice(start, html.indexOf('{', start)) + extractBalanced(html, marker))(fetch);
}
const never = () => new Promise(() => {});
function engine() {
  const seed = Array.from({ length: 120 }, (_, i) => ({ pair: 'P' + i, sector: 'test' }));
  const button = { disabled: false, busy: false, setAttribute() { this.busy = true; }, removeAttribute() { this.busy = false; } };
  const me = Function('ME_STAMP', 'document', 'I18N', 'currentLang', 'SEED_SIGNALS', 'signalsData', 'pairSymbol', 'showToast', 'lsGet', 'lsDel', 'return (' + extractBalanced(html, 'const ME = {') + ')')(
    0, { getElementById: () => button }, { en: { meDemoToast: 'demo' } }, 'en', seed, [], s => s, () => {}, () => null, () => {}
  );
  me.REFRESH_DEADLINE = 30;
  return { me, button };
}

describe('step43 / full refresh deadline and cancellation', () => {
  it('cancels in-flight fetch and body even if they ignore their own abort signal', async () => {
    let signal;
    const fetch = helper((url, opt) => { signal = opt.signal; return Promise.resolve({ ok: true, json: never }); });
    const parent = new AbortController();
    const request = fetch('https://example.invalid', { signal: parent.signal }, 10000);
    await Promise.resolve();
    parent.abort();
    await assert.rejects(request, /venue-cancelled/);
    assert.equal(signal.aborted, true);
  });
  it('never starts an already cancelled request, including cancellation before the fetch microtask', async () => {
    let calls = 0;
    const fetch = helper(() => { calls++; return never(); });
    const first = new AbortController(); first.abort();
    await assert.rejects(fetch('url', { signal: first.signal }, 10000), /venue-cancelled/);
    const second = new AbortController();
    const promise = fetch('url', { signal: second.signal }, 10000);
    second.abort();
    await assert.rejects(promise, /venue-cancelled/);
    assert.equal(calls, 0);
  });
  it('bounds the whole refresh even when a ticker mock never settles', async () => {
    const { me, button } = engine(); let signal, applied = 0;
    me.tickers24h = async s => { signal = s; return never(); };
    me.apply = (data, mode) => { assert.equal(mode, 'seed'); applied++; };
    await me.refresh(true);
    assert.equal(signal.aborted, true); assert.equal(applied, 1);
    assert.equal(me.busy, false); assert.equal(button.disabled, false); assert.equal(button.busy, false);
  });
  it('stops workers after the deadline and ignores late results and late errors', async () => {
    const { me, button } = engine();
    let resolves = [], calls = 0, builds = 0, applies = 0;
    me.tickers24h = async () => ({ binance: {}, 'binance-us': {} });
    me.kGet = () => { calls++; return new Promise(resolve => resolves.push(resolve)); };
    me.build = () => { builds++; throw new Error('late data must not be built'); };
    me.apply = () => { applies++; };
    await me.refresh(true);
    assert.equal(calls, 6); assert.equal(applies, 1); assert.equal(button.disabled, false);
    resolves.forEach(resolve => resolve({ k: [], src: 'binance' }));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls, 6); assert.equal(builds, 0); assert.equal(applies, 1);
    // A new refresh is allowed and is not affected by the previous late completions.
    me.tickers24h = async () => { throw new Error('offline'); };
    await me.refresh(true);
    assert.equal(applies, 2); assert.equal(me.busy, false);
  });
  it('does not try a second exchange endpoint after cancellation', async () => {
    let calls = 0, requestSignal;
    const fetch = helper((url, opt) => { calls++; requestSignal = opt.signal; return never(); });
    const me = Function('ME_STAMP', 'fetchVenueJson', 'return (' + extractBalanced(html, 'const ME = {') + ')')(0, fetch);
    const parent = new AbortController();
    const request = me.get('/test', parent.signal);
    await Promise.resolve(); parent.abort();
    await assert.rejects(request, /market-cancelled/);
    assert.equal(calls, 1); assert.equal(requestSignal.aborted, true);
  });
});
