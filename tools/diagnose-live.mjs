#!/usr/bin/env node
// Real-network browser diagnostic. Does not mock requests or persist responses.
import { pathToFileURL } from 'node:url';
import { launchBrowser, startServer, stopServer } from '../tests/helpers/browser.mjs';

const HOSTS = new Set([
  'data-api.binance.vision', 'api.binance.com', 'api.binance.us', 'www.okx.com',
  'api.bybit.com', 'api.kraken.com', 'api.kucoin.com', 'api.gateio.ws',
  'api.mexc.com', 'api.bitget.com', 'api.huobi.pro', 'api.crypto.com',
  'api.coinbase.com', 'api.hyperliquid.xyz', 'indexer.dydx.trade',
  'api.dexscreener.com', 'api.alternative.me'
]);

// An optional, explicitly requested bounded probe includes endpoints the empty board never calls.
export const PROBES = [
  ...['data-api.binance.vision', 'api.binance.com', 'api.binance.us'].flatMap(host => [
    { name: host + ' ticker', url: `https://${host}/api/v3/ticker/24hr?symbol=BTCUSDT`, kind: 'ticker' },
    { name: host + ' candles', url: `https://${host}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=200`, kind: 'candles' }
  ]),
  { name: 'Binance radar', url: 'https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT', kind: 'price' },
  { name: 'OKX', url: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT', kind: 'dataArray' },
  { name: 'Bybit', url: 'https://api.bybit.com/v5/market/tickers?category=spot', kind: 'bybit' },
  { name: 'Kraken', url: 'https://api.kraken.com/0/public/Ticker', kind: 'kraken' },
  { name: 'KuCoin', url: 'https://api.kucoin.com/api/v1/market/allTickers', kind: 'kucoin' },
  { name: 'Gate.io', url: 'https://api.gateio.ws/api/v4/spot/tickers', kind: 'array' },
  { name: 'MEXC', url: 'https://api.mexc.com/api/v3/ticker/price', kind: 'array' },
  { name: 'Bitget', url: 'https://api.bitget.com/api/v2/spot/market/tickers', kind: 'dataArray' },
  { name: 'HTX', url: 'https://api.huobi.pro/market/tickers', kind: 'dataArray' },
  { name: 'Crypto.com', url: 'https://api.crypto.com/exchange/v1/public/get-tickers', kind: 'crypto' },
  { name: 'Coinbase', url: 'https://api.coinbase.com/v2/prices/BTC-USDT/spot', kind: 'coinbase' },
  { name: 'Hyperliquid', url: 'https://api.hyperliquid.xyz/info', method: 'POST', body: '{"type":"allMids"}', kind: 'mids' },
  { name: 'dYdX', url: 'https://indexer.dydx.trade/v4/perpetualMarkets', kind: 'markets' },
  { name: 'DexScreener', url: 'https://api.dexscreener.com/latest/dex/search?q=BTC', kind: 'pairs' },
  { name: 'Alternative.me', url: 'https://api.alternative.me/fng/?limit=1', kind: 'dataArray' }
];

export function endpointKey(address, method) {
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) return null;
    // Never log query strings (symbols, or any unexpected private data).
    return `${method} ${url.hostname}${url.pathname}`;
  } catch { return null; }
}

export function createCollector() {
  const records = new Map(), requests = new WeakMap();
  function record(key) {
    if (!records.has(key)) records.set(key, { requests: 0, statuses: {}, failed: {} });
    return records.get(key);
  }
  return {
    request(req) {
      const key = endpointKey(req.url(), req.method());
      if (!key) return;
      requests.set(req, key); record(key).requests++;
    },
    response(res) {
      const key = requests.get(res.request());
      if (!key) return;
      const statuses = record(key).statuses, status = String(res.status());
      statuses[status] = (statuses[status] || 0) + 1;
    },
    failed(req) {
      const key = requests.get(req);
      if (!key) return;
      // Browser error codes are useful observations, not a diagnosis of CORS or geoblocking.
      const error = req.failure()?.errorText || 'unknown';
      const code = /^net::ERR_[A-Z0-9_]+$/.test(error) ? error : 'other';
      const failures = record(key).failed; failures[code] = (failures[code] || 0) + 1;
    },
    report() { return Object.fromEntries([...records.entries()].sort(([a], [b]) => a.localeCompare(b))); }
  };
}

