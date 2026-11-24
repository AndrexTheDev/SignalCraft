import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { read } from './helpers/html.mjs';
import worker from '../worker.mjs';

const langs = ['de', 'en', 'es', 'ar', 'zh'];
const base = 'https://signalcraft.click';
const canon = (page, lang) => base + (page === 'app.html' ? '/app' : '/') + (lang === 'de' ? '' : '?lang=' + lang);
const clean = text => String(text).replace(/\s+/g, ' ').trim();

describe('step80 / generated language documents', () => {
  it('bundled deploy assets match the current source and generator', () => {
    assert.match(execFileSync(process.execPath, ['tools/prerender.mjs', '--check'], { encoding: 'utf8' }), /current/);
  });
  for (const file of ['index.html', 'app.html']) for (const lang of langs) {
    it(`${file} ${lang} is complete and consistent in raw HTML`, () => {
      const doc = new JSDOM(read(`_localized/${lang}/${file}`)).window.document;
      const url = canon(file, lang);
      assert.equal(doc.documentElement.lang, lang);
      assert.equal(doc.documentElement.dir, lang === 'ar' ? 'rtl' : 'ltr');
      const canonicals = doc.querySelectorAll('link[rel="canonical"]');
      assert.equal(canonicals.length, 1); assert.equal(canonicals[0].href, url);
      assert.equal(doc.querySelector('#langSelect option[selected]').value, lang);
      assert.equal(doc.querySelector('meta[property="og:url"]').content, url);
      assert.equal(doc.querySelector('meta[property="og:title"]').content, doc.title);
      assert.equal(doc.querySelector('meta[name="twitter:title"]').content, doc.title);
      const description = doc.querySelector('meta[name="description"]').content;
      assert.equal(doc.querySelector('meta[property="og:description"]').content, description);
      assert.equal(doc.querySelector('meta[name="twitter:description"]').content, description);
      for (const l of [...langs, 'x-default']) assert.equal(doc.querySelector(`link[hreflang="${l}"]`).href, canon(file, l === 'x-default' ? 'de' : l));
      const graph = JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent)['@graph'];
      const page = graph.find(x => x['@type'] === 'WebPage');
      assert.equal(page.url, url); assert.equal(page.inLanguage, lang); assert.equal(page.name, doc.title); assert.equal(page.description, description);
      const faq = graph.find(x => x['@type'] === 'FAQPage');
      const rows = file === 'index.html' ? [...doc.querySelectorAll('#faq .seo-faq-item')].map(el => [el.querySelector('.seo-faq-question'), el.querySelector('.seo-faq-answer')]) : [...doc.querySelectorAll('#faq .faq-accordion-item')].map(el => [el.querySelector('.faq-header-toggle span:first-child'), el.querySelector('.faq-body-content')]);
      assert.equal(faq.mainEntity.length, rows.length);
      rows.forEach(([q, a], i) => { assert.equal(faq.mainEntity[i].name, clean(q.textContent).replace(/^\d+\.\s*/, '')); assert.equal(faq.mainEntity[i].acceptedAnswer.text, clean(a.textContent)); });
      assert.equal(doc.querySelectorAll('h1').length, 1);
      assert.ok(doc.querySelector('h1').textContent.includes('Signalcraft'));
      assert.equal(doc.querySelectorAll('nav[data-language-links] a').length, 5);
      if (lang !== 'de') {
        const german = new JSDOM(read(`_localized/de/${file}`)).window.document;
        assert.notEqual(doc.title, german.title); assert.notEqual(doc.querySelector('h1').textContent, german.querySelector('h1').textContent);
        assert.notEqual(rows[0][0].textContent, german.querySelector(file === 'index.html' ? '#faq .seo-faq-question' : '#faq .faq-header-toggle span:first-child').textContent);
      }
      if (file === 'app.html') assert.match(doc.querySelector('noscript').textContent, /JavaScript|جافاسكريبت/);
    });
  }
});

