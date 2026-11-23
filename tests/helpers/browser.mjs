import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { ROOT, read, extractArray } from './html.mjs';

export const LANGS = ['de', 'en', 'es', 'ar', 'zh'];
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  wide: { width: 1920, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
  mobileSm: { width: 360, height: 740 }
};

const MARKET = /binance|bybit|kraken|okx|kucoin|mexc|bitget|huobi|gateio|crypto\.com|coinbase|alternative\.me|dexscreener|hyperliquid|dydx|binance\.vision|binance\.us/i;

let serverProc = null;
export let BASE = 'http://127.0.0.1:4173';

function portFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port, '127.0.0.1');
  });
}

export async function startServer() {
  if (serverProc) return BASE;
  let port = 4173;
  if (!(await portFree(port))) port = 4174;
  BASE = `http://127.0.0.1:${port}`;
  serverProc = spawn('python3', ['tools/serve.py', '--port', String(port), '--bind', '127.0.0.1'], {
    cwd: ROOT,
    stdio: 'ignore'
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(BASE + '/index.html');
      if (r.ok) return BASE;
    } catch {}
    await new Promise((x) => setTimeout(x, 80));
  }
  throw new Error('http server failed to start');
}

export function stopServer() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
}

async function ensureSystemLibs() {
  // @sparticuz/chromium's bundled al2023 libs must be extracted once per
  // sandbox (they land in /tmp, which does not survive restarts). Without
  // them Chromium fails to launch with "libnspr4.so: cannot open shared object".
  try {
    const fs = await import('node:fs');
    if (fs.existsSync('/tmp/al2023/lib/libnss3.so') && fs.existsSync('/tmp/al2023/lib/libnspr4.so')) return;
    // NOTE: the package exports map hides ./build/lambdafs.js — import by file URL
    const path = await import('node:path');
    const { pathToFileURL } = await import('node:url');
    const base = path.join(ROOT, 'node_modules', '@sparticuz', 'chromium');
    const lambdafs = pathToFileURL(path.join(base, 'build', 'lambdafs.js')).href;
    const tar = path.join(base, 'bin', 'al2023.tar.br');
    const { inflate } = await import(lambdafs);
    await inflate(tar);
  } catch (e) {
    // best effort: if extraction fails the launch error will carry the reason
    console.error('chromium system libs setup failed:', e && e.message ? e.message : e);
  }
}

export async function launchBrowser() {
  await ensureSystemLibs();
  process.env.LD_LIBRARY_PATH = ['/tmp/al2023/lib', '/tmp', process.env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = (await import('puppeteer-core')).default;
  chromium.setGraphicsMode = false;
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: [...chromium.args, '--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
    defaultViewport: VIEWPORTS.desktop,
    executablePath,
    headless: 'shell',
    env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH }
  });
  return browser;
}

// Synthetic exchange responses are test-only; production never loads this data.
export function liveTestCandles() {
  const DAY = 86400000, t0 = Math.floor(Date.now() / DAY) * DAY - 199 * DAY, out = [];
  let price = 100;
  for (let t = 0; t < 200; t++) {
    const p = t / 199, ret = 0.0045 + 0.016 * Math.sin(t * 0.9) + 0.0088 * Math.sin(t * 1.9 + 1.7) + 0.0048 * Math.sin(t * 3.1 + 0.4);
    const q = 20e6 + 100e6 * p * p, ratio = 0.44 + 0.22 * p;
    price = Math.max(1, price * (1 + ret));
    const c = price, o = c / (1 + ret), h = Math.max(c, o) * 1.007, l = Math.min(c, o) * 0.993;
    out.push([t0+t*DAY,+o.toFixed(6),+h.toFixed(6),+l.toFixed(6),+c.toFixed(6),+(q/c).toFixed(4),t0+t*DAY+DAY-1,+q.toFixed(2),1000+t,+((q*ratio)/c).toFixed(4),+(q*ratio).toFixed(2),0]);
  }
  return out;
}

export async function stubMarket(page, opts = {}) {
  const fng = opts && opts.fng ? opts.fng : null;
  const klines = opts && opts.klines ? opts.klines : null;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (opts.appHtml && url.startsWith(BASE + '/app.html')) return req.respond({ status: 200, contentType: 'text/html', body: opts.appHtml }).catch(() => {});
    if (klines && /\/ticker\/24hr(?:\?|$)/.test(url)) {
      const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
      const isUs = url.includes('api.binance.us');
      const values = isUs ? (opts.usTicker || {}) : (opts.globalTicker || {});
      const body = values.missing ? [] : seed.map(s => ({ symbol: s.pair.split(' / ')[0] + 'USDT', quoteVolume: String(values.quoteVolume ?? opts.quoteVolume ?? klines[klines.length - 1][7]), priceChangePercent: String(values.priceChangePercent ?? opts.priceChangePercent ?? 1), closeTime: Date.now() + (values.timeOffset || 0) }));
      return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    }
    if (klines && /\/klines\?/.test(url)) {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(klines)
      }).catch(() => {});
    }
    if (fng && /alternative\.me\/fng/.test(url)) {
      return req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [{ value: String(fng.value), value_classification: fng.classification || 'Neutral', timestamp: String(fng.timestamp ?? Math.floor(Date.now() / 1000)) }] })
      }).catch(() => {});
    }
    if (MARKET.test(url) && !/fonts\.googleapis|fonts\.gstatic|globalimmaturelunatic/.test(url)) {
      return req.abort().catch(() => {});
    }
    return req.continue().catch(() => {});
  });
}

export async function gotoLanding(page, { lang, viewport, fng, marketKlines } = {}) {
  if (viewport) await page.setViewport(viewport);
  await stubMarket(page, { fng, klines: marketKlines });
  const q = lang ? `?lang=${lang}` : '';
  await page.goto(BASE + '/index.html' + q, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.hero-title, .hero-landing', { timeout: 10000 });
}

export async function gotoApp(page, { lang, viewport, storage, query, expectCards = true, fng, appHtml } = {}) {
  if (viewport) await page.setViewport(viewport);
  await stubMarket(page, { fng, klines: expectCards ? liveTestCandles() : null, appHtml });
  const init = { storage: storage || {} };
  await page.evaluateOnNewDocument((init) => {
    try {
      Object.entries(init.storage || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    } catch (e) {}
  }, init);
  const params = new URLSearchParams();
  if (lang) params.set('lang', lang);
  if (query) Object.entries(query).forEach(([k, v]) => params.set(k, v));
  const qs = params.toString() ? '?' + params.toString() : '';
  await page.goto(BASE + '/app.html' + qs, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('#signalsGrid', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 750));
  const gate = await page.$('.adgate-card');
  if (gate) throw new Error('Ad-block gate visible (false positive)');
  if (expectCards) await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15000 });
}

export async function freshPage(browser) {
  const page = await browser.newPage();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page._pageErrors = errors;
  return page;
}
