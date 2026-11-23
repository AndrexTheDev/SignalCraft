import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, extractBalanced } from './helpers/html.mjs';
import { priceChange, factorWindowComputable } from './helpers/core-logic.mjs';

const app = read('app.html');
function loadFunction(name, dependencies = '') {
  const body = extractBalanced(app, 'function ' + name + '(');
  assert.ok(body, 'missing ' + name);
  const start = app.indexOf('function ' + name + '(');
  const signature = app.slice(start, app.indexOf('{', start));
  return Function(dependencies + '; return ' + signature + body)();
}
const parseMarketNumber = loadFunction('parseMarketNumber');
const validModelCandles = loadFunction('validModelCandles', `const parseMarketNumber = ${parseMarketNumber.toString()}; const priceChange = ${priceChange.toString()}; const factorWindowComputable = ${factorWindowComputable.toString()}`);
const qualityScore = loadFunction('qualityScore');
const parse24hTickers = loadFunction('parse24hTickers', `const parseMarketNumber = ${parseMarketNumber.toString()}`);
const candlesAreCurrent = loadFunction('candlesAreCurrent');
const validLongPlan = loadFunction('validLongPlan');
const roundTargetUp = loadFunction('roundTargetUp');
const fmtP = loadFunction('fmtP');
const takerSplitText = loadFunction('takerSplitText');
const buyPressure = loadFunction('buyPressure');
const passesQualityGate = loadFunction('passesQualityGate', `const BOARD_MIN = 86; const qualityScore = ${qualityScore.toString()}`);
function candles() {
  return Array.from({ length: 200 }, (_, i) => { const time = (20000 + i) * 86400000; return [time, '10', '12', '9', '11', '0', time + 86400000 - 1, '100', '0', '0', '60']; });
}

