import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const signals = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: `SIG-HIGH-${i}`, pair: (i ? 'TEST' + i : 'TEST') + ' / USDT', timestamp: Date.now(),
  quantScore: 90, confluenceScore: 90, modelVersion: 3,
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 },
  metrics: { ...seed[0].metrics, hi90d: 50 }
}));
const cases = {
  de: [/Anstieg bis zum 90T-Hoch: 50%/, /Anstieg bis 90T-Hoch/, /letzter Kerzenschluss/, /nicht der Rückgang/],
  en: [/rise to 90-day high: 50%/, /Rise to 90d high/, /latest candle close/, /not the decline/],
  es: [/subida al máximo de 90d: 50%/, /Subida hasta el máximo de 90d/, /último cierre de vela/, /no es la caída/],
  ar: [/الارتفاع إلى قمة 90 يوماً: 50%/, /الارتفاع إلى قمة 90 يوماً/, /آخر إغلاق للشمعة/, /وليست نسبة الهبوط/],
  zh: [/涨至90日高点所需涨幅：50%/, /涨至90日高点所需涨幅/, /最近一根蜡烛收盘价/, /不是从高点下跌/]
};
let browser;
async function livePage(lang, values = signals, mode = 'LIVE') {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(s => localStorage.setItem('signalcraft_live_v2', JSON.stringify(((t) => ({ version: 9, t, signals: s.map(item => ({ ...item, confluenceScore: item.quantScore, metrics: { ...item.metrics, score: item.quantScore }, timestamp: t })) }))(Date.now()))), values);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = new URL(req.url());
    if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (u.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(expected => (document.getElementById('meBadge')?.textContent || '').includes(expected), {}, mode);
  return page;
}
describe('step39 / high-distance UI', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('explains the percentage consistently in the card and dossier in five languages', async () => {
    for (const [lang, [note, label, denominator, notDecline]] of Object.entries(cases)) {
      const page = await livePage(lang);
      try {
        assert.match(await page.$eval('.signal-card .sc-thesis', el => el.textContent), note);
        await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
        assert.match(await page.$eval('[data-high90]', el => el.textContent), label);
        assert.match(await page.$eval('[data-high90]', el => el.textContent), /50%/);
        const help = await page.$eval('[data-high90-help]', el => el.textContent);
        assert.match(help, denominator); assert.match(help, notDecline); assert.match(help, /UTC/);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('also fixes the German demo wording and fails closed on invalid cached metrics', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
      await page.setRequestInterception(true);
      page.on('request', req => {
        const u = new URL(req.url());
        if (u.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        if (u.pathname.endsWith('/ticker/24hr')) return;
        return req.abort().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=de', { waitUntil: 'domcontentloaded' });
      assert.match(await page.$eval('.signal-card .sc-thesis', el => el.textContent), /Anstieg bis zum 90T-Hoch/);
      assert.doesNotMatch(await page.$eval('.signal-card .sc-thesis', el => el.textContent), /unter 90T-Hoch/);
    } finally { await page.close(); }
    const bad = signals.map(s => ({...s, metrics: {...s.metrics, hi90d: '<img src=x onerror=alert(1)>'} }));
    const page2 = await livePage('en', bad, 'DEMO');
    try {
      await page2.evaluate(() => document.querySelector('[data-inspect-sig]').click());
      assert.doesNotMatch(await page2.$eval('.sc-asset-title', el => el.textContent), /TEST/);
      assert.doesNotMatch(await page2.$eval('[data-high90]', el => el.textContent), /<img/);
      assert.match(await page2.$eval('#meBadge', el => el.textContent), /DEMO/);
      assert.equal(await page2.$$eval('#dossierBody img', els => els.length), 0);
      assert.deepEqual(page2._pageErrors, []);
    } finally { await page2.close(); }
  });
});
