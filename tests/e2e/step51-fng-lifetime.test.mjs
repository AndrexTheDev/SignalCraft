import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html');
// Only observe real engine calls; all market failures still go through the real refresh path.
const instrumented = app.replace('    ME.refresh(false);', `    window.__fngTest = { ME, SentimentEngine, manualCalls: 0 };
    const originalRefreshForTest = ME.refresh.bind(ME);
    ME.refresh = function(manual) { if (manual) window.__fngTest.manualCalls++; return originalRefreshForTest(manual); };
    ME.refresh(false);`);
let browser;
async function open() {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(() => {
    localStorage.removeItem('signalcraft_live_v2');
    const realFetch = window.fetch.bind(window);
    window.__pendingIndexBodies = [];
    window.fetch = (url, options) => {
      if (String(url).includes('api.alternative.me/fng/')) {
        return Promise.resolve({ ok: true, json: () => new Promise(resolve => window.__pendingIndexBodies.push(resolve)) });
      }
      return realFetch(url, options);
    };
  });
  await page.setRequestInterception(true);
  // Serve a test-only instrumented HTML copy; external market endpoints fail quickly.
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('btnRefreshSentimentGlobal').disabled && window.__pendingIndexBodies.length === 1);
  return page;
}
function body(value, classification = 'Greed') { return { data: [{ value: String(value), value_classification: classification, timestamp: String(Math.floor(Date.now() / 1000)) }] }; }
describe('step51 / Fear & Greed and market refresh in browser', { timeout: 45000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('starts the actual market refresh without waiting for a stalled index body; newer answers win', async () => {
    const page = await open();
    try {
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => window.__fngTest.manualCalls === 1 && window.__pendingIndexBodies.length === 2);
      await page.waitForFunction(() => !window.__fngTest.ME.busy);
      assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /unavailable/i);
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /F&G –/);
      await page.evaluate(({ current, older }) => {
        window.__pendingIndexBodies[1](current);
        window.__pendingIndexBodies[0](older);
      }, { current: body(71), older: body(12, 'Fear') });
      await page.waitForFunction(() => document.getElementById('globalFngBadge').textContent.includes('71'));
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /^● Index 71/);
      assert.equal(await page.$('[data-toggle-sentiment]'), null);
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => window.__fngTest.manualCalls === 2 && window.__pendingIndexBodies.length === 3);
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /F&G –/);
      await page.evaluate(value => window.__pendingIndexBodies[2](value), body(55, 'Neutral'));
      await page.waitForFunction(() => document.getElementById('globalFngBadge').textContent.includes('55'));
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('times out an uncooperative response body and ignores a later result', async () => {
    const page = await open();
    try {
      await page.waitForFunction(() => window.__fngTest.SentimentEngine._fngController === null, { timeout: 7000 });
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /F&G –/);
      await page.evaluate(value => window.__pendingIndexBodies[0](value), body(99));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /F&G –/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