async function main() {
  let browser;
  const args = process.argv.slice(2);
  let address = null, probe = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--probe' && !probe) probe = true;
    else if (args[i] === '--url' && !address && args[i + 1]) address = args[++i];
    else throw new Error('Usage: npm run diagnose:live [-- --probe] [-- --url https://example.com/app]');
  }
  let target;
  if (address) {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || !['/app', '/app.html'].includes(url.pathname)) throw new Error('URL must be an HTTPS app URL without credentials.');
    url.search = '?lang=en'; url.hash = ''; target = url.toString();
  } else {
    target = (await startServer()) + '/app?lang=en';
  }
  try {
    if (process.env.CHROME_PATH) {
      const puppeteer = (await import('puppeteer-core')).default;
      browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    } else browser = await launchBrowser();
    const page = await browser.newPage();
    const collector = createCollector();
    page.on('request', r => collector.request(r));
    page.on('response', r => collector.response(r));
    page.on('requestfailed', r => collector.failed(r));
    const start = Date.now();
    const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!response || !response.ok()) throw new Error('App page HTTP status: ' + (response?.status() ?? 'unknown'));
    let completed = true;
    try {
      await page.waitForFunction(() => {
        const button = document.getElementById('btnRefreshSentimentGlobal');
        const info = document.getElementById('snapshotInfo');
        return button && info && info.textContent.trim() && button.getAttribute('aria-busy') !== 'true';
      }, { timeout: 75000 });
    } catch { completed = false; }
    // Radar requests start after the market snapshot; allow their bounded fetches to finish.
    if (completed) await new Promise(resolve => setTimeout(resolve, 10000));
    const ui = await page.evaluate(() => {
      const text = id => document.getElementById(id)?.textContent.trim() || '';
      return { market: text('meBadge'), snapshot: text('snapshotInfo'), activeSignals: text('statActiveCount'),
        visibleCards: document.querySelectorAll('.signal-card').length, cex: text('cexTickerLabel'),
        dex: text('dexTickerLabel'), fearGreed: text('globalFngBadge') };
    });
    const probes = probe ? await page.evaluate(async definitions => {
      const shapes = {
        ticker: d => d && d.symbol === 'BTCUSDT' && d.closeTime != null && d.quoteVolume != null,
        candles: d => Array.isArray(d) && d.length >= 200 && d.every(row => Array.isArray(row) && row.length >= 11),
        price: d => d && d.symbol === 'BTCUSDT' && d.price != null,
        array: d => Array.isArray(d) && d.length > 0,
        dataArray: d => Array.isArray(d?.data) && d.data.length > 0,
        bybit: d => Array.isArray(d?.result?.list) && d.result.list.length > 0,
        kraken: d => Array.isArray(d?.error) && !d.error.length && !!d.result && Object.keys(d.result).length > 0,
        kucoin: d => Array.isArray(d?.data?.ticker) && d.data.ticker.length > 0,
        crypto: d => Array.isArray(d?.result?.data) && d.result.data.length > 0,
        coinbase: d => d?.data?.base === 'BTC' && d.data.currency === 'USDT' && d.data.amount != null,
        mids: d => !!d && !Array.isArray(d) && typeof d === 'object' && Object.keys(d).length > 0,
        markets: d => !!d?.markets && Object.values(d.markets).some(m => m?.status === 'ACTIVE'),
        pairs: d => Array.isArray(d?.pairs)
      };
      const results = await Promise.all(definitions.map(async def => {
        const started = performance.now(), controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        try {
          const options = { signal: controller.signal };
          if (def.method === 'POST') Object.assign(options, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: def.body });
          const response = await fetch(def.url, options);
          if (!response.ok) return { name: def.name, status: response.status, shape: false, elapsedMs: Math.round(performance.now() - started) };
          const data = await response.json();
          return { name: def.name, status: response.status, shape: !!shapes[def.kind](data), elapsedMs: Math.round(performance.now() - started) };
        } catch (error) {
          return { name: def.name, status: null, shape: false, error: error?.name === 'AbortError' ? 'timeout' : 'fetch-or-json-error', elapsedMs: Math.round(performance.now() - started) };
        } finally { clearTimeout(timer); }
      }));
      return results;
    }, PROBES) : null;
    console.log(JSON.stringify({ targetOrigin: new URL(target).origin, startedAt: new Date(start).toISOString(),
      elapsedMs: Date.now() - start, refreshCompleted: completed, ui, endpoints: collector.report(), probes,
      note: 'Real requests from this browser and network only. A basic shape check does not prove freshness, full model validity or availability of every pair. Failures do not identify their cause. Query strings and response bodies are not logged.' }, null, 2));
    if (!completed) process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
    stopServer();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error('Live diagnostic failed:', error.message); process.exitCode = 1; stopServer(); });
}
