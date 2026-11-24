import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, liveTestCandles, BASE } from '../helpers/browser.mjs';
import { read } from '../helpers/html.mjs';
const app = read('app.html').replace('    ME.refresh(false);','    window.__beta94 = { ME, signals: () => signalsData }; ME.refresh(false);');
let browser;
// Independent reference from the synthetic OHLC stream: Wilder moving averages.
function reference(rows) {
  const close = rows.map(x=>x[4]), tr = [], up = [], down = [];
  for (let i=1;i<rows.length;i++) {
    const d=close[i]-close[i-1]; up.push(Math.max(0,d)); down.push(Math.max(0,-d));
    tr.push(Math.max(rows[i][2]-rows[i][3],Math.abs(rows[i][2]-close[i-1]),Math.abs(rows[i][3]-close[i-1])));
  }
  const average = list => {
    let x = list.slice(0,14).reduce((a,b)=>a+b,0)/14;
    for (let i=14;i<list.length;i++) x += (list[i]-x)/14;
    return x;
  };
  const avgUp=average(up), avgDown=average(down), atr=average(tr);
  const returns=close.slice(-30).map((x,i)=>x/close[close.length-31+i]-1);
  const mean=returns.reduce((a,b)=>a+b,0)/30;
  const volatility=Math.sqrt(returns.reduce((a,b)=>a+(b-mean)**2,0)/30)*Math.sqrt(30);
  return { rsi:avgDown===0 ? 100 : 100-100/(1+avgUp/avgDown), atr,
    riskAdj:(close.at(-1)/close.at(-31)-1)/volatility, last:close.at(-1),
    sma200:close.reduce((a,b)=>a+b,0)/200 };
}
const five = n => Number(n.toPrecision(5));
describe('step94 / synthetic model cross-check', {timeout:30000},()=>{
  before(async()=>{await startServer();browser=await launchBrowser();});
  after(async()=>{if(browser)await browser.close();stopServer();});
  it('independently checks RSI, ATR, levels and gate metrics for three source-labelled pairs',async()=>{
    const page=await freshPage(browser);
    try {
      const original=liveTestCandles(), scales={BTC:1,ETH:0.12,SOL:3.2};
      const histories=Object.fromEntries(Object.entries(scales).map(([sym,factor])=>[sym,original.map(row=>row.map((v,i)=> i>=1 && i<=4 ? Number((v*factor).toFixed(7)) : v))]));
      await page.evaluateOnNewDocument(({histories})=>{
        const original=window.fetch.bind(window);
        window.fetch=(input,options)=>{
          const url=new URL(String(input),location.href),us=url.hostname==='api.binance.us';
          if(url.pathname.endsWith('/ticker/24hr')) {
            const symbols=us?['ETH']:['BTC','SOL'];
            return Promise.resolve({ok:true,json:async()=>symbols.map(sym=>({symbol:sym+'USDT',quoteVolume:'120000000',priceChangePercent:'3',closeTime:Date.now()}))});
          }
          if(url.pathname.endsWith('/klines')) {
            const sym=url.searchParams.get('symbol').replace('USDT','');
            return Promise.resolve({ok:true,json:async()=>histories[sym]});
          }
          if(url.origin!==location.origin) return Promise.reject(new Error('blocked'));
          return original(input,options);
        };
      },{histories});
      await page.setRequestInterception(true);
      page.on('request',req=>req.url().startsWith(BASE+'/app.html')?req.respond({status:200,contentType:'text/html',body:app}).catch(()=>{}):req.continue().catch(()=>{}));
      await page.goto(BASE+'/app.html?lang=en',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>window.__beta94 && !window.__beta94.ME.busy,{timeout:10000});
      const result=await page.evaluate(()=>({mode:window.__beta94.ME.status.mode,signals:window.__beta94.signals(),cards:document.querySelectorAll('.signal-card').length}));
      assert.equal(result.mode,'live');assert.equal(result.signals.length,3);assert.equal(result.cards,3);
      for(const sig of result.signals) {
        const sym=sig.pair.split(' / ')[0], ref=reference(histories[sym]);
        assert.equal(sig.venue,sym==='ETH'?'BINANCE-US SPOT':'BINANCE SPOT');
        assert.ok(Math.abs(sig.gateMetrics.rsi-ref.rsi)<1e-9, sym+' RSI');
        assert.ok(Math.abs(sig.gateMetrics.riskAdj30-ref.riskAdj)<1e-9,sym+' momentum');
        assert.equal(sig.metrics.atr,five(ref.atr));assert.equal(sig.metrics.sma200,five(ref.sma200));
        assert.equal(sig.entryPrice,five(ref.last));assert.equal(sig.stopLoss,five(ref.last-1.5*ref.atr));
        assert.equal(sig.targets[0],five(ref.last+1.5*ref.atr));
        assert.ok((sig.targets[1]-sig.entryPrice)/(sig.entryPrice-sig.stopLoss)>=2-1e-10);
        assert.equal(sig.gateMetrics.volMio,120);assert.ok(sig.gateMetrics.rsi<=75 && sig.gateMetrics.adx>=15 && sig.gateMetrics.riskAdj30>0 && sig.quantScore>=86);
        assert.equal(sig.quantScore,Math.max(5,Math.min(98,Math.round(Object.values(sig.metrics.comp).reduce((a,b)=>a+b,0)))));
      }
      assert.deepEqual(page._pageErrors,[]);
    } finally {await page.close();}
  });
});
