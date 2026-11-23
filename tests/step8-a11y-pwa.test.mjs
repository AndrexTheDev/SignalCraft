import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, exists, inlineScripts, extractBalanced, stripScripts
} from './helpers/html.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const LANGS = ['de', 'en', 'es', 'ar', 'zh'];

function parseObj(src, marker) {
  const raw = extractBalanced(src, marker);
  assert.ok(raw, 'missing ' + marker);
  return Function('return (' + raw + ')')();
}

describe('step8 / pwa manifest', () => {
  it('ships a valid web app manifest', () => {
    assert.equal(exists('site.webmanifest'), true);
    const man = JSON.parse(read('site.webmanifest'));
    assert.ok(man.name && man.short_name);
    assert.equal(man.start_url, '/app');
    assert.equal(man.display, 'standalone');
    assert.ok(Array.isArray(man.icons) && man.icons.length >= 2);
    assert.ok(man.icons.some((i) => /logo\.png/.test(i.src)));
    assert.ok(man.theme_color);
  });

  it('landing and terminal link the manifest', () => {
    for (const html of [app, landing]) {
      assert.match(html, /rel="manifest"/);
      assert.match(html, /href="site\.webmanifest"/);
    }
  });
});

describe('step8 / skip links', () => {
  it('both pages expose a skip-to-content control', () => {
    assert.match(stripScripts(app), /id="skipToSignals"/);
    assert.match(stripScripts(landing), /id="skipToContent"/);
    assert.match(app, /href="#signalsGrid"/);
    assert.match(landing, /href="#warum"/);
    assert.match(app, /id="signalsGrid"[^>]*tabindex="-1"/);
    assert.match(landing, /id="warum"[^>]*tabindex="-1"/);
  });

  it('skip labels exist in all five languages on the terminal', () => {
    const extra = parseObj(appJs, 'const EXTRA_I18N =');
    const stat = parseObj(appJs, 'const STATIC_I18N =');
    for (const lang of LANGS) {
      assert.ok(extra[lang].skipTo, lang);
      assert.ok(stat[lang].skipTo, lang);
    }
    assert.match(extra.de.skipTo, /Signalen|Inhalt/);
    assert.match(extra.en.skipTo, /Skip to signals/);
  });

  it('landing skipTo is translated in the i18n packs', () => {
    assert.match(landJs, /skipTo:\s*"Skip to content"/);
    assert.match(landJs, /skipTo:\s*"Ir al contenido"/);
    assert.match(landJs, /skipTo:\s*"跳到正文"/);
    assert.match(landing, /data-i18n="skipTo"/);
  });

  it('reduced-motion rules kill ticker / grain animation', () => {
    assert.match(app, /prefers-reduced-motion:\s*reduce/);
    assert.match(landing, /prefers-reduced-motion:\s*reduce/);
  });
});

describe('step8 / copy levels + slash search', () => {
  it('cards render a copy-levels control wired to the clipboard helper', () => {
    assert.match(appJs, /data-copy-levels=/);
    assert.match(appJs, /function copyLevelsText\s*\(/);
    assert.match(appJs, /function copySignalLevels\s*\(/);
    assert.match(appJs, /querySelectorAll\('\[data-copy-levels\]'\)/);
  });

  it('slash focuses the pair search unless the user is already typing', () => {
    assert.match(appJs, /e\.key === '\/'/);
    assert.match(appJs, /pairSearchInput/);
    assert.match(appJs, /tag === 'input'/);
  });
});

describe('step8 / leftover German runtime strings', () => {
  it('EXTRA_I18N covers the FNG helpers and share footer in 5 langs', () => {
    const extra = parseObj(appJs, 'const EXTRA_I18N =');
    for (const lang of LANGS) {
      for (const key of ['longBadge', 'sentLoading', 'shareFoot']) {
        assert.ok(extra[lang][key], lang + '.' + key);
      }
    }
  });

  it('runtime JS no longer hardcodes German vault/unlock toasts', () => {
    assert.equal(/confirm\('Sicher/.test(appJs), false);
    assert.equal(/options\[1\]\.text = '● Terminal Amber \(Freigeschaltet\)'/.test(appJs), false);
    assert.equal(/showToast\('Lade globale Sentiment/.test(appJs), false);
    assert.equal(/showToast\('Keine gespeicherten Leads/.test(appJs), false);
    assert.equal(/Zugriff autorisiert für AndrexTheDev/.test(appJs), false);
    assert.equal(/secretVaultModalBackdrop|openSecretVaultModal|relabelUnlockedThemes/.test(appJs), false);
    assert.match(appJs, /function tx\s*\(/);
    assert.match(appJs, /function fngClassLabel\s*\(/);
    assert.match(appJs, /tx\('shareFoot'\)/);
  });

  it('footer no longer truncates donation wallets', () => {
    assert.match(app, /79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8/);
    assert.equal(/79Ksqt\.\.\./.test(app), false);
  });
});
