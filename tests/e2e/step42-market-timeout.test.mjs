import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const signals = Array.from({ length: 100 }, (_, i) => ({ ...seed[0], pair: 'TEST' + i + ' / USDT', id: 'SIG-TIME-' + i, modelVersion: 3, quantScore: 90, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
let browser;
describe('step42 / stalled live market responses', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('falls back from cached LIVE to DEMO and releases refresh after response bodies stall', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(signals => {
        localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }))(Date.now())));
        const timer = window.setTimeout.bind(window);
        window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 9000 ? 200 : ms, ...args);
        const original = window.fetch.bind(window);
        window.fetch = (url, options) => {
          if (String(url).includes('/ticker/24hr')) return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
          if (/^https?:/.test(String(url)) && !String(url).startsWith(location.origin)) return Promise.reject(new Error('offline'));
          return original(url, options);
        };
      }, signals);
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
      assert.equal(await page.$eval('#btnRefreshSentimentGlobal', el => el.disabled), true);
      await page.waitForFunction(() => /DEMO/.test(document.getElementById('meBadge')?.textContent || '') && !document.getElementById('btnRefreshSentimentGlobal').disabled, { timeout: 5000 });
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled && /DEMO snapshot active/.test(document.getElementById('toastMessage')?.textContent || ''), { timeout: 5000 });
      assert.equal(await page.$eval('#btnRefreshSentimentGlobal', el => el.hasAttribute('aria-busy')), false);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