describe('step34 / market data integrity', () => {
  it('requires ordered valid candles with genuine taker-volume values', () => {
    assert.equal(validModelCandles(candles()), true);
    assert.equal(validModelCandles(candles().slice(1)), false, 'SMA200 requires 200 daily candles');
    const gap = candles(); gap[100][0] += 86400000; gap[100][6] += 86400000;
    assert.equal(validModelCandles(gap), false, 'gaps and duplicate days are rejected');
    const badClose = candles(); badClose[100][6]--;
    assert.equal(validModelCandles(badClose), false, 'candle intervals must match UTC days');
    const shifted = candles().map(row => { row[0] += 3600000; row[6] += 3600000; return row; });
    assert.equal(validModelCandles(shifted), false, 'daily bars must be UTC aligned');
    const missingPrior = candles(); missingPrior.slice(-7, -3).forEach(row => { row[7] = '0'; row[10] = '0'; });
    assert.equal(validModelCandles(missingPrior), false, 'prior taker ratio needs positive volume');
    const inactive = candles(); inactive[2][7] = '0'; inactive[2][10] = '0';
    assert.equal(validModelCandles(inactive), true, 'an old zero-volume candle is valid');
    inactive[inactive.length - 1][7] = '0'; inactive[inactive.length - 1][10] = '0';
    assert.equal(validModelCandles(inactive), false, 'current volume must be positive');
    const emptyHistory = candles(); emptyHistory.slice(-31, -1).forEach(row => { row[7] = '0'; row[10] = '0'; });
    assert.equal(validModelCandles(emptyHistory), false, '30-day comparison volume must be positive');
    for (const mutate of [
      rows => { rows[2][10] = null; },
      rows => { rows[2][10] = ''; },
      rows => { rows[2][10] = '101'; },
      rows => { rows[2][7] = '0'; },
      rows => { rows[2][2] = '9'; },
      rows => { rows[2][0] = rows[1][0]; },
      rows => { rows[2][4] = 'NaN'; }
    ]) {
      const rows = candles(); mutate(rows);
      assert.equal(validModelCandles(rows), false);
    }
  });

  it('live gate checks unrounded metrics and fails closed when a metric is missing', () => {
    const sig = { quantScore: 90, modelVersion: 3, gateMetrics: { rsi: 75, volMio: 10, adx: 15, riskAdj30: 0.001 } };
    assert.equal(passesQualityGate(sig), true);
    for (const [key, value] of [['rsi', 75.01], ['volMio', 9.999], ['adx', 14.99], ['riskAdj30', 0], ['adx', null], ['rsi', NaN]]) {
      const altered = { ...sig, gateMetrics: { ...sig.gateMetrics, [key]: value } };
      assert.equal(passesQualityGate(altered), false, key + ': ' + value);
    }
    assert.equal(passesQualityGate({ quantScore: 90, modelVersion: 3 }), false);
    assert.equal(passesQualityGate({ quantScore: 90, metrics: { rsi: 70, volMio: 20 } }), true, 'legacy demo is unchanged');
  });

  it('rejects missing, malformed and stale tickers and stale daily candles', () => {
    const now = 1_800_000_000_000;
    const valid = { symbol: 'BTCUSDT', quoteVolume: '9999999.9', priceChangePercent: '-12.3', closeTime: now };
    assert.deepEqual(parse24hTickers([valid], now).BTCUSDT, { volume: 9999999.9, change: -12.3, time: now });
    for (const override of [{ quoteVolume: null }, { quoteVolume: '' }, { quoteVolume: '-1' }, { priceChangePercent: 'NaN' }, { closeTime: now - 300001 }, { closeTime: now + 60001 }, { symbol: 'BTCUSD' }]) {
      assert.equal(Object.keys(parse24hTickers([{ ...valid, ...override }], now)).length, 0);
    }
    assert.equal(Object.keys(parse24hTickers({}, now)).length, 0);
    assert.equal(candlesAreCurrent([[now - 1000]], now), true);
    assert.equal(candlesAreCurrent([[now - 86400000]], now), false);
    assert.equal(candlesAreCurrent([[now + 1]], now), false);
  });

  it('does not create invalid or misleading rounded LONG trade plans', () => {
    assert.equal(validLongPlan(100, 90, 110, 120), true);
    for (const price of [1.23456, 0.000123456, 123456.7, 20, 0.000002]) {
      assert.ok(roundTargetUp(price) >= price, 'target rounds upward: ' + price);
    }
    assert.ok(Number.isNaN(roundTargetUp(-1)));
    for (const levels of [[100, -1, 110, 120], [100, 100, 101, 102], [100, 90, 100, 120], [100, 90, 110, 119.99], [100, 90, 110, 109], [NaN, 90, 110, 120]]) {
      assert.equal(validLongPlan(...levels), false, levels.join(','));
    }
    assert.notEqual(fmtP(1.2345), fmtP(1.2344), 'meaningful levels do not collapse to the same cents');
    assert.notEqual(fmtP(0.0000000000001), fmtP(0), 'very small nonzero values stay visible');
    assert.equal(fmtP(null), '-');
    assert.equal(fmtP(''), '-');
  });

  it('shows observed taker shares rather than an inferred sentiment split', () => {
    assert.equal(takerSplitText(52.9), '52.9% / 47.1%');
    assert.equal(takerSplitText(0), '0.0% / 100.0%');
    assert.equal(takerSplitText(100), '100.0% / 0.0%');
    for (const invalid of [null, undefined, NaN, Infinity, -1, 100.1, '50']) assert.equal(takerSplitText(invalid), '—');
    assert.equal(buyPressure(50, 1, 0), 50);
    assert.equal(buyPressure(50, 1, 10), 53);
    assert.doesNotMatch(buyPressure.toString(), /fng|fear|greed/i);
    assert.doesNotMatch(app.slice(app.indexOf('toSignal(b, rank, snapshotAt)'), app.indexOf('apply(list, mode, when)')), /bullPct|bearPct/);
  });

  it('does not fabricate taker volume from fallback candles or venue counts', () => {
    const start = app.indexOf('async kGet(sym, sources, signal, buildCandidate)');
    assert.notEqual(start, -1);
    const end = app.indexOf('rsi(c, p)', start);
    assert.ok(end > start);
    const source = app.slice(start, end);
    assert.doesNotMatch(source, /q\s*\/\s*2|api\.kraken\.com|market\/candles/);
    assert.doesNotMatch(app, /sig\.cexN\s*\|\|\s*11/);
    assert.match(app, /ca\.version === 9/);
    assert.match(app, /snapshotIsFresh\(ca\.t, Date\.now\(\), this\.TTL\)/);
  });
});
