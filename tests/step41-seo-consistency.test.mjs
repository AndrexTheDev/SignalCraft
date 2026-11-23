import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { read } from './helpers/html.mjs';

const languages = ['de', 'en', 'es', 'ar', 'zh'];
const base = 'https://signalcraft.click/';
const canonical = (page, lang) => base + (page === 'index.html' || page === '' ? '' : 'app') + (lang === 'de' ? '' : '?lang=' + lang);
const normalize = text => String(text).replace(/\s+/g, ' ').trim();

describe('step41 / crawlable SEO consistency', () => {
  it('uses the configured Cloudflare HTML routing convention', () => {
    assert.match(read('wrangler.toml'), /html_handling\s*=\s*"auto-trailing-slash"/);
    assert.doesNotMatch(read('sitemap.xml'), /https:\/\/signalcraft\.click\/(?:index|app)\.html/);
  });
  it('lists one canonical URL per page and language, with complete reciprocal hreflang sets', () => {
    const xml = new JSDOM(read('sitemap.xml'), { contentType: 'text/xml' }).window.document;
    assert.equal(xml.querySelector('parsererror'), null);
    const entries = [...xml.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'url')];
    assert.equal(entries.length, 10);
    const locations = entries.map(el => el.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'loc')[0].textContent);
    const expected = ['index.html', 'app.html'].flatMap(page => languages.map(lang => canonical(page, lang)));
    assert.deepEqual([...locations].sort(), expected.sort());
    for (const entry of entries) {
      const loc = entry.getElementsByTagNameNS('http://www.sitemaps.org/schemas/sitemap/0.9', 'loc')[0].textContent;
      const page = new URL(loc).pathname.slice(1);
      const links = [...entry.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'link')];
      assert.equal(links.length, 6);
      for (const lang of [...languages, 'x-default']) {
        const link = links.filter(el => el.getAttribute('hreflang') === lang);
        assert.equal(link.length, 1);
        assert.equal(link[0].getAttribute('rel'), 'alternate');
        assert.equal(link[0].getAttribute('href'), canonical(page, lang === 'x-default' ? 'de' : lang));
      }
    }
    assert.doesNotMatch(read('sitemap.xml'), /<lastmod>/);
  });

  for (const page of ['index.html', 'app.html']) {
    it(`${page}: server HTML has no conflicting canonical, plus hreflang and visible FAQ schema`, () => {
      const doc = new JSDOM(read(page)).window.document;
      assert.equal(doc.querySelector('link[rel="canonical"]'), null);
      for (const lang of [...languages, 'x-default']) {
        const el = doc.querySelector(`link[hreflang="${lang}"]`);
        assert.equal(el.href, canonical(page, lang === 'x-default' ? 'de' : lang));
      }
      assert.doesNotMatch(doc.querySelector('meta[name="robots"]').content, /noindex/i);
      const data = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
      const graph = data['@graph'];
      const software = graph.find(n => n['@type'] === 'SoftwareApplication');
      const webPage = graph.find(n => n['@type'] === 'WebPage');
      assert.equal(software['@id'], base + '#software');
      assert.equal(webPage.about['@id'], software['@id']);
      assert.equal(webPage.url, canonical(page, 'de'));
      assert.equal(webPage.inLanguage, 'de');
      const faq = graph.find(n => n['@type'] === 'FAQPage');
      const rows = page === 'index.html' ? [...doc.querySelectorAll('#faq .seo-faq-item')].map(el => [el.querySelector('.seo-faq-question'), el.querySelector('.seo-faq-answer')]) : [...doc.querySelectorAll('#faq .faq-accordion-item')].map(el => [el.querySelector('.faq-header-toggle span:first-child'), el.querySelector('.faq-body-content')]);
      assert.equal(faq.mainEntity.length, rows.length);
      rows.forEach(([q, a], i) => {
        assert.equal(faq.mainEntity[i].name, normalize(q.textContent).replace(/^\d+\.\s*/, ''));
        assert.equal(faq.mainEntity[i].acceptedAnswer.text, normalize(a.textContent));
      });
      assert.doesNotMatch(doc.querySelector('meta[name="description"]').content, /Mio\$|\$10M/);
    });
  }
});
