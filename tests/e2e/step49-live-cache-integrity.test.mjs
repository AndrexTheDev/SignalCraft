import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const signals = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: `CACHE-VALID-${i}`, pair: `SAFE${i} / USDT`, live:true, modelVersion: 4,
  quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 }, gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
let browser;
async function withCache(data) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(data => {
    const t = Date.now();
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals: data.map(s => ({ ...s, timestamp: t })) }));
  }, data);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('btnRefreshSentimentGlobal').disabled);
  return page;
}
describe('step49 / malformed live cache in browser', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('never restores a structurally valid cache while a fresh update is pending', async () => {
    const page = await withCache(signals);
    try {
      assert.doesNotMatch(await page.$eval('#meBadge', el => el.textContent), /LIVE|DEMO/);
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('discards even a cache with an unknown indicator', async () => {
    const data = structuredClone(signals); data[0].gateMetrics.adx = null;
    const page = await withCache(data);
    try {
      assert.doesNotMatch(await page.$eval('#signalsGrid', el => el.textContent), /SAFE\d+/);
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  const faults = {
    'missing take-profit': (s, all) => { delete s.targets; },
    'inconsistent risk-reward': s => { s.riskRewardRatio = '1:99.9'; },
    'inconsistent score': s => { s.confluenceScore = 99; },
    'unknown quote currency': s => { s.pair = 'SAFE0 / USD'; },
    'duplicate asset': (s, all) => { s.pair = all[1].pair; },
    'corrupt candle': s => { s.k24 = []; },
    'no gate-qualified records': (s, all) => { all.forEach(x => { x.quantScore = 70; x.confluenceScore = 70; x.metrics.score = 70; }); }
  };
  for (const [name, mutate] of Object.entries(faults)) {
    it(`never displays a cached snapshot with ${name}`, async () => {
      const data = structuredClone(signals); mutate(data[0], data);
      const page = await withCache(data);
      try {
        assert.doesNotMatch(await page.$eval('#meBadge', el => el.textContent), /LIVE|DEMO/);
        assert.doesNotMatch(await page.$eval('#signalsGrid', el => el.textContent), /SAFE0/);
        assert.equal((await page.$$('.signal-card')).length, 0);
        assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
