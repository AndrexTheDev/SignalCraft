import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const signals = Array.from({ length: 100 }, (_, i) => ({ ...seed[0], pair: 'TEST' + i + ' / USDT', id: 'CACHE-' + i, modelVersion: 3, quantScore: 90, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 } }));
let browser;
async function setup() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => {
    const timer = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 9000 ? 300 : ms, ...args);
    const original = window.fetch.bind(window);
    window.fetch = (url, options) => {
      url = String(url);
      if (url.includes('/ticker/24hr')) return Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
      if (/^https?:/.test(url) && !url.startsWith(location.origin)) return Promise.reject(new Error('offline'));
      return original(url, options);
    };
  });
  await page.goto(BASE + '/index.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.evaluate(signals => localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }))(Date.now()))), signals);
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('btnRefreshSentimentGlobal').disabled);
  assert.equal((await page.$$('.signal-card')).length, 0);
  return page;
}
describe('step44 / cached snapshot recovery', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('does not revive an old LIVE cache on reload after an automatic failed refresh', async () => {
    const page = await setup();
    try {
      await page.waitForFunction(() => /unavailable/i.test(document.getElementById('meBadge')?.textContent || '') && !document.getElementById('btnRefreshSentimentGlobal').disabled);
      assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => /unavailable/i.test(document.getElementById('meBadge').textContent));
      assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('preserves a newer cache written by another tab during an unsuccessful refresh', async () => {
    const page = await setup();
    const other = await freshPage(browser);
    try {
      await other.goto(BASE + '/index.html?lang=en', { waitUntil: 'domcontentloaded' });
      const replacement = await other.evaluate(signals => {
        const t = Date.now();
        const value = JSON.stringify({ version: 9, t, signals: signals.map(s => ({ ...s, id: 'NEW-' + s.id, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) });
        localStorage.setItem('signalcraft_live_v2', value);
        return value;
      }, signals);
      await page.waitForFunction(() => /unavailable/i.test(document.getElementById('meBadge')?.textContent || '') && !document.getElementById('btnRefreshSentimentGlobal').disabled);
      assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), replacement);
      assert.deepEqual(page._pageErrors, []);
    } finally { await other.close(); await page.close(); }
  });
});
