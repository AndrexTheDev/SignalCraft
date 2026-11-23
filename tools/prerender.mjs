// Render only static translations and SEO. Never run the market engine or persist live user data.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const langs = ['de', 'en', 'es', 'ar', 'zh'];
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node tools/prerender.mjs [--check]');
let stale = false;
for (const file of ['index.html', 'app.html']) {
  const source = await readFile(resolve(root, file), 'utf8');
  for (const lang of langs) {
    const url = 'https://signalcraft.click/' + (file === 'app.html' ? 'app' : '') + (lang === 'de' ? '' : '?lang=' + lang);
    const dom = new JSDOM(source, { url, runScripts: 'outside-only' });
    const { document } = dom.window;
    const scripts = [...document.querySelectorAll('script:not([type])')];
    if (file === 'index.html') {
      if (scripts.length !== 2) throw new Error('Landing script layout changed');
      const german = {};
      document.querySelectorAll('[data-i18n]').forEach(el => { german[el.getAttribute('data-i18n')] = el.textContent; });
      document.querySelectorAll('[data-i18n-html]').forEach(el => { german[el.getAttribute('data-i18n-html')] = el.innerHTML; });
      dom.window.eval(scripts[0].textContent);
      dom.window.eval(scripts[1].textContent);
      const data = document.createElement('script'); data.id = 'german-source-strings'; data.type = 'application/json';
      data.textContent = JSON.stringify(german).replace(/</g, '\\u003c');
      document.body.insertBefore(data, scripts[1]);
    } else {
      if (scripts.length !== 1) throw new Error('Terminal script layout changed');
      const js = scripts[0].textContent;
      const start = js.indexOf('    const STATIC_I18N = {');
      const end = js.indexOf('    // 1c. SIGNAL CONTENT LOCALIZATION OVERLAY', start);
      if (start < 0 || end < 0) throw new Error('Terminal i18n section missing');
      // Only the static localization path runs. Dynamic board/ticker data remain placeholders.
      dom.window.eval(`let currentLang = ${JSON.stringify(lang)};\nfunction updateSectorPillCounts() {}\nfunction updateDonationTexts() {}\n${js.slice(start, end)}\napplyStaticTranslations();`);
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
      document.querySelector('#langSelect option[value="' + lang + '"]').setAttribute('selected', '');
      document.getElementById('ftBack').setAttribute('href', '/' + (lang === 'de' ? '' : '?lang=' + lang));
      const noScript = {
        de: 'Für interaktive Terminalfunktionen ist JavaScript erforderlich. Die Sprachlinks stehen im Footer.',
        en: 'JavaScript is required for interactive terminal features. Language links are in the footer.',
        es: 'Las funciones interactivas del terminal requieren JavaScript. Los enlaces de idioma están en el pie de página.',
        ar: 'تتطلب وظائف المنصة التفاعلية جافاسكريبت. روابط اللغات في تذييل الصفحة.',
        zh: '终端的交互功能需要 JavaScript。语言链接位于页脚。'
      };
      document.querySelector('noscript p').textContent = noScript[lang];
    }
    const selected = document.querySelector('#langSelect option[value="' + lang + '"]');
    document.querySelectorAll('#langSelect option[selected]').forEach(el => el.removeAttribute('selected'));
    selected.setAttribute('selected', '');
    const canonical = document.querySelectorAll('link[rel="canonical"]');
    if (canonical.length !== 1 || canonical[0].href !== url || document.documentElement.lang !== lang) throw new Error(`Invalid generated SEO for ${url}`);
    const output = dom.serialize() + '\n';
    const destination = resolve(root, '_localized', lang, file);
    if (check) {
      let existing = ''; try { existing = await readFile(destination, 'utf8'); } catch {}
      if (existing !== output) { console.error(`Stale or missing: ${destination}`); stale = true; }
    } else {
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, output);
    }
    dom.window.close();
  }
}
if (stale) process.exitCode = 1;
else console.log(check ? 'Prerendered pages are current.' : 'Generated ten localized pages.');
