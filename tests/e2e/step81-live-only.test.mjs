import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { read } from '../helpers/html.mjs';
import { startServer, stopServer, launchBrowser, freshPage, stubMarket, BASE } from '../helpers/browser.mjs';

const DAY = 86400000;
function candles(strong) {
  const t0 = Math.floor(Date.now() / DAY) * DAY - 199 * DAY, out = []; let price = 100;
  for (let t = 0; t < 200; t++) {
    const prog = t / 199;
    const ret = strong ? 0.0045 + 0.016 * Math.sin(t * 0.9) + 0.0088 * Math.sin(t * 1.9 + 1.7) + 0.0048 * Math.sin(t * 3.1 + 0.4) : -0.004 + 0.004 * Math.sin(t * 0.9) + 0.0024 * Math.sin(t * 2.3 + 1.7);
    const qv = strong ? 20e6 + 100e6 * prog * prog : 5e6, ratio = strong ? 0.44 + 0.22 * prog : 0.42;
    price = Math.max(1, price * (1 + ret)); const c = price, o = c / (1 + ret), h = Math.max(c, o) * 1.007, l = Math.min(c, o) * 0.993;
    out.push([t0 + t * DAY, +o.toFixed(6), +h.toFixed(6), +l.toFixed(6), +c.toFixed(6), +(qv/c).toFixed(4), t0 + t*DAY + DAY - 1, +qv.toFixed(2), 1000+t, +((qv*ratio)/c).toFixed(4), +(qv*ratio).toFixed(2), 0]);
  }
  return out;
}
let browser;
const instrumented = read('app.html').replace('    ME.refresh(false);', '    window.__liveOnly = { ME, boardSignals, quotedPrice, takeProfitLevels, localizeSignal, getSignals: () => signalsData }; ME.refresh(false);');
async function install(page, klines, delayTicker = 0) {
  await page.setRequestInterception(true);
  const seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
  page.on('request', req => {
    const u = req.url();
    if (u.startsWith(BASE + '/app.html')) return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
    if (klines && /\/ticker\/24hr(?:\?|$)/.test(u)) { const respond = () => req.respond({status:200,contentType:'application/json',body:JSON.stringify(seed.map(s => ({symbol:s.pair.split(' / ')[0]+'USDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()})))}).catch(() => {}); if (delayTicker) { setTimeout(respond, delayTicker); return; } return respond(); }
    if (klines && /\/klines\?/.test(u)) return req.respond({status:200,contentType:'application/json',body:JSON.stringify(klines)}).catch(() => {});
    if (/binance|bybit|kraken|okx|kucoin|mexc|bitget|huobi|gateio|crypto\.com|coinbase|alternative\.me|dexscreener|hyperliquid|dydx/i.test(u)) return req.abort().catch(() => {});
    return req.continue().catch(() => {});
  });
}

describe('step81 / live-only signal presentation', {timeout:180000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('offline startup never renders historical cards, radar values or demo status and discards old cache', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => { localStorage.setItem('signalcraft_live_v2', JSON.stringify({version:9,t:Date.now(),signals:[{id:'FAKE'}]})); });
      await install(page, null); await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__liveOnly && window.__liveOnly.ME.status.mode === 'unavailable', {timeout:20000});
      const state = await page.evaluate(() => ({text:document.body.innerText, cards:document.querySelectorAll('.signal-card').length, signals:window.__liveOnly.getSignals().length, cache:localStorage.getItem('signalcraft_live_v2'), badge:document.querySelector('#meBadge').textContent, ticker:document.querySelector('#tickerScrollFeed').textContent}));
      assert.equal(state.cards,0); assert.equal(state.signals,0); assert.equal(state.cache,null); assert.match(state.badge,/unavailable/i); assert.match(state.ticker,/unavailable/i);
      assert.doesNotMatch(state.text, /\bDEMO\b|BUILD SNAPSHOT|SIG-PEPE-001/); assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('does not restore even a structurally valid, fresh local snapshot when the network is unavailable', async () => {
    const page = await freshPage(browser), seed = JSON.parse(read('tests/fixtures/legacy-seed.json'));
    try {
      await page.evaluateOnNewDocument(data => {
        const t = Date.now();
        const signals = Array.from({length:100}, (_,i) => ({...data, id:'FORGED-'+i, pair:'F'+i+' / USDT', timestamp:t, live:true, modelVersion:3, quantScore:90, confluenceScore:90, metrics:{...data.metrics,score:90}, gateMetrics:{rsi:60,volMio:20,adx:25,riskAdj30:1}}));
        localStorage.setItem('signalcraft_live_v2', JSON.stringify({version:9,t,signals}));
      }, seed[0]);
      await install(page,null); await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__liveOnly.ME.status.mode === 'unavailable',{timeout:20000});
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.equal(await page.evaluate(() => localStorage.getItem('signalcraft_live_v2')), null);
      assert.doesNotMatch(await page.evaluate(() => document.body.innerText),/FORGED-/);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  for (const strong of [false,true]) it(strong ? 'fresh mocked exchange data produces LIVE cards only and expiry removes them' : 'a valid live market with no qualifying setup stays empty', async () => {
    const page = await freshPage(browser);
    try {
      await install(page,candles(strong)); await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__liveOnly && window.__liveOnly.ME.status.mode === 'live',{timeout:30000});
      const cards = await page.$$('#signalsGrid .signal-card');
      assert.equal(cards.length,strong ? 10 : 0); assert.match(await page.$eval('#meBadge',e=>e.textContent),/LIVE/);
      assert.equal(await page.evaluate(() => window.__liveOnly.getSignals().every(s => s.live === true && s.modelVersion === 3)),true);
      if (!strong) assert.match(await page.$eval('#signalsGrid',e=>e.textContent),/no setups/i);
      if (strong) {
        await page.click('[data-inspect-sig]');
        assert.equal(await page.$eval('#dossierModalBackdrop',e=>e.classList.contains('is-visible')),true);
        assert.equal(await page.evaluate(() => { window.__liveOnly.ME.status.when = Date.now() - 91000; return window.__liveOnly.boardSignals().length; }), 0);
        await page.evaluate(() => window.__liveOnly.ME.ensureFresh());
        assert.equal((await page.$$('#signalsGrid .signal-card')).length,0);
        assert.equal(await page.$eval('#dossierModalBackdrop',e=>e.classList.contains('is-visible')),false);
        assert.match(await page.$eval('#meBadge',e=>e.textContent),/unavailable/i);
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('waits for delayed live data before resolving a setup deep link', async () => {
    const first = await freshPage(browser);
    let id;
    try {
      await install(first,candles(true)); await first.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await first.waitForSelector('.signal-card');
      id = await first.$eval('.signal-card', e => e.getAttribute('data-id'));
    } finally { await first.close(); }
    const page = await freshPage(browser);
    try {
      await install(page,candles(true),1200);
      await page.goto(BASE+'/app.html?lang=en&sig='+encodeURIComponent(id)+'&q=nomatch',{waitUntil:'domcontentloaded'});
      await new Promise(resolve => setTimeout(resolve,700));
      assert.equal(new URL(page.url()).searchParams.get('sig'),id);
      assert.equal(await page.$eval('#dossierModalBackdrop',e=>e.classList.contains('is-visible')),false);
      await page.waitForSelector('#dossierModalBackdrop.is-visible',{timeout:10000});
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.match(await page.$eval('#dossierTitle',e=>e.textContent),/USDT/);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('does not reopen a deep link that the user replaced while data was loading', async () => {
    const page = await freshPage(browser);
    try {
      await install(page,candles(true),1200);
      await page.goto(BASE+'/app.html?lang=en&sig=SIG-AAVE-001',{waitUntil:'domcontentloaded'});
      await page.type('#pairSearchInput','other');
      await page.waitForFunction(() => window.__liveOnly.ME.status.mode === 'live',{timeout:10000});
      assert.equal(new URL(page.url()).searchParams.get('sig'),null);
      assert.equal(await page.$eval('#dossierModalBackdrop',e=>e.classList.contains('is-visible')),false);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('chart, copy, dossier and PNG share use only the current live board in all languages', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => {
        window.__copied = []; window.__drawn = []; window.__downloads = [];
        Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text => window.__copied.push(text)}});
        const fill = CanvasRenderingContext2D.prototype.fillText;
        CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { if (this.canvas.id === 'shareCardCanvas') window.__drawn.push(String(text)); return fill.call(this, text, ...args); };
        HTMLAnchorElement.prototype.click = function() { window.__downloads.push({href:this.href,name:this.download}); };
      });
      await install(page,candles(true)); await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(() => window.__liveOnly?.ME.status.mode === 'live',{timeout:30000});
      for (const lang of ['de','en','es','ar','zh']) {
        await page.select('#langSelect',lang);
        await page.evaluate(() => { window.__copied = []; window.__drawn = []; const chart = document.querySelector('[data-toggle-chart]'); if (chart.getAttribute('aria-expanded') !== 'true') chart.click(); });
        assert.equal(await page.$eval('.chart-drawer-panel.is-open',e=>e.querySelectorAll('[data-candle-row]').length),24);
        assert.match(await page.$eval('.chart-drawer-panel.is-open',e=>e.textContent),/LIVE/);
        const levels = await page.evaluate(() => {
          const {boardSignals, quotedPrice, takeProfitLevels, localizeSignal} = window.__liveOnly;
          const id = document.querySelector('[data-share-sig]').getAttribute('data-share-sig');
          const sig = localizeSignal(boardSignals().find(s => s.id === id)), targets = takeProfitLevels(sig);
          return {entry:quotedPrice(sig,sig.entryPrice), stop:quotedPrice(sig,sig.stopLoss), tp1:quotedPrice(sig,targets.tp1), tp2:quotedPrice(sig,targets.tp2), rr:sig.riskRewardRatio};
        });
        await page.evaluate(() => document.querySelector('[data-copy-levels]').click());
        await page.waitForFunction(() => window.__copied.length > 0);
        const copied = await page.evaluate(() => window.__copied[0]);
        assert.match(copied,/LIVE/);
        for (const value of Object.values(levels)) assert.ok(copied.includes(value), `copied ${lang}: ${value}`);
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.match(await page.$eval('#shareCardDataState',e=>e.textContent),/LIVE/);
        const drawn = await page.evaluate(() => window.__drawn);
        for (const value of [levels.entry,levels.stop,levels.rr,`TP1: ${levels.tp1}`,`TP2: ${levels.tp2}`]) assert.ok(drawn.includes(value), `canvas ${lang}: ${value}`);
        await page.evaluate(() => document.querySelector('#btnDownloadCardPng').click());
        assert.match(await page.evaluate(() => window.__downloads.at(-1).href),/^data:image\/png;base64,iVBORw0KGgo/);
        await page.evaluate(() => document.querySelector('#btnCloseShareCardModal').click());
        await page.evaluate(() => document.querySelector('[data-inspect-sig]').click());
        assert.equal(await page.$eval('#dossierModalBackdrop',e=>e.classList.contains('is-visible')),true);
        await page.evaluate(() => document.querySelector('#btnCloseDossierModal').click());
      }
      await page.evaluate(() => document.querySelector('[data-share-sig]').click());
      await page.evaluate(() => { window.__liveOnly.ME.status.when = Date.now() - 91000; window.__liveOnly.ME.ensureFresh(); });
      assert.equal(await page.$eval('#shareCardModalBackdrop',e=>e.classList.contains('is-visible')),false);
      assert.equal((await page.$$('.signal-card')).length,0);
      assert.deepEqual(page._pageErrors,[]);
    } finally { await page.close(); }
  });
  it('does not ship demo signal data or historical proof code in either public page', () => {
    for (const file of ['index.html', 'app.html']) {
      const source = read(file);
      assert.doesNotMatch(source, /\bDEMO\b|SEED_SIGNALS|TRACK_SET|renderProof|BUILD[- ]SNAPSHOT/i);
    }
  });
  it('landing and prerendered pages contain no sample signals or historical results', async () => {
    const page=await freshPage(browser);
    try { await page.setJavaScriptEnabled(false);
      for (const lang of ['de','en','es','ar','zh']) for (const path of ['/','/app']) {
        await page.goto(BASE+path+(lang==='de'?'':'?lang='+lang),{waitUntil:'domcontentloaded'});
        assert.equal((await page.$$('.signal-card, #radRow1, #proofHitPct')).length,0);
        assert.doesNotMatch(await page.evaluate(()=>document.body.innerText),/\bDEMO\b|BUILD SNAPSHOT|91\/100|88\/100/);
      }
    } finally { await page.close(); }
  });
});
