import { test } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { gotoLanding, gotoApp, LANGS, VIEWPORTS } from './helpers/e2e.mjs';

const OUT = path.join(process.cwd(), 'tests/artifacts/shots');
fs.mkdirSync(OUT, { recursive: true });

async function shot(page, name) {
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

test.describe('step5 / extra screenshot matrix', () => {
  test('landing × 5 langs × desktop/mobile', async ({ page }) => {
    for (const lang of LANGS) {
      for (const vp of ['desktop', 'mobile']) {
        await gotoLanding(page, { lang, viewport: VIEWPORTS[vp] });
        await shot(page, `landing_${lang}_${vp}.png`);
      }
    }
  });

  test('terminal × 5 langs × 3 themes × desktop', async ({ page }) => {
    const themes = ['gallery-dark', 'terminal-amber', 'paper-light'];
    for (const lang of LANGS) {
      await gotoApp(page, { lang, viewport: VIEWPORTS.desktop, unlockThemes: true });
      for (const theme of themes) {
        await page.selectOption('#themeSelect', theme);
        await page.waitForTimeout(120);
        await shot(page, `app_${lang}_${theme}_desktop.png`);
      }
    }
  });

  test('terminal mobile + tablet EN/DE/AR', async ({ page }) => {
    for (const lang of ['de', 'en', 'ar']) {
      for (const vp of ['tablet', 'mobile']) {
        await gotoApp(page, { lang, viewport: VIEWPORTS[vp], unlockThemes: true });
        await shot(page, `app_${lang}_gallery-dark_${vp}.png`);
      }
    }
  });

  test('state extras: drawers, dossier, share, donation, faq, empty', async ({ page }) => {
    await gotoApp(page, { lang: 'en', viewport: VIEWPORTS.desktop, unlockThemes: true });
    await page.locator('.sentiment-pill-btn').first().click();
    await shot(page, 'state_sentiment_open.png');

    await page.locator('[data-toggle-chart]').first().click();
    await page.waitForTimeout(200);
    await shot(page, 'state_chart_open.png');

    await page.locator('[data-inspect-sig]').first().click();
    await page.waitForTimeout(150);
    await shot(page, 'state_dossier.png');
    await page.click('#btnCloseDossierModal');

    await page.locator('[data-share-sig]').first().click();
    await page.waitForTimeout(150);
    await shot(page, 'state_sharecard.png');
    await page.click('#btnCloseShareCardModal');

    await page.click('#btnOpenDonation');
    await page.waitForTimeout(120);
    await shot(page, 'state_donation.png');
    await page.click('#btnCloseDonationModal');

    await page.click('#btnOpenThemeUnlock');
    await page.waitForTimeout(120);
    await shot(page, 'state_theme_unlock.png');
    await page.click('#btnCloseThemeModal');

    await page.locator('#faq .faq-header-toggle').nth(1).click();
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await shot(page, 'state_faq.png');

    await page.fill('#pairSearchInput', 'ZZZNOCOIN999');
    await page.waitForTimeout(200);
    await shot(page, 'state_empty_search.png');
  });

  test('landing radar + proof band desktop EN', async ({ page }) => {
    await gotoLanding(page, { lang: 'en', viewport: VIEWPORTS.desktop });
    await shot(page, 'landing_en_full_desktop.png');
  });
});
