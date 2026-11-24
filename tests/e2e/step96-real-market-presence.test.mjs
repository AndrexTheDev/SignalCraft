import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, gotoLanding, BASE, VIEWPORTS } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';

// All exchange responses here are synthetic. Production never loads these fixtures.
const app = read('app.html').replace('    ME.refresh(false);', '    window.__market96 = { ME, signals: () => signalsData, setMarketQuotes, renderMarketQuotes }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({ mode, candles }) => {
    window.__mode96 = mode;
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href), us = url.hostname === 'api.binance.us';
      if (url.pathname.endsWith('/ticker/24hr')) {
        if (window.__mode96 === 'offline') return Promise.reject(new Error('offline'));
        const symbols = us ? ['ETH', 'SOL'] : ['BTC', 'SOL'];
        const rows = symbols.map(symbol => ({ symbol: symbol + 'USDT', quoteVolume: window.__mode96 === 'gate-zero' ? '1' : '120000000', priceChangePercent: '3', closeTime: Date.now(), lastPrice: symbol === 'BTC' ? '60123.456789' : symbol === 'ETH' ? '2500.12345' : '0' }));
        return Promise.resolve({ ok: true, json: async () => rows });
      }
      if (url.pathname.endsWith('/klines')) {
        if (window.__mode96 === 'no-candles') return Promise.reject(new Error('no candles'));
        return Promise.resolve({ ok: true, json: async () => candles });
      }
      if (url.origin !== location.origin) return Promise.reject(new Error('blocked external'));
      return original(input, options);
    };
  }, { mode, candles: liveTestCandles() });
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({ status: 200, contentType: 'text/html', body: app }).catch(() => {}) : req.continue().catch(() => {}));
  await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__market96 && !window.__market96.ME.busy, { timeout: 15000 });
  return page;
}

describe('step96 / honest market presence and gate diagnosis', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });

  it('shows individually validated ticker prices and accurate overlapping gate counts without inventing signals', async () => {
    const page = await open('gate-zero');
    try {
      assert.equal(await page.evaluate(() => window.__market96.ME.status.mode), 'live');
      assert.equal(await page.$$('.signal-card').then(rows => rows.length), 0);
      assert.equal(await page.$eval('#marketQuotes', e => e.hidden), false);
      const rows = await page.$$eval('#marketQuotesList > div', es => es.map(e => e.textContent));
      assert.equal(rows.length, 2);
      assert.match(rows[0], /BTC \/ USDT.*60,123\.456789.*Binance · .*UTC/);
      assert.match(rows[1], /ETH \/ USDT.*2,500\.12345.*Binance\.US · .*UTC/);
      assert.ok(!rows.some(row => row.includes('SOL'))); // invalid zero price is never displayed
      assert.match(await page.$eval('#marketQuotesNote', e => e.textContent), /not signals.*last trade may be older/i);
      const signals = await page.evaluate(() => window.__market96.signals());
      const breakdown = await page.$eval('#gateBreakdown', e => e.textContent);
      assert.match(breakdown, new RegExp('Highest score: ' + Math.max(...signals.map(s => s.quantScore)) + '/100'));
      assert.match(breakdown, /may overlap/);
      assert.match(breakdown, /Volume 3/);
      const titles = new Set();
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        await page.setViewport(VIEWPORTS.mobileSm);
        await page.select('#langSelect', lang);
        titles.add(await page.$eval('#marketQuotesTitle', e => e.textContent));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, lang);
        assert.ok(await page.$eval('#gateBreakdown', e => e.textContent.length > 30));
      }
      assert.equal(titles.size, 5);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('keeps real ticker snapshots separate from a candle outage and removes them on a later failed refresh', async () => {
    const page = await open('no-candles');
    try {
      assert.equal(await page.evaluate(() => window.__market96.ME.status.mode), 'unavailable');
      assert.equal(await page.$$('.signal-card').then(rows => rows.length), 0);
      assert.equal(await page.$eval('#marketQuotes', e => e.hidden), false);
      assert.match(await page.$eval('#marketQuotesList', e => e.textContent), /BTC/);
      assert.equal(await page.$eval('#gateBreakdown', e => e.textContent), '');
      await page.evaluate(async () => { window.__mode96 = 'offline'; await window.__market96.ME.refresh(false); });
      assert.equal(await page.$eval('#marketQuotes', e => e.hidden), true);
      assert.equal(await page.$eval('#marketQuotesList', e => e.textContent), '');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('expires prices independently, rejects invalid values and never retains old quotes', async () => {
    const page = await open('offline');
    try {
      await page.evaluate(() => {
        const { ME, setMarketQuotes } = window.__market96; ME.TTL = 200;
        const now = Date.now();
        setMarketQuotes({ binance: { BTCUSDT: { price: 123, time: now }, ETHUSDT: { price: -1, time: now }, SOLUSDT: { price: 5, time: now - 1000 } }, 'binance-us': {} });
      });
      assert.match(await page.$eval('#marketQuotesList', e => e.textContent), /BTC/);
      assert.doesNotMatch(await page.$eval('#marketQuotesList', e => e.textContent), /ETH|SOL/);
      await page.waitForFunction(() => document.querySelector('#marketQuotes').hidden, { timeout: 3000 });
      assert.equal(await page.$eval('#marketQuotesList', e => e.textContent), '');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('shows real qualified signals as signals and separately labels market prices', async () => {
    const page = await open('normal');
    try {
      assert.equal(await page.evaluate(() => window.__market96.ME.status.mode), 'live');
      assert.equal(await page.$$('.signal-card').then(rows => rows.length), 3);
      assert.match(await page.$eval('#marketQuotesNote', e => e.textContent), /not signals/i);
      await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => v.id));
      assert.deepEqual(violations, []);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });

  it('does not suggest the landing page has checked or displayed current signals', async () => {
    const page = await freshPage(browser);
    try {
      await gotoLanding(page, { lang: 'de', viewport: VIEWPORTS.mobileSm });
      assert.match(await page.$eval('[data-i18n="rad_t"]', e => e.textContent), /Terminal/);
      assert.match(await page.$eval('[data-i18n="rad_note"]', e => e.textContent), /Terminal/);
      assert.doesNotMatch(await page.$eval('[data-i18n="rad_note"]', e => e.textContent), /Ohne aktuelle Daten bleibt/);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
