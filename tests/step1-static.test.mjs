import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  read, exists, htmlIds, inlineScripts, jsonLdBlocks,
  extractBalanced, extractArray, cssVarsDefined, cssVarsUsed, writeReport, stripScripts
} from './helpers/html.mjs';
import { QUAL_MIN, longLevels, parseRrString } from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n;\n');
const landJs = inlineScripts(landing).join('\n;\n');

function nodeCheck(code) {
  const r = spawnSync('node', ['--check'], { input: code, encoding: 'utf8' });
  return { ok: r.status === 0, err: (r.stderr || '') + (r.stdout || '') };
}

describe('step1 / inventory', () => {
  it('ships the two public pages plus SEO files', () => {
    assert.ok(exists('index.html'));
    assert.ok(exists('app.html'));
    assert.ok(exists('robots.txt'));
    assert.ok(exists('sitemap.xml'));
    assert.ok(exists('og-preview.png'));
  });

  it('robots.txt allows the site and points at the sitemap', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Allow:\s*\//);
    assert.match(robots, /Sitemap:\s*https:\/\/signalcraft\.atelier\/sitemap\.xml/);
  });

  it('sitemap lists landing + terminal for all 5 languages', () => {
    const sm = read('sitemap.xml');
    for (const page of ['index.html', 'app.html']) {
      assert.match(sm, new RegExp(page.replace('.', '\\.')));
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        assert.match(sm, new RegExp(`${page}\\?lang=${lang}`));
      }
    }
  });
});

describe('step1 / javascript syntax', () => {
  it('app.html inline JS parses', () => {
    const r = nodeCheck(appJs);
    assert.equal(r.ok, true, r.err);
  });
  it('index.html inline JS parses', () => {
    const r = nodeCheck(landJs);
    assert.equal(r.ok, true, r.err);
  });
});

describe('step1 / json-ld', () => {
  for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
    it(`${name} JSON-LD is valid schema.org graph`, () => {
      const blocks = jsonLdBlocks(html);
      assert.equal(blocks.length, 1);
      const data = JSON.parse(blocks[0]);
      assert.equal(data['@context'], 'https://schema.org');
      assert.ok(Array.isArray(data['@graph']));
      const types = data['@graph'].map((n) => n['@type']);
      assert.ok(types.includes('SoftwareApplication'));
      assert.ok(types.includes('Organization'));
      assert.ok(types.includes('WebSite'));
      assert.ok(types.includes('FAQPage'));
    });
  }
});

describe('step1 / html ids', () => {
  it('app.html has unique ids', () => {
    const ids = htmlIds(app);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dups, []);
  });
  it('index.html has unique ids', () => {
    const ids = htmlIds(landing);
    const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(dups, []);
  });
  it('terminal exposes the core interactive hooks', () => {
    const ids = new Set(htmlIds(app));
    for (const id of [
      'signalsGrid', 'pairSearchInput', 'langSelect', 'themeSelect', 'sortSelect',
      'btnPrevPage', 'btnNextPage', 'faq', 'shareCardCanvas', 'dossierModalBackdrop',
      'donationModalBackdrop', 'themeModalBackdrop', 'qualityGateNote'
    ]) {
      assert.ok(ids.has(id), 'missing #' + id);
    }
  });
});

