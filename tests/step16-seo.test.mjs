import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, exists, jsonLdBlocks, inlineScripts, stripScripts, extractBalanced, writeReport
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

function graph(html) {
  const blocks = jsonLdBlocks(html);
  assert.equal(blocks.length, 1);
  const data = JSON.parse(blocks[0]);
  assert.equal(data['@context'], 'https://schema.org');
  return data['@graph'];
}

function byType(nodes, type) {
  return nodes.filter((n) => n['@type'] === type);
}

describe('step16 / json-ld graph', () => {
  for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
    it(`${name} adds WebPage + BreadcrumbList and keeps the core types`, () => {
      const nodes = graph(html);
      const types = nodes.map((n) => n['@type']);
      for (const t of ['SoftwareApplication', 'Organization', 'WebSite', 'FAQPage', 'WebPage', 'BreadcrumbList']) {
        assert.ok(types.includes(t), name + ' missing ' + t);
      }
    });

    it(`${name} Organization has logo ImageObject, email and sameAs`, () => {
      const org = byType(graph(html), 'Organization')[0];
      assert.ok(org.logo);
      const logo = typeof org.logo === 'string' ? org.logo : org.logo.url;
      assert.match(logo, /logo\.png/);
      if (org.logo && org.logo['@type'] === 'ImageObject') {
        assert.equal(org.logo.width, 512);
        assert.equal(org.logo.height, 512);
      }
      assert.ok(Array.isArray(org.sameAs) && org.sameAs.length >= 2);
      assert.ok(org.sameAs.some((u) => /x\.com\/SignalcraftDesk/.test(u)));
      assert.match(String(org.email || org.contactPoint && org.contactPoint.email), /hippie\.highho@gmail\.com/);
    });

    it(`${name} SoftwareApplication is free, versioned and imaged`, () => {
      const appNode = byType(graph(html), 'SoftwareApplication')[0];
      assert.equal(appNode.isAccessibleForFree, true);
      assert.match(String(appNode.url), /\/app$/);
      assert.match(String(appNode.image || ''), /og-preview\.png/);
      assert.equal(appNode.offers.priceCurrency, 'EUR');
      assert.ok(Array.isArray(appNode.availableLanguage));
      assert.deepEqual(appNode.availableLanguage.slice().sort(), LANGS.slice().sort());
    });
  }

  it('app FAQ JSON-LD names are visible in the on-page FAQ', () => {
    const faq = byType(graph(app), 'FAQPage')[0];
    const markup = stripScripts(app);
    assert.ok(faq.mainEntity.length >= 5);
    for (const q of faq.mainEntity) {
      const needle = String(q.name).replace(/^\d+\.\s*/, '').slice(0, 28);
      assert.ok(markup.includes(needle), 'FAQ schema not on page: ' + q.name);
    }
  });

  it('does not advertise the retired sitelinks search box', () => {
    for (const html of [app, landing]) assert.equal(byType(graph(html), 'WebSite')[0].potentialAction, undefined);
  });
});

describe('step16 / head + i18n seo', () => {
  it('OG/Twitter image has type, alt and twitter:image:alt', () => {
    for (const html of [app, landing]) {
      assert.match(html, /property="og:image:type" content="image\/png"/);
      assert.match(html, /property="og:image:alt"/);
      assert.match(html, /name="twitter:image:alt"/);
      assert.match(html, /property="og:locale:alternate" content="ar_SA"/);
    }
  });

  it('both pages expose a main landmark', () => {
    assert.match(stripScripts(app), /<main class="editorial-shell">/);
    assert.match(stripScripts(landing), /<main class="editorial-shell">/);
  });

  it('STATIC_I18N ships seoTitle + seoDesc in all 5 languages', () => {
    const stat = parseObj(appJs, 'const STATIC_I18N =');
    for (const lang of LANGS) {
      assert.ok(stat[lang].seoTitle, lang + '.seoTitle');
      assert.ok(stat[lang].seoDesc, lang + '.seoDesc');
      assert.ok(stat[lang].seoTitle.length >= 20);
      assert.ok(stat[lang].seoDesc.length >= 80);
    }
    assert.match(stat.en.seoTitle, /Signalcraft/);
    assert.match(stat.en.seoDesc, /Grade-A/);
  });

  it('landing L packs include title + desc for every language', () => {
    const L = parseObj(landJs, 'var L =');
    for (const lang of LANGS) {
      assert.ok(L[lang].title, lang + '.title');
      assert.ok(L[lang].desc, lang + '.desc');
    }
    assert.match(L.en.title, /Signals|Setups/i);
    assert.match(L.en.desc, /Grade-A/);
  });

  it('both pages update canonical, og:url, locale, title and description in JS', () => {
    for (const js of [appJs, landJs]) {
      assert.match(js, /function applySeoHead\s*\(/);
      assert.match(js, /rel="canonical"|rel='canonical'/);
      assert.match(js, /og:locale/);
      assert.match(js, /og:url/);
    }
    assert.match(appJs, /s\.seoTitle|seoTitle/);
    assert.match(landJs, /d\.desc/);
  });
});

describe('step16 / sitemap + robots', () => {
  it('sitemap annotates hreflang via xhtml:link', () => {
    const sm = read('sitemap.xml');
    assert.match(sm, /xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/);
    assert.match(sm, /xhtml:link/);
    for (const lang of LANGS.concat(['x-default'])) {
      assert.match(sm, new RegExp(`hreflang="${lang}"`));
    }
    assert.ok(sm.includes('<loc>https://signalcraft.click/</loc>'));
    assert.ok(sm.includes('<loc>https://signalcraft.click/app</loc>'));
  });

  it('robots.txt still allows Google and lists the sitemap', () => {
    const robots = read('robots.txt');
    assert.match(robots, /User-agent: Googlebot/);
    assert.match(robots, /Allow:\s*\//);
    assert.match(robots, /Sitemap:\s*https:\/\/signalcraft\.click\/sitemap\.xml/);
    assert.match(robots, /Disallow:\s*\/ads\//);
  });

  it('writes the SEO inventory report', () => {
    writeReport('step16-seo.json', {
      pages: ['index.html', 'app.html'],
      langs: LANGS,
      graphExtras: ['WebPage', 'BreadcrumbList', 'sameAs', 'ImageObject'],
      head: ['og:image:type', 'twitter:image:alt', 'applySeoHead', 'main.editorial-shell']
    });
    assert.equal(exists('tests/reports/step16-seo.json'), true);
  });
});
