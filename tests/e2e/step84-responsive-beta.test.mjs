import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding } from '../helpers/browser.mjs';
let browser;
describe('step84 / narrow and RTL layout', {timeout:90000}, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  for (const width of [320,375,768,1024,1440]) for (const lang of ['de','ar']) {
    it(`${width}px ${lang}: landing and live terminal remain within viewport`, async () => {
      const page = await freshPage(browser);
      try {
        const viewport = {width,height:800};
        await gotoLanding(page,{lang,viewport});
        let overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 2, `landing overflow ${overflow}`);
        await page.close();
        const terminal = await freshPage(browser);
        try {
          await gotoApp(terminal,{lang,viewport});
          overflow = await terminal.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 2, `terminal overflow ${overflow}`);
          await terminal.click('[data-inspect-sig]');
          assert.equal(await terminal.$eval('#dossierModalBackdrop', e => e.classList.contains('is-visible')),true);
          overflow = await terminal.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(overflow <= 2, `dossier overflow ${overflow}`);
          assert.deepEqual(terminal._pageErrors, []);
        } finally { await terminal.close(); }
      } finally { if (!page.isClosed()) await page.close(); }
    });
  }
});
