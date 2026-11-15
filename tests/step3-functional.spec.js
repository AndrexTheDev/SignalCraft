import { test, expect } from '@playwright/test';
import { gotoLanding, gotoApp, LANGS } from './helpers/e2e.mjs';

test.describe('step3 / landing', () => {
  test('hero, CTA and FAQ render', async ({ page }) => {
    await gotoLanding(page, { lang: 'de' });
    await expect(page.locator('h1')).toContainText('Signalcraft');
    await expect(page.locator('a[href="app.html"]').first()).toBeVisible();
    await expect(page.locator('#faq, .seo-faq-section')).toHaveCount(1);
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('de');
  });

  test('language switcher covers 5 locales and Arabic is RTL', async ({ page }) => {
    await gotoLanding(page, { lang: 'en' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.selectOption('#langSelect', 'ar');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.selectOption('#langSelect', 'zh');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('CTA navigates to the terminal', async ({ page }) => {
    await gotoLanding(page, { lang: 'en' });
    await page.locator('a[href="app.html"]').first().click();
    await expect(page).toHaveURL(/app\.html/);
  });
});

test.describe('step3 / terminal board', () => {
  test('renders gated signal cards, quality note and pagination', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    const cards = page.locator('#signalsGrid article.signal-card');
    await expect(cards.first()).toBeVisible();
    const n = await cards.count();
    expect(n).toBeGreaterThan(3);
    await expect(page.locator('#qualityGateNote')).not.toHaveText('');
    await expect(page.locator('#paginationInfoLabel')).toContainText(/Signale|signals|señales|الإشارات|信号/i);
  });

  test('search finds BTC and clear resets', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.fill('#pairSearchInput', 'BTC');
    await page.waitForTimeout(200);
    const titles = await page.locator('#signalsGrid .sc-asset-title').allTextContents();
    expect(titles.some((t) => /BTC/i.test(t))).toBeTruthy();
    await page.click('#clearSearchBtn');
    await expect(page.locator('#pairSearchInput')).toHaveValue('');
  });

  test('risk filters and sector pills change the board', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    const before = await page.locator('#paginationInfoLabel').innerText();
    await page.locator('.filter-btn[data-filter="risk-high"]').click();
    await page.waitForTimeout(150);
    const afterRisk = await page.locator('#paginationInfoLabel').innerText();
    expect(afterRisk).not.toEqual(before);
    await page.locator('.sector-pill[data-sector="majors"]').click();
    await page.waitForTimeout(150);
    const afterSec = await page.locator('#paginationInfoLabel').innerText();
    expect(afterSec).toBeTruthy();
  });

  test('pagination next/prev and page size', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    const firstTitle = await page.locator('.sc-asset-title').first().innerText();
    await page.click('#btnNextPage');
    await page.waitForTimeout(200);
    const secondTitle = await page.locator('.sc-asset-title').first().innerText();
    expect(secondTitle).not.toEqual(firstTitle);
    await page.click('#btnPrevPage');
    await page.waitForTimeout(200);
    await page.locator('.size-btn[data-size="20"]').click();
    await page.waitForTimeout(200);
    const n = await page.locator('#signalsGrid article.signal-card').count();
    expect(n).toBeLessThanOrEqual(20);
  });

  test('sort select does not throw', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await gotoApp(page, { lang: 'en' });
    await page.selectOption('#sortSelect', 'sentiment');
    await page.selectOption('#sortSelect', 'risk');
    await page.selectOption('#sortSelect', 'time');
    expect(errors).toEqual([]);
  });
});

test.describe('step3 / drawers & modals', () => {
  test('sentiment drawer toggles open', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    const pill = page.locator('.sentiment-pill-btn').first();
    await pill.click();
    await expect(page.locator('.sentiment-drawer-panel.is-open').first()).toBeVisible();
  });

  test('chart drawer paints a canvas', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.locator('[data-toggle-chart]').first().click();
    await expect(page.locator('.chart-drawer-panel.is-open').first()).toBeVisible();
    const painted = await page.evaluate(() => {
      const c = document.querySelector('.chart-drawer-panel.is-open canvas');
      if (!c) return false;
      const ctx = c.getContext('2d');
      const px = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
      return px[3] > 0 || px[0] + px[1] + px[2] > 0;
    });
    expect(painted).toBeTruthy();
  });

  test('dossier modal opens with entry/SL/TP and copy button', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    await page.locator('[data-inspect-sig]').first().click();
    await expect(page.locator('#dossierModalBackdrop')).toHaveClass(/is-visible/);
    await expect(page.locator('#dossierBody')).toContainText(/Stop|SL|Einstieg|Entry/i);
    await expect(page.locator('#btnCopyDossierData')).toBeVisible();
    await page.click('#btnCloseDossierModal');
    await expect(page.locator('#dossierModalBackdrop')).not.toHaveClass(/is-visible/);
  });

  test('share card modal draws 1200x675 and share-direct works', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.locator('[data-share-sig]').first().click();
    await expect(page.locator('#shareCardModalBackdrop')).toHaveClass(/is-visible/);
    const size = await page.locator('#shareCardCanvas').evaluate((c) => ({ w: c.width, h: c.height }));
    expect(size).toEqual({ w: 1200, h: 675 });
    await expect(page.locator('#btnShareCardDirect')).toBeVisible();
  });

  test('all themes apply without unlock', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    for (const theme of ['terminal-amber', 'paper-light', 'gallery-dark']) {
      await page.selectOption('#themeSelect', theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    }
  });

  test('donation modal opens from the masthead button', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    await page.click('#btnOpenDonation');
    await expect(page.locator('#donationModalBackdrop')).toHaveClass(/is-visible/);
    await page.click('#btnCloseDonationModal');
  });

  test('FAQ accordion toggles', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    const item = page.locator('.faq-accordion-item').nth(1);
    await item.locator('.faq-header-toggle').click();
    await expect(item).toHaveClass(/is-open/);
  });

});

test.describe('step3 / i18n terminal', () => {
  for (const lang of LANGS) {
    test(`?lang=${lang} sets html lang`, async ({ page }) => {
      await gotoApp(page, { lang });
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      if (lang === 'ar') await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    });
  }
});
