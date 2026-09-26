import { describe, it, before, after } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, VIEWPORTS
} from '../helpers/browser.mjs';
import { ROOT, ensureDir } from '../helpers/html.mjs';

const OUT = ensureDir('tests/artifacts/shots');

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 160));
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

let browser;

describe('step14 ads screenshot matrix', { timeout: 300_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
    const files = fs.readdirSync(OUT).filter((f) => f.startsWith('ad_'));
    fs.writeFileSync(
      path.join(ROOT, 'tests/reports/step14-ads-shots.json'),
      JSON.stringify({ count: files.length, files }, null, 2)
    );
  });

  it('captures every ad container across viewports, themes and gates', async () => {
    const wide = await freshPage(browser);
    await gotoLanding(wide, { lang: 'en', viewport: VIEWPORTS.wide });
    await shot(wide, 'ad_landing_en_wide_sides.png');
    await wide.close();

    const landM = await freshPage(browser);
    await gotoLanding(landM, { lang: 'de', viewport: VIEWPORTS.mobile });
    await shot(landM, 'ad_landing_de_mobile_sticky.png');
    await landM.close();

    const appW = await freshPage(browser);
    await gotoApp(appW, { lang: 'en', viewport: VIEWPORTS.wide, unlockThemes: true });
    await shot(appW, 'ad_app_en_wide_sides.png');
    await appW.evaluate(() => document.getElementById('adNative')?.scrollIntoView({ block: 'center' }));
    await shot(appW, 'ad_app_en_native_footer.png');
    await appW.select('#themeSelect', 'paper-light');
    await new Promise((r) => setTimeout(r, 120));
    await appW.evaluate(() => window.scrollTo(0, 0));
    await shot(appW, 'ad_app_en_paper_wide.png');
    await appW.close();

    const appM = await freshPage(browser);
    await gotoApp(appM, { lang: 'es', viewport: VIEWPORTS.mobile });
    await shot(appM, 'ad_app_es_mobile_sticky.png');
    await appM.close();

    const ar = await freshPage(browser);
    await gotoApp(ar, { lang: 'ar', viewport: VIEWPORTS.mobile });
    await shot(ar, 'ad_app_ar_mobile_sticky_rtl.png');
    await ar.close();

    const gate = await freshPage(browser);
    await gotoApp(gate, { lang: 'en', viewport: VIEWPORTS.desktop });
    await gate.evaluate(() => window.forceAdBlock(true));
    await new Promise((r) => setTimeout(r, 120));
    await shot(gate, 'ad_app_en_adgate.png');
    await gate.close();

    const rad = await freshPage(browser);
    await gotoLanding(rad, { lang: 'en', viewport: VIEWPORTS.desktop });
    await rad.evaluate(() => {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('radRow' + i);
        if (el) el.style.display = 'none';
      }
      const gn = document.getElementById('radGateNote');
      if (gn) gn.style.display = 'block';
    });
    await rad.evaluate(() => document.getElementById('radGateNote')?.scrollIntoView({ block: 'center' }));
    await shot(rad, 'ad_landing_en_radgate.png');
    await rad.close();

    const zh = await freshPage(browser);
    await gotoApp(zh, { lang: 'zh', viewport: VIEWPORTS.tablet, unlockThemes: true });
    await zh.select('#themeSelect', 'terminal-amber');
    await new Promise((r) => setTimeout(r, 120));
    await shot(zh, 'ad_app_zh_amber_tablet.png');
    await zh.close();
  });
});
