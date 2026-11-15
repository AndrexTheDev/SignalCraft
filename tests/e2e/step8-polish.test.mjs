import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoLanding, gotoApp, BASE
} from '../helpers/browser.mjs';

let browser;

describe('step8 polish e2e', { timeout: 240_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('serves site.webmanifest as JSON', async () => {
    const res = await fetch(BASE + '/site.webmanifest');
    assert.equal(res.ok, true, 'manifest status ' + res.status);
    const man = await res.json();
    assert.equal(man.display, 'standalone');
    assert.ok(man.icons.length >= 1);
  });

  it('landing skip link is the first tab stop and jumps to #warum', async () => {
    const page = await freshPage(browser);
    await gotoLanding(page, { lang: 'en' });
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(id, 'skipToContent');
    const label = await page.$eval('#skipToContent', (el) => el.textContent.trim());
    assert.match(label, /Skip to content/i);
    await page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 80));
    const hash = await page.evaluate(() => location.hash);
    assert.equal(hash, '#warum');
    await page.close();
  });

  it('terminal skip link translates with language', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const de = await page.$eval('#skipToSignals', (el) => el.textContent.trim());
    assert.match(de, /Signalen|Weiter/);
    await page.select('#langSelect', 'en');
    await new Promise((r) => setTimeout(r, 200));
    const en = await page.$eval('#skipToSignals', (el) => el.textContent.trim());
    assert.match(en, /Skip to signals/i);
    await page.close();
  });

  it('copy-levels writes entry / SL / TP to the clipboard and toasts', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.evaluate(() => {
      window.__clip = '';
      navigator.clipboard.writeText = (t) => { window.__clip = String(t); return Promise.resolve(); };
    });
    const n = await page.$$eval('[data-copy-levels]', (els) => els.length);
    assert.ok(n >= 1, 'copy buttons ' + n);
    await page.click('[data-copy-levels]');
    await new Promise((r) => setTimeout(r, 120));
    const clip = await page.evaluate(() => window.__clip);
    assert.match(clip, /Setup \| Entry:/);
    assert.match(clip, /SL:/);
    assert.match(clip, /TP:/);
    assert.match(clip, /Signalcraft/);
    const toastOn = await page.$eval('#editorialToast', (el) => el.classList.contains('is-active'));
    assert.equal(toastOn, true);
    const toast = await page.$eval('#toastMessage', (el) => el.textContent);
    assert.match(toast, /copied|kopiert|copiad|نُسخت|已复制/i);
    await page.close();
  });

  it('slash focuses the search; slash inside the field stays a character', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await page.evaluate(() => document.body.click());
    await page.keyboard.press('/');
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(focused, 'pairSearchInput');
    await page.click('#pairSearchInput', { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.keyboard.type('SOL');
    await page.keyboard.press('/');
    const val = await page.$eval('#pairSearchInput', (el) => el.value);
    assert.match(val, /SOL\//);
    await page.close();
  });

  it('Spanish cards show copy-levels and a LONG badge', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'es' });
    const copy = await page.$eval('[data-copy-levels]', (el) => el.textContent);
    assert.match(copy, /Copiar|niveles/i);
    const badge = await page.$eval('.direction-badge', (el) => el.textContent);
    assert.match(badge, /LONG/);
    await page.close();
  });

  it('theme options are plain and free in English', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    const amber = await page.$eval('#themeSelect option[value="terminal-amber"]', (el) => el.textContent);
    const paper = await page.$eval('#themeSelect option[value="paper-light"]', (el) => el.textContent);
    assert.match(amber, /Terminal Amber/);
    assert.match(paper, /Paper Light/);
    assert.equal(/Unlock|Freigeschaltet/.test(amber), false);
    await page.close();
  });

  it('Fear & Greed badge localizes with the language switcher', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en', fng: { value: 72, classification: 'Greed' } });
    await new Promise((r) => setTimeout(r, 400));
    const en = await page.$eval('#globalFngBadge', (el) => el.textContent);
    assert.match(en, /Index 72/);
    assert.match(en, /Greed/);
    await page.select('#langSelect', 'de');
    await new Promise((r) => setTimeout(r, 250));
    const de = await page.$eval('#globalFngBadge', (el) => el.textContent);
    assert.match(de, /72/);
    assert.match(de, /Gier|Neutral/);
    await page.close();
  });

  it('Fear & Greed badge honestly shows a dash when the API is unreachable', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'en' });
    await new Promise((r) => setTimeout(r, 400));
    const text = await page.$eval('#globalFngBadge', (el) => el.textContent);
    assert.equal(text.trim(), '● F&G –');
    await page.close();
  });
});
