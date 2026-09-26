import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { ROOT } from './html.mjs';

export const LANGS = ['de', 'en', 'es', 'ar', 'zh'];
export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
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
  serverProc = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
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

export async function launchBrowser() {
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

export async function stubMarket(page) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (MARKET.test(url) && !/fonts\.googleapis|fonts\.gstatic|globalimmaturelunatic/.test(url)) {
      return req.abort().catch(() => {});
    }
    return req.continue().catch(() => {});
  });
}

export async function gotoLanding(page, { lang, viewport } = {}) {
  if (viewport) await page.setViewport(viewport);
  await stubMarket(page);
  const q = lang ? `?lang=${lang}` : '';
  await page.goto(BASE + '/index.html' + q, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.hero-title, .hero-landing', { timeout: 10000 });
}

export async function gotoApp(page, { lang, viewport, unlockThemes = false, storage, query, expectCards = true } = {}) {
  if (viewport) await page.setViewport(viewport);
  await stubMarket(page);
  const init = { unlockThemes, storage: storage || {} };
  await page.evaluateOnNewDocument((init) => {
    try {
      if (init.unlockThemes) localStorage.setItem('unlocked_themes', 'true');
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
