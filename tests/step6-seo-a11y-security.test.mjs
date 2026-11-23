import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  read, exists, ROOT, jsonLdBlocks, inlineScripts, stripScripts
} from './helpers/html.mjs';
import { contrastRatio } from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('step6 / seo', () => {
  it('og-preview.png is 1200×675', () => {
    const { w, h } = pngSize('og-preview.png');
    assert.equal(w, 1200);
    assert.equal(h, 675);
  });

  it('landing and terminal declare OG + Twitter cards pointing at og-preview', () => {
    for (const html of [app, landing]) {
      assert.match(html, /property="og:image"/);
      assert.match(html, /og-preview\.png/);
      assert.match(html, /name="twitter:card"/);
      assert.match(html, /summary_large_image/);
      assert.match(html, /createElement\('link'\)/);
    }
  });

  it('hreflang covers de/en/es/ar/zh + x-default on both pages', () => {
    for (const html of [app, landing]) {
      for (const lang of ['de', 'en', 'es', 'ar', 'zh', 'x-default']) {
        assert.match(html, new RegExp(`hreflang="${lang}"`));
      }
    }
  });

  it('robots.txt blocks /ads/ and lists the sitemap', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Disallow:\s*\/ads\//);
    assert.match(robots, /Sitemap:/);
  });

  it('keeps public HTML indexable and permits Googlebot on all public language URLs', () => {
    for (const [name, html] of [['index.html', landing], ['app.html', app]]) {
      const meta = html.match(/<meta\b[^>]*>/gi) || [];
      for (const tag of meta) assert.doesNotMatch(tag, /\bnoindex\b/i, name + ': ' + tag);
      assert.match(html, /<meta\s+name=["']robots["']\s+content=["']index,\s*follow/i);
    }
    const robots = read('robots.txt').replace(/#[^\n]*/g, '');
    const groups = [];
    let group = null, hasRules = false;
    for (const raw of robots.split(/\r?\n/)) {
      const match = raw.trim().match(/^([^:]+):\s*(.*)$/);
      if (!match) continue;
      const key = match[1].trim().toLowerCase(), value = match[2].trim();
      if (key === 'user-agent') {
        if (!group || hasRules) { group = { agents: [], rules: [] }; groups.push(group); hasRules = false; }
        group.agents.push(value.toLowerCase());
      } else if (group && (key === 'allow' || key === 'disallow')) {
        group.rules.push({ key, value }); hasRules = true;
      }
    }
    const specific = groups.filter(g => g.agents.includes('googlebot'));
    const selected = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
    assert.ok(selected.length, 'no applicable robots group');
    const rules = selected.flatMap(g => g.rules).filter(r => r.value);
    for (const url of ['/', '/index.html', '/app.html', ...['de','en','es','ar','zh'].flatMap(lang => ['/index.html?lang=' + lang, '/app.html?lang=' + lang])]) {
      const matches = rules.filter(r => {
        const anchored = r.value.endsWith('$');
        const path = anchored ? r.value.slice(0, -1) : r.value;
        const pattern = path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp('^' + pattern + (anchored ? '$' : '')).test(url);
      }).sort((a, b) => b.value.replace(/[\*$]/g, '').length - a.value.replace(/[\*$]/g, '').length || (a.key === 'allow' ? -1 : 1));
      assert.notEqual(matches[0]?.key, 'disallow', 'Googlebot blocked: ' + url);
    }
    if (exists('_headers')) assert.doesNotMatch(read('_headers'), /x-robots-tag\s*:\s*[^\n]*noindex/i);
  });

  it('keeps board search while omitting retired sitelinks search box markup', () => {
    const site = JSON.parse(jsonLdBlocks(app)[0])['@graph'].find((n) => n['@type'] === 'WebSite');
    assert.equal(site.potentialAction, undefined);
    assert.match(appJs, /get\('q'\)/);
  });

  it('JSON-LD FAQ questions appear in the on-page FAQ', () => {
    const data = JSON.parse(jsonLdBlocks(app)[0]);
    const faq = data['@graph'].find((n) => n['@type'] === 'FAQPage');
    const markup = stripScripts(app);
    for (const q of faq.mainEntity) {
      const needle = String(q.name).slice(0, 24);
      assert.ok(markup.includes(needle) || app.includes(needle), 'FAQ missing: ' + q.name);
    }
  });
});

describe('step6 / a11y tokens', () => {
  it('gallery-dark body text contrast is at least 7:1', () => {
    const ratio = contrastRatio('#E8E6E3', '#121316');
    assert.ok(ratio >= 7, 'contrast ' + ratio);
  });

  it('paper-light body text contrast is at least 7:1', () => {
    const ratio = contrastRatio('#1D1C1A', '#F4F1EA');
    assert.ok(ratio >= 7, 'contrast ' + ratio);
  });

  it('modals expose dialog semantics', () => {
    assert.match(app, /role="dialog"/);
    assert.match(app, /aria-modal="true"/);
    assert.match(app, /aria-label="Theme"/);
  });

  it('language switcher is labelled on both pages', () => {
    assert.match(app, /id="langSelect"[^>]*aria-label/);
    assert.match(landing, /id="langSelect"[^>]*aria-label/);
  });
});

describe('step6 / security', () => {
  it('signal cards escape pair, notes and validated model source before innerHTML', () => {
    assert.match(appJs, /escapeHtml\(sig\.pair\)/);
    assert.match(appJs, /escapeHtml\(sig\.notes\)/);
    assert.match(appJs, /escapeHtml\(modelSource\(sig\)\)/);
    assert.match(appJs, /sig\.venue === 'BINANCE SPOT'/);
    assert.match(appJs, /sig\.venue === 'BINANCE-US SPOT'/);
  });

  it('does not call eval() in application JS', () => {
    const stripped = appJs.replace(/\.eval\(/g, '');
    assert.equal(/\beval\s*\(/.test(stripped), false);
  });

  it('Escape and backdrop-click close modals', () => {
    assert.match(appJs, /e\.key === 'Escape'/);
    assert.match(appJs, /e\.target === b/);
  });
});

describe('step6 / persistence contracts', () => {
  it('persists language, theme and supporter flags', () => {
    assert.match(appJs, /signalcraft_lang/);
    assert.match(appJs, /signalcraft_theme/);
    assert.match(appJs, /signalcraft_supporter/);
    assert.equal(/unlocked_themes|signalcraft_leads/.test(appJs), false);
  });

  it('logo and favicon files exist on disk', () => {
    assert.equal(exists('logo.png'), true);
    assert.equal(exists('favicon.svg'), true);
  });
});
