import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);', '    window.__beta93 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
async function open(mode) {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(({mode, candles}) => {
    window.__calls93 = [];
    const original = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const url = new URL(String(input),location.href), us = url.hostname === 'api.binance.us';
      if (url.pathname.endsWith('/ticker/24hr')) {
        window.__calls93.push({host:url.hostname,path:'ticker'});
        if (!us || mode === 'all-429') return Promise.resolve({ok:false,status:mode === 'global-451' ? 451 : 429,json:async()=>({})});
        const row = {symbol:'BTCUSDT',quoteVolume:mode === 'gate-zero' ? '1' : '120000000',priceChangePercent:'3',closeTime:Date.now()};
        return Promise.resolve({ok:true,json:async()=>[row]});
      }
      if (url.pathname.endsWith('/klines')) {
        window.__calls93.push({host:url.hostname,path:'candles'});
        return Promise.resolve({ok:true,json:async()=>candles});
      }
      if (url.origin !== location.origin) return Promise.reject(new Error('blocked external'));
      return original(input,options);
    };
  }, {mode,candles:liveTestCandles()});
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(BASE+'/app.html') ? req.respond({status:200,contentType:'text/html',body:app}).catch(()=>{}) : req.continue().catch(()=>{}));
  await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__beta93 && !window.__beta93.ME.busy,{timeout:10000});
  return page;
}
describe('step93 / simulated HTTP exchange failures', {timeout:30000}, () => {
  before(async()=>{await startServer();browser=await launchBrowser();});
  after(async()=>{if(browser)await browser.close();stopServer();});
  for (const mode of ['global-451','global-429']) it(`uses simulated US-shaped data with correct source under ${mode}`,async()=>{
    const page=await open(mode);
    try {
      const result=await page.evaluate(()=>({status:window.__beta93.ME.status,signals:window.__beta93.signals(),calls:window.__calls93}));
      assert.equal(result.status.mode,'live');assert.equal(result.signals.length,1);
      assert.equal(result.signals[0].pair,'BTC / USDT');assert.equal(result.signals[0].venue,'BINANCE-US SPOT');
      assert.equal(result.calls.filter(c=>c.path==='ticker' && c.host!=='api.binance.us').length,2);
      assert.ok(result.calls.filter(c=>c.path==='candles').every(c=>c.host==='api.binance.us'));
      assert.equal((await page.$$('.signal-card')).length,1);assert.deepEqual(page._pageErrors,[]);
    } finally {await page.close();}
  });
  it('shows no signals or stale values when both sources return 429',async()=>{
    const page=await open('all-429');
    try {
      assert.equal(await page.evaluate(()=>window.__beta93.ME.status.mode),'unavailable');
      assert.equal(await page.evaluate(()=>window.__beta93.signals().length),0);
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.equal(await page.evaluate(()=>window.__calls93.filter(c=>c.path==='candles').length),0);
      assert.match(await page.$eval('#snapshotInfo',e=>e.textContent),/unavailable/i);assert.deepEqual(page._pageErrors,[]);
    } finally {await page.close();}
  });
  it('distinguishes valid data without a quality-gate match from unavailable data',async()=>{
    const page=await open('gate-zero');
    try {
      assert.equal(await page.evaluate(()=>window.__beta93.ME.status.mode),'live');
      assert.equal(await page.evaluate(()=>window.__beta93.signals().length),1);
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.match(await page.$eval('#signalsGrid',e=>e.textContent),/quality gate/i);
      assert.deepEqual(page._pageErrors,[]);
    } finally {await page.close();}
  });
});
