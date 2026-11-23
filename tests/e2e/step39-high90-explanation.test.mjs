import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const app = read('app.html').replace('    ME.refresh(false);', '    window.__high39 = {ME, signals: () => signalsData}; ME.refresh(false);');
const cases = {
  de: [/Anstieg bis zum 90T-Hoch: 50%/, /Anstieg bis 90T-Hoch/, /letzter Kerzenschluss/, /nicht der Rückgang/],
  en: [/rise to 90-day high: 50%/, /Rise to 90d high/, /latest candle close/, /not the decline/],
  es: [/subida al máximo de 90d: 50%/, /Subida hasta el máximo de 90d/, /último cierre de vela/, /no es la caída/],
  ar: [/الارتفاع إلى قمة 90 يوماً: 50%/, /الارتفاع إلى قمة 90 يوماً/, /آخر إغلاق للشمعة/, /وليست نسبة الهبوط/],
  zh: [/涨至90日高点所需涨幅：50%/, /涨至90日高点所需涨幅/, /最近一根蜡烛收盘价/, /不是从高点下跌/]
};
let browser;
async function livePage(lang) {
  const page = await freshPage(browser);
  await stubMarket(page, {appHtml:app, klines:liveTestCandles()});
  await page.goto(BASE + '/app.html?lang=' + lang, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => document.querySelector('.signal-card'));
  await page.evaluate(() => { const t = window.__high39; t.ME.apply(t.signals().map(s=>({...s,metrics:{...s.metrics,hi90d:50}})), 'live', t.ME.status.when); });
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
  it('fails closed instead of rendering invalid high-distance metrics', async () => {
    const page = await livePage('en');
    try {
      await page.evaluate(() => { const t = window.__high39; t.ME.apply(t.signals().map(s=>({...s,metrics:{...s.metrics,hi90d:'<img src=x onerror=alert(1)>'}})), 'live', t.ME.status.when); });
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.match(await page.$eval('#meBadge', el => el.textContent), /unavailable/i);
      assert.equal(await page.$('img[src=x]'), null);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
