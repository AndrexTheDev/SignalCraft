/** Shared Playwright helpers for Signalcraft functional / beta / screenshot runs. */

export const LANGS = ['de', 'en', 'es', 'ar', 'zh'];

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
  mobileSm: { width: 360, height: 740 }
};

const MARKET = /binance|bybit|kraken|okx|kucoin|mexc|bitget|huobi|gateio|crypto\.com|coinbase|alternative\.me|dexscreener|hyperliquid|dydx|binance\.vision|binance\.us/i;

export async function stubMarketApis(page) {
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (MARKET.test(url) && !/fonts\.googleapis|fonts\.gstatic|globalimmaturelunatic/.test(url)) {
      return route.abort();
    }
    return route.continue();
  });
}

export async function gotoLanding(page, { lang, viewport } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await stubMarketApis(page);
  const q = lang ? `?lang=${lang}` : '';
  await page.goto('/index.html' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hero-title, .hero-landing');
}

export async function gotoApp(page, { lang, viewport, unlockThemes = false } = {}) {
  if (viewport) await page.setViewportSize(viewport);
  await stubMarketApis(page);
  if (unlockThemes) {
    await page.addInitScript(() => {
      try { localStorage.setItem('unlocked_themes', 'true'); } catch (e) {}
    });
  }
  const q = lang ? `?lang=${lang}` : '';
  await page.goto('/app.html' + q, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#signalsGrid');
  await page.waitForTimeout(700);
  const gated = page.locator('.adgate-card');
  if (await gated.count()) {
    throw new Error('Ad-block gate visible in Playwright (false positive)');
  }
  await page.waitForSelector('#signalsGrid .signal-card', { timeout: 15_000 });
}

export async function noPageErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}
