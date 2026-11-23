import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { read } from './helpers/html.mjs';
const langs = ['de', 'en', 'es', 'ar', 'zh'];
const base = 'https://signalcraft.click';
describe('step79 / systematic SEO source audit', () => {
  for (const file of ['index.html', 'app.html']) {
    it(`${file} avoids a conflicting canonical in shared language HTML and exposes crawlable language links`, () => {
      const doc = new JSDOM(read(file)).window.document;
      assert.equal(doc.head.querySelectorAll('link[rel="canonical"]').length, 0, 'shared HTML cannot predeclare a German canonical for every language URL');
      const h1 = doc.querySelectorAll('h1'); assert.equal(h1.length, 1); assert.match(h1[0].textContent, /Signalcraft/);
      const nav = doc.querySelector('nav[data-language-links]'); assert.ok(nav);
      const anchors = [...nav.querySelectorAll('a[hreflang]')]; assert.equal(anchors.length, 5);
      for (const lang of langs) {
        const a = anchors.find(el => el.hreflang === lang); assert.ok(a && a.textContent.trim());
        const url = new URL(a.getAttribute('href'), base);
        const expected = base + (file === 'index.html' ? '/' : '/app') + (lang === 'de' ? '' : '?lang=' + lang);
        assert.equal(url.href, expected); assert.equal(a.getAttribute('lang'), lang);
        assert.equal(doc.querySelector(`link[rel="alternate"][hreflang="${lang}"]`).href, expected);
      }
      assert.equal(doc.querySelector('meta[name="keywords"]'), null);
      if (file === 'index.html') for (const link of doc.querySelectorAll('[data-terminal-link]')) assert.equal(link.getAttribute('href'), '/app');
      else assert.equal(doc.querySelector('#ftBack').getAttribute('href'), '/');
      const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
      const web = graph.find(n => n['@type'] === 'WebPage'), site = graph.find(n => n['@type'] === 'WebSite');
      assert.equal(web.name, doc.title); assert.equal(web.description, doc.querySelector('meta[name="description"]').content);
      assert.equal(site.name, 'Signalcraft'); assert.equal(site.potentialAction, undefined);
      assert.match(doc.querySelector('meta[property="og:image:alt"]').content, /Signalcraft/);
    });
  }
  it('does not claim more than 120 pairs are always assessed', () => {
    const text = read('index.html');
    for (const bad of ['über 120 Kryptowährungen', 'Über 120 Handelspaare', 'over 120 cryptocurrencies', 'Over 120 pairs', 'más de 120 criptomonedas', 'más de 120 pares', 'أكثر من 120', '120 多个']) assert.ok(!text.includes(bad), bad);
  });
});
