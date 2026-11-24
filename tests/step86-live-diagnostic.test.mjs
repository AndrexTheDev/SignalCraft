import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { endpointKey, createCollector, PROBES } from '../tools/diagnose-live.mjs';

describe('step86 / real browser diagnostic aggregation', () => {
  it('limits observations to known HTTPS APIs and strips query strings', () => {
    assert.equal(endpointKey('https://api.dexscreener.com/latest/dex/search?q=BTC&secret=private', 'GET'), 'GET api.dexscreener.com/latest/dex/search');
    assert.equal(endpointKey('https://api.hyperliquid.xyz/info', 'POST'), 'POST api.hyperliquid.xyz/info');
    assert.equal(endpointKey('https://api.binance.com.evil.example/api/v3/klines', 'GET'), null);
    assert.equal(endpointKey('http://api.binance.com/api/v3/klines', 'GET'), null);
  });
  it('uses only documented HTTPS endpoints, including the exact Hyperliquid POST body', () => {
    assert.equal(PROBES.length, 21);
    for (const p of PROBES) assert.ok(endpointKey(p.url, p.method || 'GET'), p.name);
    const hyper = PROBES.find(p => p.name === 'Hyperliquid');
    assert.equal(hyper.method, 'POST'); assert.deepEqual(JSON.parse(hyper.body), { type: 'allMids' });
    for (const host of ['data-api.binance.vision', 'api.binance.com', 'api.binance.us']) {
      assert.equal(PROBES.filter(p => p.name.startsWith(host + ' ')).length, 2);
    }
  });
  it('records statuses and browser failure codes without inventing causes', () => {
    const collector = createCollector();
    const req = { url: () => 'https://api.binance.us/api/v3/klines?symbol=BTCUSDT', method: () => 'GET', failure: () => ({ errorText: 'net::ERR_FAILED' }) };
    collector.request(req);
    collector.response({ request: () => req, status: () => 451 });
    collector.failed(req);
    assert.deepEqual(collector.report(), { 'GET api.binance.us/api/v3/klines': { requests: 1, statuses: { 451: 1 }, failed: { 'net::ERR_FAILED': 1 } } });
    const ignored = { url: () => 'https://evil.example/', method: () => 'GET' };
    collector.request(ignored);
    assert.equal(Object.keys(collector.report()).length, 1);
  });
});
