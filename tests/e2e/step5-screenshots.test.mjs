import { describe, it, before, after } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp,
  LANGS, VIEWPORTS
} from '../helpers/browser.mjs';
import { ROOT, ensureDir } from '../helpers/html.mjs';

const OUT = ensureDir('tests/artifacts/shots');

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 160));
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

let browser;

describe('step5 extra screenshot matrix', { timeout: 420_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
    const n = fs.readdirSync(OUT).filter((f) => f.endsWith('.png')).length;
    fs.writeFileSync(path.join(ROOT, 'tests/reports/step5-shots.json'), JSON.stringify({ count: n, dir: 'tests/artifacts/shots', files: fs.readdirSync(OUT) }, null, 2));
  });

  it('landing × 5 langs × desktop/mobile', async () => {
    for (const lang of LANGS) {
      for (const vp of ['desktop', 'mobile']) {
        const page = await freshPage(browser);
        await gotoLanding(page, { lang, viewport: VIEWPORTS[vp] });
        await shot(page, `landing_${lang}_${vp}.png`);
        await page.close();
      }
    }
  });

  it('terminal × 5 langs × 3 themes × desktop', async () => {
    const themes = ['gallery-dark', 'terminal-amber', 'paper-light'];
    for (const lang of LANGS) {
      const page = await freshPage(browser);
      await gotoApp(page, { lang, viewport: VIEWPORTS.desktop });
      for (const theme of themes) {
        await page.select('#themeSelect', theme);
        await new Promise((r) => setTimeout(r, 140));
        await shot(page, `app_${lang}_${theme}_desktop.png`);
      }
      await page.close();
    }
  });

  it('terminal mobile + tablet DE/EN/AR', async () => {
    for (const lang of ['de', 'en', 'ar']) {
      for (const vp of ['tablet', 'mobile']) {
        const page = await freshPage(browser);
        await gotoApp(page, { lang, viewport: VIEWPORTS[vp] });
        await shot(page, `app_${lang}_gallery-dark_${vp}.png`);
        await page.close();
      }
    }
  });

  it('state extras: drawers, dossier, share, donation, faq, empty', async () => {
    const page = await freshPage(browser);
    // deterministic brand shots regardless of theme persisted by earlier steps
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.desktop, storage: { signalcraft_theme: 'gallery-dark' } });

    await page.click('.sentiment-pill-btn');
    await shot(page, 'state_sentiment_open.png');

    await page.click('[data-toggle-chart]');
    await new Promise((r) => setTimeout(r, 220));
    await shot(page, 'state_chart_open.png');

    await page.click('[data-inspect-sig]');
    await new Promise((r) => setTimeout(r, 160));
    await shot(page, 'state_dossier.png');
    await page.click('#btnCloseDossierModal');

    await page.click('[data-share-sig]');
    await new Promise((r) => setTimeout(r, 160));
    await shot(page, 'state_sharecard.png');
    await page.click('#btnCloseShareCardModal');

    await page.click('#btnOpenDonation');
    await new Promise((r) => setTimeout(r, 120));
    await shot(page, 'state_donation.png');
    await page.click('#btnCloseDonationModal');

    await page.select('#themeSelect', 'paper-light');
    await new Promise((r) => setTimeout(r, 120));
    await shot(page, 'state_theme_paper.png');
    await page.select('#themeSelect', 'gallery-dark');

    const toggles = await page.$$('#faq .faq-header-toggle');
    if (toggles[1]) await toggles[1].click();
    await page.evaluate(() => document.getElementById('faq')?.scrollIntoView());
    await shot(page, 'state_faq.png');

    await page.click('#pairSearchInput', { clickCount: 3 });
    await page.type('#pairSearchInput', 'ZZZNOCOIN999');
    await new Promise((r) => setTimeout(r, 220));
    await shot(page, 'state_empty_search.png');
    await page.close();
  });

  it('landing EN full desktop', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en', viewport: VIEWPORTS.desktop });
    await shot(page, 'landing_en_full_desktop.png');
    await page.close();
  });
});
