import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';

const app = read('app.html').replace('    ME.refresh(false);', '    window.__partial82 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;

describe('step82 / partial live coverage and bounded collection', { timeout: 60000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('refreshes promptly when a live snapshot expires after a slow collection', async () => {
    const page = await freshPage(browser);
    try {
      await stubMarket(page, {appHtml:app, klines:liveTestCandles()});
      await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__partial82?.ME.status.mode === 'live' && !window.__partial82.ME.busy,{timeout:15000});
      await page.evaluate(() => {
        const { ME, signals } = window.__partial82;
        const original = ME.refresh.bind(ME); window.__autoRefreshes82 = 0;
        ME.refresh = (...args) => { window.__autoRefreshes82++; return original(...args); };
        const when = Date.now() - ME.TTL + 300;
        ME.apply(signals().map(s => ({...s,timestamp:when})), 'live', when);
      });
      await page.waitForFunction(() => window.__autoRefreshes82 > 0 && window.__partial82.ME.status.mode === 'live' && !window.__partial82.ME.busy,{timeout:15000});
      assert.ok(await page.evaluate(() => Date.now() - window.__partial82.ME.status.when < 10000));
      assert.ok((await page.$$('.signal-card')).length > 0);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  for (const mode of ['single-us', 'timeout-partial']) it(`shows only completed valid live data: ${mode}`, async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(({ mode, candles }) => {
        const realSetTimeout = window.setTimeout.bind(window);
        window.setTimeout = (f, ms, ...args) => realSetTimeout(f, ms === 60000 ? 800 : ms, ...args);
        window.__pending82 = [];
        const realFetch = window.fetch.bind(window);
        window.fetch = (input, options) => {
          const url = new URL(String(input), location.href);
          if (url.pathname.endsWith('/ticker/24hr')) {
            if (mode === 'single-us' && url.hostname !== 'api.binance.us') return Promise.reject(new Error('451 or CORS'));
            const symbols = mode === 'single-us' ? ['PEPE'] : ['PEPE','WIF','G','ONDO','SOL','FET'];
            const rows = symbols.map(sym => ({symbol:sym+'USDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()}));
            return Promise.resolve({ok:true,json:async () => rows});
          }
          if (url.pathname.endsWith('/klines')) {
            if (url.searchParams.get('symbol') === 'PEPEUSDT') return Promise.resolve({ok:true,json:async () => candles});
            return new Promise(resolve => window.__pending82.push({resolve, signal:options.signal}));
          }
          if (url.origin !== location.origin) return Promise.reject(new Error('offline'));
          return realFetch(input, options);
        };
      }, {mode, candles:liveTestCandles()});
      await page.setRequestInterception(true);
      page.on('request', req => req.url().startsWith(BASE + '/app.html') ? req.respond({status:200,contentType:'text/html',body:app}).catch(()=>{}) : req.continue().catch(()=>{}));
      await page.goto(BASE+'/app.html?lang=en', {waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__partial82 && !window.__partial82.ME.busy, {timeout:10000});
      assert.equal(await page.evaluate(() => window.__partial82.ME.status.mode), 'live');
      assert.equal((await page.$$('.signal-card')).length, 1);
      assert.match(await page.$eval('#snapshotInfo', e => e.textContent), /Evaluated: 1\/120/);
      const result = await page.evaluate(() => window.__partial82.signals().map(s => ({pair:s.pair, venue:s.venue, live:s.live})));
      assert.equal(result.length, 1); assert.equal(result[0].pair, 'PEPE / USDT'); assert.equal(result[0].live, true);
      if (mode === 'single-us') assert.equal(result[0].venue, 'BINANCE-US SPOT');
      if (mode === 'timeout-partial') {
        assert.ok(await page.evaluate(() => window.__pending82.length > 0 && window.__pending82.every(p => p.signal.aborted)));
        await page.evaluate(candles => window.__pending82.forEach(p => p.resolve({ok:true,json:async () => candles})), liveTestCandles());
        await new Promise(r => setTimeout(r,100));
        assert.equal(await page.evaluate(() => window.__partial82.signals().length), 1);
      }
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
});