describe('step80 / Worker request routing', () => {
  it('routes explicit languages and preserves request method while hiding generated files', async () => {
    const seen = [];
    const env = { ASSETS: { fetch: async req => { seen.push(req); return new Response('asset', { status: 200, headers: { 'content-type': 'text/html' } }); } } };
    for (const [path, target] of [['/', '/_localized/de/'], ['/?lang=en&campaign=x', '/_localized/en/'], ['/app?lang=ar', '/_localized/ar/app'], ['/app?lang=unknown', '/_localized/de/app'], ['/?lang=es&lang=zh', '/_localized/es/']]) {
      assert.equal((await worker.fetch(new Request(base + path), env)).status, 200);
      const got = new URL(seen.at(-1).url); assert.equal(got.pathname, target); assert.equal(got.search, '');
    }
    assert.equal((await worker.fetch(new Request(base + '/app?lang=zh', { method: 'HEAD' }), env)).status, 200); assert.equal(seen.at(-1).method, 'HEAD');
    assert.equal((await worker.fetch(new Request(base + '/_localized/en/app'), env)).status, 404);
    assert.equal((await worker.fetch(new Request(base + '/%5Flocalized/en/app'), env)).status, 404);
    assert.equal((await worker.fetch(new Request(base + '/app', { method: 'POST' }), env)).status, 405);
    const redirect = await worker.fetch(new Request(base + '/app.html?lang=es&q=BTC'), env);
    assert.equal(redirect.status, 308); assert.equal(redirect.headers.get('location'), base + '/app?lang=es&q=BTC');
    assert.equal((await worker.fetch(new Request(base + '/robots.txt'), env)).status, 200); assert.equal(new URL(seen.at(-1).url).pathname, '/robots.txt');
  });
  it('fails closed when the deploy has not generated a locale', async () => {
    const env = { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } };
    const response = await worker.fetch(new Request(base + '/?lang=en'), env);
    assert.equal(response.status, 503); assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

describe('step82 / provider, privacy, fonts and 404 routing', () => {
  it('has locally hosted licensed fonts and no third-party font requests', () => {
    for (const file of ['index.html', 'app.html']) {
      const source = read(file);
      assert.doesNotMatch(source, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
      assert.match(source, /\/assets\/fonts\/fonts\.css/);
    }
    const css = read('assets/fonts/fonts.css');
    const urls = [...css.matchAll(/url\('\.\/([^']+\.woff2)'\)/g)].map(x => x[1]);
    assert.ok(urls.length >= 20);
    for (const name of urls) assert.ok(statSync('assets/fonts/' + name).size > 0, name);
    for (const family of ['cormorant-garamond','jetbrains-mono','plus-jakarta-sans']) assert.match(read('assets/fonts/' + family + '-LICENSE.txt'), /SIL OPEN FONT LICENSE/i);
  });
  it('returns multilingual provider and privacy information, not invented identity or legal approval', () => {
    const provider = new JSDOM(read('impressum.html')).window.document;
    const privacy = new JSDOM(read('datenschutz.html')).window.document;
    for (const lang of langs) {
      assert.ok(provider.querySelector(`section#${lang}[lang="${lang}"]`));
      assert.ok(privacy.querySelector(`section#${lang}[lang="${lang}"]`));
    }
    assert.match(provider.body.textContent, /AndrexTheDev/); assert.match(provider.body.textContent, /hippie\.highho@gmail\.com/);
    assert.match(provider.body.textContent, /postalische Anschrift wurden bislang nicht bereitgestellt/);
    assert.match(privacy.body.textContent, /nicht rechtlich geprüft/);
    for (const term of ['Cloudflare','Binance','Binance.US','DexScreener','Alternative.me','signalcraft_lang','signalcraft_live_v2','sc_dossiers']) assert.ok(privacy.body.textContent.includes(term), term);
  });
  it('serves a helpful 404 with the correct HTTP status and HEAD semantics', async () => {
    const env = { ASSETS: { fetch: async req => {
      const path = new URL(req.url).pathname;
      if (path === '/404.html') return new Response(req.method === 'HEAD' ? null : '<h1>not found</h1>', {status:200,headers:{'Content-Type':'text/html'}});
      if (path === '/impressum.html' || path === '/datenschutz.html') return new Response('legal', {status:200});
      return new Response('missing', {status:404});
    } } };
    for (const path of ['/impressum', '/datenschutz']) assert.equal((await worker.fetch(new Request(base + path),env)).status,200);
    const missing = await worker.fetch(new Request(base + '/unknown'),env);
    assert.equal(missing.status,404); assert.match(await missing.text(),/not found/); assert.equal(missing.headers.get('cache-control'),'no-store');
    const head = await worker.fetch(new Request(base + '/unknown',{method:'HEAD'}),env);
    assert.equal(head.status,404); assert.equal(await head.text(),'');
  });
});
