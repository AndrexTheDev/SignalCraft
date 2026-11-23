import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, launchBrowser, freshPage, gotoApp, stubMarket, BASE } from '../helpers/browser.mjs';
import { read, extractArray } from '../helpers/html.mjs';
const seed = JSON.parse(extractArray(read('app.html'), 'const SEED_SIGNALS ='));
const fixtures = Array.from({ length: 100 }, (_, i) => ({
  ...seed[0], id: 'LINK-' + i, pair: `TEST${i} / USDT`, modelVersion: 3,
  quantScore: i < 10 ? 99 - i : i === 10 ? 86 : 70,
  gateMetrics: { rsi: 60, volMio: 20, adx: 25, riskAdj30: 1 }
}));
let browser;
async function liveLink(id, suffix = '') {
  const page = await freshPage(browser);
  await page.evaluateOnNewDocument(signals => {
    const t = Date.now();
    localStorage.setItem('signalcraft_live_v2', JSON.stringify({ version: 9, t, signals: signals.map(s => ({ ...s, confluenceScore: s.quantScore, metrics: { ...s.metrics, score: s.quantScore }, timestamp: t })) }));
  }, fixtures);
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
    if (url.pathname.endsWith('/ticker/24hr')) return;
    return req.abort().catch(() => {});
  });
  await page.goto(BASE + '/app.html?lang=en&sig=' + id + suffix, { waitUntil: 'domcontentloaded' });
  return page;
}
describe('step48 / board-only deep links and honest X sharing', { timeout: 120000 }, () => {
  before(async () => { await startServer(); browser = await launchBrowser(); });
  after(async () => { if (browser) await browser.close(); stopServer(); });
  it('rejects a known demo signal that fails the board gate, preserving the other URL state', async () => {
    const page = await freshPage(browser);
    try {
      await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
      await stubMarket(page);
      await page.goto(BASE + '/app.html?lang=en&sector=majors&q=BTC&campaign=test&sig=SIG-PEPE-001#faq', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('sig'));
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      const u = new URL(page.url());
      assert.equal(u.searchParams.get('q'), 'BTC'); assert.equal(u.searchParams.get('sector'), 'majors');
      assert.equal(u.searchParams.get('campaign'), 'test'); assert.equal(u.hash, '#faq');
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('explains unavailable deep links in all five languages', async () => {
    const notices = { de: /nicht mehr.*aktuellen Board/, en: /no longer available/, es: /ya no está disponible/, ar: /لم تعد متاحة/, zh: /已不在当前看板中/ };
    for (const [lang, expected] of Object.entries(notices)) {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
        await stubMarket(page);
        await page.goto(BASE + '/app.html?lang=' + lang + '&sig=SIG-PEPE-001', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('sig'));
        assert.match(await page.$eval('#toastMessage', el => el.textContent), expected);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  it('rejects an otherwise gate-qualified setup ranked outside the top ten', async () => {
    const page = await liveLink('LINK-10', '&campaign=test');
    try {
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('sig'));
      assert.match(await page.$eval('#meBadge', el => el.textContent), /LIVE/);
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.equal(new URL(page.url()).searchParams.get('campaign'), 'test');
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('opens a top-ten deep link even when board filters hide its card', async () => {
    const page = await liveLink('LINK-5', '&q=nomatch&campaign=test#faq');
    try {
      await page.waitForSelector('#dossierModalBackdrop.is-visible');
      assert.match(await page.$eval('#dossierTitle', el => el.textContent), /TEST5/);
      assert.equal(await page.$$eval('#signalsGrid .signal-card', els => els.length), 0);
      await page.click('#btnCloseDossierModal');
      const u = new URL(page.url());
      assert.equal(u.searchParams.get('sig'), null); assert.equal(u.searchParams.get('q'), 'nomatch');
      assert.equal(u.searchParams.get('campaign'), 'test'); assert.equal(u.hash, '#faq');
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('enforces the board gate inside the dossier opener, not only during URL parsing', async () => {
    const page = await freshPage(browser);
    try {
      const instrumented = read('app.html').replace('    ME.refresh(false);', '    window.__dossierTest = { openDossierModal, seed: SEED_SIGNALS }; ME.refresh(false);');
      await page.evaluateOnNewDocument(() => localStorage.removeItem('signalcraft_live_v2'));
      await page.setRequestInterception(true);
      page.on('request', req => {
        const url = new URL(req.url());
        if (url.origin === new URL(BASE).origin && url.pathname === '/app.html') return req.respond({ status: 200, contentType: 'text/html', body: instrumented }).catch(() => {});
        if (url.origin === new URL(BASE).origin) return req.continue().catch(() => {});
        return req.abort().catch(() => {});
      });
      await page.goto(BASE + '/app.html?lang=en', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => window.__dossierTest.openDossierModal(window.__dossierTest.seed[0]));
      assert.equal(await page.$eval('#dossierModalBackdrop', el => el.classList.contains('is-visible')), false);
      assert.match(await page.$eval('#toastMessage', el => el.textContent), /no longer available/i);
      assert.deepEqual(page._pageErrors, []);
    } finally { await page.close(); }
  });
  it('keeps link sharing available when canvas preview cannot be created', async () => {
    for (const mode of ['missing', 'throws']) {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => {
          localStorage.removeItem('signalcraft_live_v2');
          window.open = (url, target, features) => { window._share = { url, target, features }; return null; };
        });
        await gotoApp(page, { lang: 'en' });
        await page.evaluate(mode => {
          document.getElementById('shareCardCanvas').getContext = mode === 'missing' ? () => null : () => ({ fillRect() { throw new Error('draw failed'); } });
          document.querySelector('[data-share-sig]').click();
        }, mode);
        assert.match(await page.$eval('#shareCardDataState', el => el.textContent), /Preview unavailable/);
        assert.equal(await page.$eval('#btnDownloadCardPng', el => el.disabled), true);
        assert.equal(await page.$eval('#btnShareCardDirect', el => el.disabled), false);
        await page.click('#btnShareCardDirect');
        assert.equal(new URL(await page.evaluate(() => window._share.url)).searchParams.get('url'), 'https://signalcraft.click/app?lang=en');
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    }
  });
  const cases = {
    de: [/Nur Link auf X teilen \(ohne Bild\)/, /bis zu 10/, /aktuelle/],
    en: [/Share link on X \(no image\)/, /up to 10/, /current board/],
    es: [/Compartir enlace en X \(sin imagen\)/, /hasta 10/, /tablero actual/],
    ar: [/مشاركة الرابط على X \(بدون صورة\)/, /حتى 10/, /اللوحة الحالية/],
    zh: [/在 X 分享链接（不含图片）/, /10/, /当前看板/]
  };
  for (const [lang, [label, capacity, current]] of Object.entries(cases)) {
    it(`shares only a localized board link on X in ${lang}`, async () => {
      const page = await freshPage(browser);
      try {
        await page.evaluateOnNewDocument(() => {
          localStorage.removeItem('signalcraft_live_v2');
          window.open = (url, target, features) => { window._share = { url, target, features }; return null; };
        });
        await gotoApp(page, { lang });
        await page.evaluate(() => document.querySelector('[data-share-sig]').click());
        assert.match(await page.$eval('#btnShareCardDirect', el => el.textContent), label);
        await page.click('#btnShareCardDirect');
        const share = await page.evaluate(() => window._share);
        const intent = new URL(share.url);
        assert.equal(intent.hostname, 'twitter.com'); assert.equal(intent.pathname, '/intent/tweet');
        const url = new URL(intent.searchParams.get('url'));
        assert.equal(url.origin + url.pathname, 'https://signalcraft.click/app'); assert.equal(url.searchParams.get('lang'), lang);
        assert.match(intent.searchParams.get('text'), capacity); assert.match(intent.searchParams.get('text'), current);
        assert.equal(intent.searchParams.has('media'), false);
        assert.equal(share.target, '_blank'); assert.match(share.features, /noopener/);
        assert.deepEqual(page._pageErrors, []);
      } finally { await page.close(); }
    });
  }
});
