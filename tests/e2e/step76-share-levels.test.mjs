import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';

const app = read('app.html');
const instrumented = app.replace('    ME.refresh(false);', '    window.__share76 = { ME, signals: () => signalsData, boardSignals, quotedPrice, takeProfitLevels, localizeSignal }; ME.refresh(false);');
let browser;
async function open(lang) {
  const page = await freshPage(browser);
  await page.setViewport(VIEWPORTS.mobileSm);
  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    window._drawn76 = []; window._copied76 = []; window._downloads76 = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window._copied76.push(text) } });
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, x, y, maxWidth) {
      if (this.canvas.id === 'shareCardCanvas') window._drawn76.push({ text: String(text), x, y, maxWidth, direction: this.direction, align: this.textAlign });
      return maxWidth === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, maxWidth);
    };
    HTMLAnchorElement.prototype.click = function() { window._downloads76.push({ href: this.href, name: this.download }); };
  });
  await stubMarket(page, { appHtml: instrumented, klines: liveTestCandles() });
  await page.goto(BASE + '/app.html?lang=' + lang, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /LIVE/.test(document.getElementById('meBadge')?.textContent || ''));
  await page.evaluate(() => {
    const t = window.__share76;
    const signals = t.signals().map(s => ({...s, entryPrice:1.00000000000002, stopLoss:1.00000000000001, targets:[1.00000000000003,1.00000000000004], riskRewardRatio:'1:2.0'}));
    t.ME.apply(signals, 'live', t.ME.status.when);
  });
  assert.match(await page.$eval('#meBadge', e => e.textContent), /LIVE/);
  return page;
}
async function verify(page, mode) {
  const expected = await page.evaluate(() => {
    const { boardSignals, quotedPrice, takeProfitLevels, localizeSignal } = window.__share76;
    const id = document.querySelector('[data-share-sig]').getAttribute('data-share-sig');
    const s = localizeSignal(boardSignals().find(item => item.id === id)), t = takeProfitLevels(s);
    return { entry: quotedPrice(s, s.entryPrice), stop: quotedPrice(s, s.stopLoss), tp1: quotedPrice(s, t.tp1), tp2: quotedPrice(s, t.tp2), rr: s.riskRewardRatio };
  });
  assert.notEqual(expected.tp1, expected.tp2);
  const card = await page.$eval('#signalsGrid .signal-card', e => e.textContent);
  for (const v of Object.values(expected)) assert.ok(card.includes(v), `card ${mode}: ${v}`);
  await page.evaluate(() => { window._drawn76 = []; window._copied76 = []; document.querySelector('[data-copy-levels]').click(); });
  await page.waitForFunction(() => window._copied76.length > 0);
  const copied = await page.evaluate(() => window._copied76[0]);
  for (const v of Object.values(expected)) assert.ok(copied.includes(v), `copy ${mode}: ${v}`);
  await page.evaluate(() => document.querySelector('[data-share-sig]').click());
  const drawn = await page.evaluate(() => window._drawn76);
  for (const v of [expected.entry, expected.stop, expected.rr]) {
    const item = drawn.find(x => x.text === v);
    assert.ok(item, `canvas ${mode}: ${v}`); assert.equal(item.direction, 'ltr');
  }
  const a = drawn.find(x => x.text === `TP1: ${expected.tp1}`), b = drawn.find(x => x.text === `TP2: ${expected.tp2}`);
  assert.ok(a, `canvas ${mode} TP1 ${expected.tp1}`); assert.ok(b, `canvas ${mode} TP2 ${expected.tp2}`);
  for (const item of [a, b]) {
    assert.equal(item.direction, 'ltr'); assert.equal(item.align, 'left');
    assert.ok(item.x >= 600 && item.x + item.maxWidth <= 870, 'target text remains inside its column');
    assert.ok(item.y > 345 && item.y < 470, 'target text remains inside its panel');
  }
  assert.ok(b.y - a.y >= 25, 'targets occupy separate readable lines');
  assert.match(await page.$eval('#shareCardDataState', e => e.textContent), new RegExp(mode));
  assert.equal(await page.$eval('#btnDownloadCardPng', e => e.disabled), false);
  await page.evaluate(() => document.querySelector('#btnDownloadCardPng').click());
  const download = await page.evaluate(() => window._downloads76.at(-1));
  assert.match(download.href, /^data:image\/png;base64,iVBORw0KGgo/);
  assert.match(download.name, /^Signalcraft-.+\.png$/);
  assert.deepEqual(page._pageErrors, []);
}
describe('step76 / complete share-card trading levels', { timeout: 90000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
    it(`exports distinct LIVE targets with the board's values in ${lang}`, async () => {
      const page = await open(lang);
      try {
        await verify(page, 'LIVE');
      } finally { await page.close(); }
    });
  }
});
