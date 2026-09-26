import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, inlineScripts, extractArray, stripScripts, jsonLdBlocks, writeReport
} from './helpers/html.mjs';
import { QUAL_MIN } from './helpers/core-logic.mjs';

const WALLETS = {
  SOL: '79KsqtJJdhKFJ9woxnYgtf3nq7HxQveafWBCtC3mxWi8',
  BTC: 'bc1qeqzrlfg3edrydk4s0hecakc82gp26n5p7hkc7f',
  ETH: '0xBC3fab34f69bc9f6661608C3FB36dDdC313C42F7'
};

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const seed = JSON.parse(extractArray(appJs, 'const SEED_SIGNALS ='));
const gated = seed.filter((s) => (s.quantScore ?? 0) >= QUAL_MIN);
const cex = Function('return (' + extractArray(appJs, 'const CEX_LIST =') + ')')();
const dex = Function('return (' + extractArray(appJs, 'const DEX_VENUES =') + ')')();

function faqA1Markup(html) {
  const m = stripScripts(html).match(/data-i18n="a1"[^>]*>([\s\S]*?)<\/p>/);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function i18nA1(js) {
  return [...js.matchAll(/\ba1:\s*"((?:\\.|[^"\\])*)"/g)].map((m) => m[1].replace(/\\"/g, '"'));
}

function mentionsGate(text) {
  return /B\+|Quality-Gate|quality gate|Qualit[aä]ts|بوابة جودة|质量门槛/i.test(text);
}

describe('step22 / version lock', () => {
  it('JSON-LD softwareVersion is 3.4 on landing and terminal', () => {
    for (const html of [landing, app]) {
      const graph = JSON.parse(jsonLdBlocks(html)[0])['@graph'];
      const sw = graph.find((n) => n['@type'] === 'SoftwareApplication');
      assert.equal(sw.softwareVersion, '3.4');
    }
  });

  it('visible footers say v3.4 and never v3.2', () => {
    const landMark = stripScripts(landing);
    const appMark = stripScripts(app);
    assert.match(landMark, /Signalcraft v3\.4/);
    assert.match(appMark, /Signalcraft Terminal v3\.4/);
    assert.equal(/v3\.2/.test(landMark + appMark), false);
    assert.equal(/v3\.2/.test(appJs + landJs), false);
  });
});

describe('step22 / donation wallets', () => {
  it('copy buttons paste the published SOL / BTC / ETH addresses, not email', () => {
    const copies = [...app.matchAll(/data-doncopy="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(copies.length, 3);
    assert.deepEqual(new Set(copies).size, 3);
    assert.ok(copies.includes(WALLETS.SOL));
    assert.ok(copies.includes(WALLETS.BTC));
    assert.ok(copies.includes(WALLETS.ETH));
    for (const c of copies) {
      assert.equal(/@/.test(c), false, 'wallet must not be an email: ' + c);
      assert.equal(c.includes('...'), false);
    }
  });

  it('landing and terminal footers show the same three wallets', () => {
    const landMark = stripScripts(landing);
    const appMark = stripScripts(app);
    for (const w of Object.values(WALLETS)) {
      assert.ok(landMark.includes(w), 'landing missing ' + w.slice(0, 8));
      assert.ok(appMark.includes(w), 'terminal missing ' + w.slice(0, 8));
    }
  });

  it('copy toast uses the button label, not a colon-split of the payload', () => {
    assert.match(appJs, /data-doncopy/);
    assert.equal(appJs.includes("getAttribute('data-doncopy').split(':')"), false);
  });
});

describe('step22 / universe vs quality gate', () => {
  it('seed is 120 pairs and the board is the B+ subset', () => {
    assert.equal(seed.length, 120);
    assert.equal(QUAL_MIN, 78);
    assert.ok(gated.length < seed.length);
    assert.equal(gated.length, 58);
    assert.match(appJs, /nEl\.textContent = adBlockActive \? '—' : String\(gatedList\.length\)/);
  });

  it('FAQ copy that talks about opening the terminal names the B+ gate', () => {
    const a1html = faqA1Markup(landing);
    assert.ok(a1html.length > 20, 'missing landing a1 markup');
    assert.ok(mentionsGate(a1html), a1html);
    const graph = JSON.parse(jsonLdBlocks(landing)[0])['@graph'];
    const faq = graph.find((n) => n['@type'] === 'FAQPage');
    const free = faq.mainEntity.find((q) => /kostenlos|free/i.test(q.name));
    assert.ok(free, 'missing free FAQ');
    assert.ok(mentionsGate(free.acceptedAnswer.text), free.acceptedAnswer.text);
    const a1s = i18nA1(landJs);
    assert.ok(a1s.length >= 4, 'expected EN/ES/AR/ZH a1');
    for (const t of a1s) assert.ok(mentionsGate(t), t);
  });
});

describe('step22 / live inventory + legal', () => {
  it('CEX_LIST is 11 names and DEX_VENUES is 12 venues', () => {
    assert.equal(cex.length, 11);
    assert.equal(dex.length, 12);
    assert.ok(cex.includes('BINANCE'));
    assert.ok(dex.some((v) => v.n === 'UNISWAP V3'));
  });

  it('risk disclaimer and developer mailto are on both public pages', () => {
    for (const html of [landing, app]) {
      const mark = stripScripts(html);
      assert.match(mark, /RISIKOHINWEIS|RISK NOTICE/);
      assert.match(mark, /mailto:hippie\.highho@gmail\.com/);
      assert.match(mark, /Keine Anlageberatung|No investment advice/);
    }
  });

  it('published HTML has no leftover TODO / FIXME launch markers', () => {
    assert.equal(/\bTODO\b|\bFIXME\b/.test(app + landing), false);
  });
});

writeReport('step22-launch.json', {
  version: '3.4',
  seed: seed.length,
  gated: gated.length,
  cex: cex.length,
  dex: dex.length,
  wallets: Object.keys(WALLETS)
});
