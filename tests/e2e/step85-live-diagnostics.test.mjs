import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';

const html = read('app.html').replace('    ME.refresh(false);', '    window.__diag85 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({mode, candles}) => {
    window.__mode85 = mode; window.__requests85 = [];
    const timer = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...args) => timer(fn, ms === 60000 ? 600 : ms, ...args);
    const real = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href), selected = window.__mode85;
      window.__requests85.push(url.href);
      if (url.pathname.endsWith('/ticker/24hr')) {
        if (selected === 'timeout') return new Promise(() => {});
        if (selected === 'offline') return Promise.reject(new Error('private remote error or markup'));
        if (selected === 'primary-malformed' && url.hostname === 'data-api.binance.vision') return Promise.resolve({ok:true,json:async()=>({unexpected:'shape'})});
        if (selected === 'primary-unrelated' && url.hostname === 'data-api.binance.vision') return Promise.resolve({ok:true,json:async()=>[{symbol:'OTHERUSDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()}]});
        if (selected === 'primary-stale' && url.hostname === 'data-api.binance.vision') return Promise.resolve({ok:true,json:async()=>[{symbol:'BTCUSDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()-120000}]});
        if ((selected === 'primary-unrelated' || selected === 'primary-stale') && url.hostname === 'api.binance.us') return Promise.resolve({ok:true,json:async()=>[]});
        if (selected === 'all-stale') return Promise.resolve({ok:true,json:async()=>[{symbol:'BTCUSDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()-120000}]});
        const rows = [{symbol:'BTCUSDT',quoteVolume:selected === 'gate' ? '1' : '120000000',priceChangePercent:'3',closeTime: Date.now()}];
        return Promise.resolve({ok:true,json:async()=>rows});
      }
      if (url.pathname.endsWith('/klines')) return Promise.resolve({ok:true,json:async()=>selected === 'bad-history' || (selected === 'primary-bad-candles' && url.hostname === 'data-api.binance.vision') ? candles.slice(1) : candles});
      if (url.origin !== location.origin) return Promise.reject(new Error('offline'));
      return real(input, options);
    };
  }, {mode,candles:liveTestCandles()});
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE+'/app.html') ? req.respond({status:200,contentType:'text/html',body:html}).catch(()=>{}) : req.continue().catch(()=>{}));
  await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__diag85 && !window.__diag85.ME.busy, {timeout:10000});
  return page;
}
describe('step85 / honest live failure diagnostics', {timeout:60000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const [mode,reason,pattern] of [
    ['offline','ticker',/No valid 24h tickers.*Binance 0\/120.*Binance.US 0\/120/s],
    ['bad-history','pairs',/No pair had usable current candles.*Binance 1\/120.*Binance.US 1\/120/s],
    ['timeout','timeout',/time limit was reached/i]
  ]) it(`explains ${mode} without guessing the cause or displaying old values`, async () => {
    const page = await open(mode);
    try {
      assert.equal(await page.evaluate(() => window.__diag85.ME.status.reason),reason);
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.match(await page.$eval('#snapshotDiagnostics', e => e.textContent), pattern);
      assert.doesNotMatch(await page.$eval('#snapshotInfo', e => e.textContent),/private remote error|markup/);
      for (const lang of ['de','es','ar','zh','en']) {
        await page.select('#langSelect',lang);
        assert.ok((await page.$eval('#snapshotInfo', e => e.textContent)).length > 0, lang);
        assert.equal((await page.$$('.signal-card')).length,0);
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  for (const mode of ['primary-malformed','primary-unrelated','primary-stale','primary-bad-candles']) it(`recovers from ${mode} on the alternate global endpoint`, async () => {
    const page = await open(mode);
    try {
      assert.equal(await page.evaluate(() => window.__diag85.ME.status.mode),'live');
      assert.equal((await page.$$('.signal-card')).length,1);
      const hits = await page.evaluate(() => window.__requests85);
      assert.ok(hits.some(url => url.includes('api.binance.com/api/v3/' + (mode === 'primary-bad-candles' ? 'klines?' : 'ticker/24hr'))));
      assert.match(await page.$eval('#snapshotInfo', e => e.textContent), /Evaluated: 1\/120/);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('excludes unusably old tickers before requesting any candles', async () => {
    const page = await open('all-stale');
    try {
      assert.equal(await page.evaluate(() => window.__diag85.ME.status.reason), 'ticker');
      assert.match(await page.$eval('#snapshotDiagnostics', e => e.textContent), /Snapshot-eligible tickers when checked.*Binance 0\/120.*Binance.US 0\/120/s);
      assert.equal(await page.evaluate(() => window.__requests85.filter(url => url.includes('/klines?')).length), 0);
      assert.equal((await page.$$('.signal-card')).length, 0);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('distinguishes no gate matches from missing data', async () => {
    const page = await open('gate');
    try {
      assert.equal(await page.evaluate(() => window.__diag85.ME.status.mode),'live');
      assert.equal(await page.evaluate(() => window.__diag85.signals().length),1);
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.match(await page.$eval('#signalsGrid', e => e.textContent), /quality gate/i);
      assert.match(await page.$eval('#snapshotInfo', e => e.textContent), /Evaluated: 1\/120/);
      assert.doesNotMatch(await page.$eval('#snapshotInfo', e => e.textContent), /live data unavailable/i);
    } finally { await page.close(); }
  });
  it('replaces the failure state after connectivity returns', async () => {
    const page = await open('offline');
    try {
      await page.evaluate(() => { window.__mode85 = 'live'; });
      await page.click('#btnRefreshSentimentGlobal');
      await page.waitForFunction(() => window.__diag85.ME.status.mode === 'live' && !window.__diag85.ME.busy,{timeout:10000});
      assert.equal(await page.evaluate(() => window.__diag85.ME.status.reason),'');
      assert.equal((await page.$$('.signal-card')).length,1);
      assert.match(await page.$eval('#snapshotInfo', e => e.textContent), /Evaluated: 1\/120/);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
});
