import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, exists, inlineScripts, extractBalanced, stripScripts
} from './helpers/html.mjs';
import { parseBoardQuery, serializeBoardQuery } from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const LANGS = ['de', 'en', 'es', 'ar', 'zh'];

function parseObj(src, marker) {
  const raw = extractBalanced(src, marker);
  assert.ok(raw, 'missing ' + marker);
  return Function('return (' + raw + ')')();
}

describe('step9 / board URL helpers', () => {
  it('parses sector, short risk, sort, q and sig', () => {
    const st = parseBoardQuery('?sector=majors&risk=low&sort=sentiment&q=BTC&sig=SIG-BTC-014&lang=en');
    assert.equal(st.sector, 'majors');
    assert.equal(st.risk, 'risk-low');
    assert.equal(st.sort, 'sentiment');
    assert.equal(st.q, 'BTC');
    assert.equal(st.sig, 'SIG-BTC-014');
    assert.equal(st.lang, 'en');
  });

  it('accepts risk-* long form and trims q', () => {
    const st = parseBoardQuery('risk=risk-high&q=%20SOL%20');
    assert.equal(st.risk, 'risk-high');
    assert.equal(st.q, 'SOL');
  });

  it('falls back to defaults on invalid sector/sort/risk', () => {
    const st = parseBoardQuery('?sector=foo&sort=alpha&risk=extreme');
    assert.equal(st.sector, 'all');
    assert.equal(st.sort, 'confluence');
    assert.equal(st.risk, 'all');
    assert.equal(st.q, '');
    assert.equal(st.sig, '');
  });

  it('serializes short risk and omits default board keys', () => {
    const qs = serializeBoardQuery({
      sector: 'all',
      risk: 'all',
      sort: 'confluence',
      q: '',
      sig: ''
    }, '?lang=en');
    const p = new URLSearchParams(qs);
    assert.equal(p.get('lang'), 'en');
    assert.equal(p.has('sector'), false);
    assert.equal(p.has('risk'), false);
    assert.equal(p.has('sort'), false);
    assert.equal(p.has('q'), false);
    assert.equal(p.has('sig'), false);
  });

  it('serializes active filters and preserves admin', () => {
    const qs = serializeBoardQuery({
      sector: 'majors',
      risk: 'risk-low',
      sort: 'time',
      q: 'ETH',
      sig: 'SIG-BTC-014'
    }, '?lang=en&admin=1');
    const p = new URLSearchParams(qs);
    assert.equal(p.get('lang'), 'en');
    assert.equal(p.get('admin'), '1');
    assert.equal(p.get('sector'), 'majors');
    assert.equal(p.get('risk'), 'low');
    assert.equal(p.get('sort'), 'time');
    assert.equal(p.get('q'), 'ETH');
    assert.equal(p.get('sig'), 'SIG-BTC-014');
  });

  it('round-trips board state through parse/serialize', () => {
    const original = '?lang=de&sector=ai&risk=medium&sort=risk&q=NEAR';
    const st = parseBoardQuery(original);
    const qs = serializeBoardQuery(st, original);
    const again = parseBoardQuery('?' + qs);
    assert.equal(again.sector, 'ai');
    assert.equal(again.risk, 'risk-medium');
    assert.equal(again.sort, 'risk');
    assert.equal(again.q, 'NEAR');
    assert.equal(again.lang, 'de');
  });
});

describe('step9 / terminal wires URL + modal helpers', () => {
  it('embeds parse/serialize/apply/sync board query helpers', () => {
    assert.match(appJs, /function parseBoardQuery\s*\(/);
    assert.match(appJs, /function serializeBoardQuery\s*\(/);
    assert.match(appJs, /function applyBoardFromUrl\s*\(/);
    assert.match(appJs, /function syncBoardQuery\s*\(/);
    assert.match(appJs, /history\.replaceState/);
  });

  it('opens dossiers from ?sig= and clears sig on close', () => {
    assert.match(appJs, /st\.sig|openDossierId/);
    assert.match(appJs, /function setModalVisible\s*\(/);
    assert.match(appJs, /openDossierId = ''/);
  });

  it('syncs theme-color with the active theme', () => {
    assert.match(appJs, /function syncThemeColor\s*\(/);
    assert.match(appJs, /meta\[name=["']theme-color["']\]/);
    assert.match(appJs, /paper-light/);
  });
});

describe('step9 / FAQ accordion a11y', () => {
  it('FAQ toggles are buttons with aria-expanded/controls and panel ids', () => {
    const faq = stripScripts(app);
    assert.match(faq, /class="faq-header-toggle"[^>]*type="button"/);
    assert.match(faq, /aria-expanded="true"/);
    assert.match(faq, /aria-controls="faq-panel-1"/);
    assert.match(faq, /id="faq-panel-1"/);
    assert.match(faq, /id="faq-panel-5"/);
    assert.match(appJs, /aria-expanded/);
  });
});

describe('step9 / labelled controls + modal close', () => {
  it('search, sort and modal close expose aria-labels in all 5 langs', () => {
    const stat = parseObj(appJs, 'const STATIC_I18N =');
    for (const lang of LANGS) {
      assert.ok(stat[lang].searchAria, lang + '.searchAria');
      assert.ok(stat[lang].sortAria, lang + '.sortAria');
      assert.ok(stat[lang].closeAria, lang + '.closeAria');
    }
    assert.match(stat.en.searchAria, /Search/i);
    assert.match(stat.de.closeAria, /Schlie/);
    assert.match(stripScripts(app), /id="pairSearchInput"[^>]*aria-label=/);
    assert.match(stripScripts(app), /id="sortSelect"[^>]*aria-label=/);
    assert.match(appJs, /s\.searchAria/);
    assert.match(appJs, /s\.sortAria/);
    assert.match(appJs, /s\.closeAria/);
  });

  it('setModalVisible focuses the closer and restores last focus', () => {
    assert.match(appJs, /lastModalFocus/);
    assert.match(appJs, /closer\.focus/);
    assert.match(appJs, /lastModalFocus\.focus/);
  });
});

describe('step9 / PWA head + sitemap', () => {
  it('both pages ship Apple / mobile-web-app meta tags', () => {
    for (const html of [app, landing]) {
      assert.match(html, /name="apple-mobile-web-app-capable"/);
      assert.match(html, /name="mobile-web-app-capable"/);
      assert.match(html, /name="apple-mobile-web-app-title"/);
    }
  });

  it('sitemap lastmod tracks the 3.5 release (2026-11-15)', () => {
    assert.equal(exists('sitemap.xml'), true);
    const sm = read('sitemap.xml');
    assert.match(sm, /<lastmod>2026-11-15<\/lastmod>/);
    assert.equal(/2026-09-20/.test(sm), false);
  });
});
