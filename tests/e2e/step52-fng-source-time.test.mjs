import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE, VIEWPORTS, liveTestCandles } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const html = read('app.html');
const instrumented = html.replace('    ME.refresh(false);', '    window.__fngTimeTest = { SentimentEngine, renderSignals };\n    ME.refresh(false);');
const source = 'https://alternative.me/crypto/fear-and-greed-index/';
const labels = { de: /TÄGLICHER BITCOIN/, en: /DAILY BITCOIN/, es: /ÍNDICE DIARIO DE BITCOIN/, ar: /مؤشر بيتكوين اليومي/, zh: /比特币每日指数/ };
let browser;
async function open(row, mobile = false) {
  const page = await freshPage(browser);
  if (mobile) await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
  const candles = liveTestCandles(), seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin && u.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return req.respond({status:200,contentType:'application/json',body:JSON.stringify(seed.map(s => ({symbol:s.pair.split(' / ')[0]+'USDT', quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()})))}).catch(() => {});
    if (u.pathname.endsWith('/klines')) return req.respond({status:200,contentType:'application/json',body:JSON.stringify(candles)}).catch(() => {});
    if (u.hostname === 'api.alternative.me') return req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [row] }) }).catch(() => {});
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__fngTimeTest && window.__fngTimeTest.SentimentEngine._fngController === null && document.querySelector(".signal-card"));
  return page;
}
const row = timestamp => ({ value: '63', value_classification: 'Greed', timestamp });
describe('step52 / source date, attribution and index expiry', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('shows the actual source UTC timestamp and attribution beside both displays in five languages on mobile', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 3600;
    const text = new Date(timestamp * 1000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
    const page = await open(row(String(timestamp)), true);
    try {
      for (const [lang, label] of Object.entries(labels)) {
        await page.select('#langSelect', lang);
        assert.match(await page.$eval('#globalSentLbl', el => el.textContent), label);
        assert.ok((await page.$eval('#globalFngBadge', el => el.textContent)).includes(text));
        assert.equal(await page.$eval('#globalFngBadge + a', el => el.href), source);
        await page.evaluate(() => { if (!document.querySelector('.sentiment-drawer-panel.is-open')) document.querySelector('[data-toggle-sentiment]').click(); });
        assert.ok((await page.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value', el => el.textContent)).includes(text));
        assert.equal(await page.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value + a', el => el.href), source);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `horizontal overflow: ${lang}`);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('does not show values without a usable, recent source timestamp', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const timestamp of [undefined, 'bad', String(now - 172801), String(now + 120)]) {
      const page = await open(row(timestamp));
      try {
        assert.equal(await page.$eval('#globalFngBadge', el => el.textContent.trim()), '● F&G –');
        await page.evaluate(() => document.querySelector('[data-toggle-sentiment]').click());
        assert.equal(await page.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value', el => el.textContent.trim()), '–');
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('expires a displayed value automatically in both the badge and open drawer', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 172800 + 5;
    const page = await open(row(String(timestamp)));
    try {
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /Index 63/);
      await page.evaluate(() => document.querySelector('[data-toggle-sentiment]').click());
      await page.waitForFunction(() => document.getElementById('globalFngBadge').textContent.includes('F&G –'), { timeout: 7000 });
      assert.equal(await page.$eval('.sentiment-drawer-panel.is-open .sentiment-fng-value', el => el.textContent.trim()), '–');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('clears expired or clock-invalid values on rerender and visibility without relying on timers', async () => {
    const page = await open(row(String(Math.floor(Date.now() / 1000))));
    try {
      await page.evaluate(() => {
        const engine = window.__fngTimeTest.SentimentEngine;
        engine.fngTimestamp = Date.now() - 172800000;
        window.__fngTimeTest.renderSignals();
      });
      assert.equal(await page.$eval('#globalFngBadge', el => el.textContent.trim()), '● F&G –');
      await page.evaluate(async () => { await window.__fngTimeTest.SentimentEngine.fetchLiveFearAndGreed(); });
      assert.match(await page.$eval('#globalFngBadge', el => el.textContent), /Index 63/);
      await page.evaluate(() => {
        const original = Date.now;
        Date.now = () => window.__fngTimeTest.SentimentEngine._fngReceivedAt - 1;
        document.dispatchEvent(new Event('visibilitychange'));
        Date.now = original;
      });
      assert.equal(await page.$eval('#globalFngBadge', el => el.textContent.trim()), '● F&G –');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
