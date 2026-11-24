import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, VIEWPORTS } from '../helpers/browser.mjs';
const langs=['de','en','es','ar','zh']; let browser;
async function audit(page) {
  await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});
  return page.evaluate(async()=>{
    const result=await window.axe.run(document,{resultTypes:['violations']});
    return result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target.join(' '),details:n.failureSummary})).slice(0,20)}));
  });
}
describe('step95 / automated beta accessibility audit', {timeout:180000},()=>{
  before(async()=>{await startServer();browser=await launchBrowser();});
  after(async()=>{if(browser)await browser.close();stopServer();});
  for (const theme of ['gallery-dark','terminal-amber','paper-light']) it(`${theme}: expanded controls and dossier have no serious or critical axe violations`,async()=>{
    const page=await freshPage(browser), findings=[];
    try {
      await gotoApp(page,{lang:'en',viewport:VIEWPORTS.mobileSm});
      await page.select('#themeSelect',theme);
      for (const id of ['snapshotDetailsSummary','boardDetailsSummary','marketOverviewSummary','marketRadarSummary','faqSummary']) await page.click('#'+id);
      await page.click('.signal-card [data-toggle-sentiment]');
      await page.click('.signal-card [data-toggle-chart]');
      await new Promise(resolve => setTimeout(resolve, 300)); // Let drawer animations finish before sampling contrast.
      findings.push(...(await audit(page)).map(v=>({...v,page:'expanded'})));
      await page.click('[data-inspect-sig]');
      findings.push(...(await audit(page)).map(v=>({...v,page:'dossier'})));
      if(findings.length)console.log('axe theme '+theme+': '+JSON.stringify(findings));
      assert.deepEqual(findings.filter(v=>['serious','critical'].includes(v.impact)),[]);
      assert.deepEqual(page._pageErrors,[]);
    } finally {await page.close();}
  });
  for (const lang of langs) it(`${lang}: landing, terminal and open dossier have no serious or critical axe violations`,async()=>{
    const page=await freshPage(browser), findings=[];
    try {
      await gotoLanding(page,{lang,viewport:VIEWPORTS.mobileSm});
      findings.push(...(await audit(page)).map(v=>({...v,page:'landing'})));
      await page.close();
      const terminal=await freshPage(browser);
      try {
        await gotoApp(terminal,{lang,viewport:VIEWPORTS.mobileSm});
        findings.push(...(await audit(terminal)).map(v=>({...v,page:'terminal'})));
        await terminal.click('[data-inspect-sig]');
        findings.push(...(await audit(terminal)).map(v=>({...v,page:'dossier'})));
        assert.deepEqual(terminal._pageErrors,[]);
      } finally {await terminal.close();}
      if (findings.length) console.log('axe findings '+lang+': '+JSON.stringify(findings));
      assert.deepEqual(findings.filter(v=>['serious','critical'].includes(v.impact)),[]);
    } finally { if(!page.isClosed())await page.close(); }
  });
});
