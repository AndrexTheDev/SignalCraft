import { describe, it, before, after } from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp, gotoLanding, VIEWPORTS
} from '../helpers/browser.mjs';
import { ROOT, ensureDir } from '../helpers/html.mjs';

const OUT = ensureDir('tests/artifacts/shots');

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 140));
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

let browser;

describe('step7 extra screenshot matrix', { timeout: 300_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
    const extra = fs.readdirSync(OUT).filter((f) => f.startsWith('extra_'));
    fs.writeFileSync(
      path.join(ROOT, 'tests/reports/step7-shots.json'),
      JSON.stringify({ extra: extra.length, files: extra }, null, 2)
    );
  });

  it('filter + theme + mobile extras', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.desktop, unlockThemes: true });
    await page.click('.sector-pill[data-sector="majors"]');
    await shot(page, 'extra_filter_majors_en.png');
    await page.click('.filter-btn[data-filter="risk-high"]');
    await shot(page, 'extra_filter_majors_high_en.png');
    await page.close();

    const p2 = await freshPage(browser);
    await gotoApp(p2, { lang: 'zh', viewport: VIEWPORTS.mobile, unlockThemes: true });
    await shot(p2, 'extra_app_zh_mobile.png');
    await p2.close();

    const p3 = await freshPage(browser);
    await gotoApp(p3, { lang: 'en', viewport: VIEWPORTS.mobile, unlockThemes: true });
    await p3.select('#themeSelect', 'paper-light');
    await shot(p3, 'extra_app_en_paper_mobile.png');
    await p3.close();

    const p4 = await freshPage(browser);
    await gotoApp(p4, { lang: 'ar', viewport: VIEWPORTS.mobile });
    await shot(p4, 'extra_app_ar_mobile_rtl.png');
    await p4.close();

    const p5 = await freshPage(browser);
    await gotoApp(p5, { lang: 'es', viewport: VIEWPORTS.desktop });
    await p5.click('[data-inspect-sig]');
    await shot(p5, 'extra_dossier_es.png');
    await p5.keyboard.press('Escape');
    await p5.click('#btnOpenThemeUnlock');
    await shot(p5, 'extra_theme_lock_es.png');
    await p5.close();

    const p6 = await freshPage(browser);
    await gotoLanding(p6, { lang: 'zh', viewport: VIEWPORTS.tablet });
    await shot(p6, 'extra_landing_zh_tablet.png');
    await p6.close();

    const p7 = await freshPage(browser);
    await gotoApp(p7, { lang: 'de', query: { q: 'SOL' } });
    await shot(p7, 'extra_deeplink_sol_de.png');
    await p7.close();
  });
});
