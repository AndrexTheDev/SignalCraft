import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, inlineScripts, stripScripts } from './helpers/html.mjs';
import { AD_HOST, escapeHtml, sanitizeCsvField } from './helpers/core-logic.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const joinedJs = appJs + '\n' + landJs;

describe('step15 / deep security static', () => {
  it('application JS never calls eval or new Function', () => {
    const stripped = joinedJs.replace(/\.eval\(/g, '');
    assert.equal(/\beval\s*\(/.test(stripped), false);
    assert.equal(/\bnew Function\s*\(/.test(joinedJs), false);
    assert.equal(/\bFunction\s*\(/.test(joinedJs), false);
  });

  it('ad-gate markup is not built from location / search / hash', () => {
    assert.equal(/adgate-card[\s\S]{0,800}location\.(search|hash|href)/.test(appJs), false);
    assert.equal(/innerHTML\s*=\s*`[\s\S]{0,200}location\./.test(appJs), false);
  });

  it('landing radar innerHTML only interpolates the hard-coded symbol whitelist', () => {
    assert.match(landJs, /var SY = \['BTC','ETH','SOL'/);
    assert.match(landJs, /el\.innerHTML = '<span>#' \+ \(i \+ 1\) \+ ' ' \+ r\.s/);
    assert.equal(/innerHTML[\s\S]{0,80}location\./.test(landJs), false);
  });

  it('document.write is a single sticky insertion, never a naked page wipe', () => {
    for (const html of [app, landing]) {
      assert.equal([...html.matchAll(/document\.write/g)].length, 1);
      assert.match(html, /document\.currentScript\.parentElement/);
    }
  });

  it('popunder refuses to load under WebDriver and never stores PII', () => {
    for (const html of [app, landing]) {
      assert.match(html, /if \(navigator\.webdriver\) return;/);
      assert.match(html, /sc_pu_ts/);
      assert.equal(/sc_pu_[a-z]+.*=.*email/i.test(html), false);
    }
  });

  it('external ad scripts are https + pinned host only', () => {
    const srcs = [...(app + landing).matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((m) => m[1]);
    const ads = srcs.filter((s) => /invoke\.js|9d2f8187|eacc536c/.test(s) || s.includes(AD_HOST));
    assert.ok(ads.length >= 4);
    for (const s of ads) {
      assert.match(s, /^https:\/\//);
      assert.match(s, new RegExp(AD_HOST.replace('.', '\\.')));
    }
  });

  it('side ads are aria-hidden; sticky close is a real button', () => {
    const markup = stripScripts(app) + stripScripts(landing);
    assert.match(markup, /id="adSideL"[^>]*aria-hidden="true"/);
    assert.match(markup, /id="adStickyX"[^>]*type="button"/);
  });

  it('lead CSV sanitizer still prefixes formula injection', () => {
    assert.match(sanitizeCsvField('=cmd|"/c calc"!A0'), /^"'=/);
    assert.match(appJs, /sanitizeCsvField\(l\.email\)/);
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>').includes('<img'), false);
  });

  it('share popups request noopener and do not echo the query string into ads', () => {
    assert.match(appJs, /noopener/);
    assert.equal(/window\.open\([^)]*location\.search/.test(appJs), false);
  });

  it('no javascript: URLs in markup', () => {
    assert.equal(/href\s*=\s*["']javascript:/i.test(app + landing), false);
  });
});
