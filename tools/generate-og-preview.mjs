// Regenerate the social preview from its editable SVG source; no network access.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../tests/helpers/browser.mjs';
const svg = await readFile(new URL('../assets/og-preview.svg', import.meta.url), 'utf8');
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 675, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:1200px;height:675px;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`);
  await page.screenshot({ path: fileURLToPath(new URL('../og-preview.png', import.meta.url)), type: 'png' });
} finally { await browser.close(); }
