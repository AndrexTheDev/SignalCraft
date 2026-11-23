import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const html = read('app.html');
const instrumented = html.replace('    ME.refresh(false);', '    window.__renderTest = { ME, signals: () => signalsData };\n    ME.refresh(false);');
const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
const base = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: 'SIG-RENDER-' + i, pair: 'SAFE' + i + ' / USDT', modelVersion: 3,
  quantScore: 90, confluenceScore: 90, metrics: { ...seed[0].metrics, score: 90 },
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
const payload = '<img data-injected src=x onerror="window.__injected=1">';
let browser;
async function open(data, lang = 'en') {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(signals => {
    const t = Date.now();
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals: signals.map(s => ({ ...s, timestamp: t })) }));
  }, data);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  return page;
}
describe('step50 / safe cached data rendering', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('rejects a cache containing markup in displayed numeric fields', async () => {
    for (const key of ['volMio', 'sma50', 'plusDi', 'riskAdj30']) {
      const data = structuredClone(base); data[0].metrics[key] = payload;
      const page = await open(data);
      try {
        assert.doesNotMatch(await page.$eval('#meBadge', e => e.textContent), /LIVE|DEMO/);
        assert.equal((await page.$$('.signal-card')).length, 0);
        assert.equal(await page.$$eval('[data-injected]', es => es.length), 0);
        assert.equal(await page.evaluate(() => window.__injected), undefined);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('rejects arbitrary numeric-field input at the live snapshot boundary', async () => {
    for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
      const page = await freshPage(browser);
      await stubMarket(page, {appHtml:instrumented, klines:liveTestCandles()});
      await page.goto(BASE + '/app.html?lang=' + lang, {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => document.querySelector('.signal-card'));
      try {
        assert.match(await page.$eval('#meBadge', e => e.textContent), /LIVE/);
        await page.evaluate(payload => {
          const { ME, signals } = window.__renderTest;
          const data = structuredClone(signals());
          for (const k of ['volMio', 'tb7', 'volX', 'rsi', 'perf7', 'perf30', 'atrPct', 'sma50', 'sma200', 'adx', 'plusDi', 'minusDi', 'bbWidthPct', 'riskAdj30']) data[0].metrics[k] = payload;
          ME.apply(data, 'live', ME.status.when);
        }, payload);
        assert.equal(await page.$eval('#dossierModalBackdrop', e => e.classList.contains('is-visible')), false);
        assert.equal((await page.$$('.signal-card')).length, 0);
        assert.equal(await page.$$eval('[data-injected]', es => es.length), 0);
        assert.equal(await page.evaluate(() => window.__injected), undefined);
        assert.equal(await page.evaluate(() => window.__renderTest.ME.status.mode), 'unavailable');
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
});
