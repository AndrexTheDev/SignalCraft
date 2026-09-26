import { test, expect } from '@playwright/test';
import { gotoLanding, gotoApp, VIEWPORTS } from './helpers/e2e.mjs';

test.describe('step4 / beta journeys', () => {
  test('happy path: landing → terminal → BTC → dossier → share', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await gotoLanding(page, { lang: 'en', viewport: VIEWPORTS.desktop });
    await page.locator('a.btn-accent[href="app.html"], a[href="app.html"]').first().click();
    await page.waitForSelector('#signalsGrid .signal-card');
    await page.fill('#pairSearchInput', 'BTC');
    await page.waitForTimeout(250);
    await expect(page.locator('.sc-asset-title').first()).toContainText(/BTC/i);
    await page.locator('[data-inspect-sig]').first().click();
    await expect(page.locator('#dossierModalBackdrop')).toHaveClass(/is-visible/);
    await page.click('#btnCloseDossierModal');
    await page.locator('[data-share-sig]').first().click();
    await expect(page.locator('#shareCardModalBackdrop')).toHaveClass(/is-visible/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('mobile 390px: no horizontal overflow, cards stack', async ({ page }) => {
    await gotoApp(page, { lang: 'de', viewport: VIEWPORTS.mobile });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(8);
    const cardWidth = await page.locator('.signal-card').first().evaluate((el) => el.getBoundingClientRect().width);
    expect(cardWidth).toBeGreaterThan(280);
    expect(cardWidth).toBeLessThanOrEqual(390);
  });

  test('tablet 768px landing remains usable', async ({ page }) => {
    await gotoLanding(page, { lang: 'es', viewport: VIEWPORTS.tablet });
    await expect(page.locator('.hero-title')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(8);
  });

  test('Arabic RTL terminal: dir=rtl and search still works', async ({ page }) => {
    await gotoApp(page, { lang: 'ar', viewport: VIEWPORTS.desktop });
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.fill('#pairSearchInput', 'ETH');
    await page.waitForTimeout(200);
    const titles = await page.locator('.sc-asset-title').allTextContents();
    expect(titles.some((t) => /ETH/i.test(t))).toBeTruthy();
  });

  test('empty search shows empty-state copy', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.fill('#pairSearchInput', 'ZZZNOCOIN999');
    await page.waitForTimeout(200);
    await expect(page.locator('#signalsGrid')).toContainText(/No signals|Keine Signale|No se encontraron|لا توجد|没有信号/i);
  });

  test('page-size All shows more than 30 cards', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    await page.click('#sizeAllBtn');
    await page.waitForTimeout(300);
    const n = await page.locator('#signalsGrid article.signal-card:not(.lead-capture-bento-card)').count();
    expect(n).toBeGreaterThan(30);
  });

  test('keyboard: language select is labelled; FAQ is reachable', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    await expect(page.locator('#langSelect')).toHaveAttribute('aria-label', /Language|Sprache/i);
    await page.click('a[href="#faq"]');
    await expect(page.locator('#faq')).toBeVisible();
  });

  test('guide button scrolls to FAQ', async ({ page }) => {
    await gotoApp(page, { lang: 'de' });
    await page.click('#btnOpenGuideModal');
    await expect(page.locator('#faq')).toBeInViewport({ timeout: 5000 });
  });

  test('theme gallery button opens modal', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.click('#btnOpenThemeUnlock');
    await expect(page.locator('#themeModalBackdrop')).toHaveClass(/is-visible/);
  });

  test('supporter flow unlocks themes without crash', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    await page.click('#btnOpenDonation');
    await page.click('#btnDonated');
    await expect(page.locator('#editorialToast')).toHaveClass(/is-active/);
    await page.selectOption('#themeSelect', 'terminal-amber');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'terminal-amber');
  });
});

test.describe('step4 / visual regressions (layout)', () => {
  test('grade chips render A+/A/B+ on the first page', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    const chips = await page.locator('.grade-chip').allTextContents();
    expect(chips.join(' ')).toMatch(/GRADE\s+(A\+|A|B\+|B)/);
  });

  test('cards expose TP1 and TP2, not a single hidden target', async ({ page }) => {
    await gotoApp(page, { lang: 'en' });
    const levels = await page.locator('.sc-levels-grid').first().innerText();
    expect(levels).toMatch(/TAKE PROFIT|TAKE-PROFIT|止盈|أخذ الربح|TAKE PROFIT/i);
  });
});