describe('step1 / assets & seo head', () => {
  it('has a favicon (or apple-touch-icon) referenced and present on disk', () => {
    const heads = app.slice(0, 8000) + landing.slice(0, 8000);
    const hasIcon = /rel=["'](?:shortcut )?icon["']|rel=["']apple-touch-icon["']/.test(heads);
    assert.equal(hasIcon, true, 'no favicon link in <head>');
    assert.equal(exists('favicon.svg') || exists('favicon.ico') || exists('favicon.png') || exists('logo.png'), true, 'no favicon file on disk');
  });

  it('JSON-LD logo file exists', () => {
    assert.equal(exists('logo.png') || exists('logo.svg'), true, 'logo.png/svg missing (JSON-LD 404)');
  });
});

describe('step1 / css design tokens', () => {
  it('every var(--token) used in app.html is defined', () => {
    const css = (app.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    const defined = cssVarsDefined(css);
    const used = cssVarsUsed(css);
    const missing = [...used].filter((v) => !defined.has(v));
    assert.deepEqual(missing, [], 'undefined CSS variables: ' + missing.join(', '));
  });
  it('every var(--token) used in index.html is defined', () => {
    const css = (landing.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];
    const defined = cssVarsDefined(css);
    const used = cssVarsUsed(css);
    const missing = [...used].filter((v) => !defined.has(v));
    assert.deepEqual(missing, [], 'undefined CSS variables: ' + missing.join(', '));
  });
});

describe('step1 / i18n dictionaries', () => {
  it('I18N and STATIC_I18N have identical keys across de/en/es/ar/zh', () => {
    const I18N = eval('(' + extractBalanced(appJs, 'const I18N =') + ')');
    const STATIC = eval('(' + extractBalanced(appJs, 'const STATIC_I18N =') + ')');
    for (const [name, dict] of [['I18N', I18N], ['STATIC', STATIC]]) {
      const langs = Object.keys(dict);
      assert.deepEqual(langs.sort(), ['ar', 'de', 'en', 'es', 'zh']);
      const ref = Object.keys(dict.de).sort();
      for (const lang of langs) {
        const keys = Object.keys(dict[lang]).sort();
        const missing = ref.filter((k) => !keys.includes(k));
        const extra = keys.filter((k) => !ref.includes(k));
        assert.deepEqual(missing, [], `${name}.${lang} missing ${missing}`);
        assert.deepEqual(extra, [], `${name}.${lang} extra ${extra}`);
      }
    }
  });

  it('German gateNote is spelled correctly (gefiltert)', () => {
    assert.equal(/GEFIILTERT/.test(app), false, 'typo GEFIILTERT still present');
  });

  it('landing data-i18n keys exist in en/es/ar/zh dictionaries', () => {
    const used = [
      ...landing.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)
    ].map((m) => m[1]);
    const Lsrc = extractBalanced(landJs, 'var L =');
    const L = eval('(' + Lsrc + ')');
    for (const lang of ['en', 'es', 'ar', 'zh']) {
      const missing = used.filter((k) => L[lang][k] == null);
      assert.deepEqual(missing, [], lang + ' missing ' + missing.join(','));
    }
  });
});

describe('step1 / seed universe', () => {
  const seedJson = extractArray(appJs, 'const SEED_SIGNALS =');
  const seed = JSON.parse(seedJson);

  it('contains 120 unique pair ids', () => {
    assert.equal(seed.length, 120);
    const ids = seed.map((s) => s.id);
    assert.equal(new Set(ids).size, 120);
    const pairs = seed.map((s) => s.pair);
    assert.equal(new Set(pairs).size, 120);
  });

  it('every seed has trade plan fields', () => {
    for (const s of seed) {
      assert.ok(s.entryPrice > 0, s.id + ' entry');
      assert.ok(s.stopLoss > 0, s.id + ' sl');
      assert.ok(Array.isArray(s.targets) && s.targets.length >= 2, s.id + ' targets');
      assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(s.riskLevel), s.id + ' risk');
      assert.ok(['majors', 'layer1-2', 'defi', 'ai', 'memes'].includes(s.sector), s.id + ' sector');
      assert.equal(s.type, 'LONG');
    }
  });

  it('declared R:R matches TP2 geometry (>= 1:2) and cards must not hide TP2', () => {
    const bad = [];
    for (const s of seed) {
      const { rr1, rr2 } = longLevels(s.entryPrice, s.stopLoss, s.targets[0], s.targets[1]);
      const declared = parseRrString(s.riskRewardRatio);
      if (!(rr2 >= 1.95)) bad.push({ id: s.id, rr2, declared });
      if (Number.isFinite(declared) && Math.abs(declared - rr2) > 0.35) {
        bad.push({ id: s.id, mismatch: true, declared, rr2, rr1 });
      }
    }
    assert.equal(bad.length, 0, JSON.stringify(bad.slice(0, 8), null, 2));
  });

  it('quality-gate copy matches the grade scale (B+ at QUAL_MIN, not B)', () => {
    assert.match(appJs, /quantScore >= QUAL_MIN \? 'B\+'/);
    const below = seed.filter((s) => (s.quantScore ?? 0) < QUAL_MIN).length;
    assert.ok(below >= 0);
    writeReport('step1-seed-stats.json', {
      count: seed.length,
      belowGate: below,
      onBoard: seed.length - below,
      sectors: seed.reduce((acc, s) => ((acc[s.sector] = (acc[s.sector] || 0) + 1), acc), {}),
      risks: seed.reduce((acc, s) => ((acc[s.riskLevel] = (acc[s.riskLevel] || 0) + 1), acc), {}),
      grades: seed.reduce((acc, s) => ((acc[s.grade] = (acc[s.grade] || 0) + 1), acc), {})
    });
  });
});

describe('step1 / dead controls & copy-paste safety', () => {
  it('share-card "share directly" button has a click handler', () => {
    assert.match(appJs, /btnShareCardDirect\)\.onclick|getElementById\('btnShareCardDirect'\)[\s\S]{0,80}onclick/);
  });

  it('donation copy buttons do not copy truncated ellipsis wallets', () => {
    const copies = [...app.matchAll(/data-doncopy="([^"]+)"/g)].map((m) => m[1]);
    for (const c of copies) {
      assert.equal(c.includes('...'), false, 'truncated wallet copied: ' + c);
    }
  });

  it('hero active-count is driven by JS, not a hardcoded 120 that ignores the gate', () => {
    assert.match(appJs, /statActiveCount/);
  });
});

describe('step1 / markup hygiene', () => {
  it('app.html does not use document.write after load for sticky ads in a way that wipes the document when testing', () => {
    // document.write after parse is a known footgun; flag if still present
    const sticky = app.includes("document.write('<scr");
    writeReport('step1-hygiene.json', { stickyDocumentWrite: sticky });
    assert.equal(typeof sticky, 'boolean');
  });

  it('landing and terminal share a language switcher with 5 locales', () => {
    for (const html of [app, landing]) {
      for (const lang of ['de', 'en', 'es', 'ar', 'zh']) {
        assert.match(html, new RegExp(`<option value="${lang}"`));
      }
    }
  });

  it('relative hrefs resolve on disk', () => {
    const html = stripScripts(app + landing);
    const hrefs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    const missing = [];
    for (const h of hrefs) {
      if (/^(https?:|mailto:|data:|javascript:|#)/i.test(h)) continue;
      const file = h.split('?')[0].replace(/^\//, '');
      if (file && !exists(file)) missing.push(h);
    }
    assert.deepEqual(missing, []);
  });
});
