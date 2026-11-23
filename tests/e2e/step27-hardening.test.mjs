import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  startServer, stopServer, launchBrowser, freshPage, gotoApp
} from '../helpers/browser.mjs';

let browser;

describe('step27 hardening e2e', { timeout: 180_000 }, () => {
  before(async () => {
    await startServer();
    browser = await launchBrowser();
  });
  after(async () => {
    if (browser) await browser.close();
    stopServer();
  });

  it('LIVE badge; exclusive board renders exactly the gated set in DE and ES', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });
    const badge = await page.$eval('#meBadge', (el) => el.textContent);
    assert.match(badge, /LIVE/);
    const nDe = await page.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(nDe, 10);
    // pagination UI was removed with the exclusive board
    assert.equal(await page.$('#paginationInfoLabel'), null);
    assert.equal(await page.$('#btnNextPage'), null);
    assert.deepEqual(page._pageErrors, []);
    await page.close();

    const pageEs = await freshPage(browser);
    await gotoApp(pageEs, { lang: 'es' });
    const nEs = await pageEs.$$eval('#signalsGrid .signal-card[data-id]', (els) => els.length);
    assert.equal(nEs, 10);
    const esNote = await pageEs.$eval('#qualityGateNote', (el) => el.textContent);
    assert.ok(esNote.length > 10);
    assert.deepEqual(pageEs._pageErrors, []);
    await pageEs.close();
  });

  it('dossier data, share canvas, sentiment, donation copy — no page errors', async () => {
    const page = await freshPage(browser);
    await gotoApp(page, { lang: 'de' });

    await page.click('[data-toggle-sentiment]');
    await page.waitForSelector('.sentiment-drawer-panel.is-open');
    const sent = await page.$eval('.sentiment-drawer-panel.is-open', (el) => el.textContent);
    assert.ok(sent.trim().length > 20);

    await page.click('[data-inspect-sig]');
    await page.waitForSelector('#dossierModalBackdrop.is-visible', { timeout: 5000 });
    const dos = await page.$eval('#dossierBody', (el) => el.textContent);
    assert.match(dos, /24h-Volumen/);
    assert.match(dos, /Taker-Kaufanteil/);
    assert.match(dos, /\d{2}:\d{2}:\d{2} UTC/);
    assert.equal(dos.includes('<img'), false);
    await page.click('#btnCloseDossierModal');
    await new Promise((r) => setTimeout(r, 150));

    await page.click('[data-share-sig]');
    await page.waitForSelector('#shareCardModalBackdrop.is-visible', { timeout: 5000 });
    const share = await page.$eval('#shareCardCanvas', (el) => ({ w: el.width, h: el.height }));
    assert.equal(share.w, 1200);
    assert.equal(share.h, 675);
    await page.click('#btnCloseShareCardModal');
    await new Promise((r) => setTimeout(r, 150));

    await page.evaluate(() => {
      window.__copied = '';
      navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    });
    await page.click('#btnOpenDonation');
    await page.waitForSelector('#donationModalBackdrop.is-visible');
    await page.click('#btnDonSol');
    const copied = await page.evaluate(() => window.__copied);
    assert.equal(copied, '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8');

    assert.deepEqual(page._pageErrors, []);
    await page.close();
  });
});
