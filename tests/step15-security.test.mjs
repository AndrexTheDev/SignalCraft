import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read, inlineScripts, stripScripts } from './helpers/html.mjs';
import { escapeHtml, sanitizeCsvField } from './helpers/core-logic.mjs';

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

  it('no ad-block gate or ad markup is wired into the terminal', () => {
    assert.equal(/detectAdBlock|refreshAdGate|forceAdBlock|adgate-card|btnAdRecheck/.test(appJs), false);
    assert.equal(/adBlockActive/.test(appJs), false);
  });

  it('landing interpolates no live/network data into innerHTML — only the i18n dictionary', () => {
    assert.match(landJs, /el\.innerHTML = d\[k\]/);
    assert.equal(/innerHTML[\s\S]{0,80}(location\.|fetch\(|response)/.test(landJs), false);
    // radar rows are static, labelled build-data examples, not live-injected prices
    const markup = stripScripts(landing);
    assert.match(markup, /id="radRow1"/);
    assert.match(markup, /rad_live/);
    assert.equal(/radGateNote/.test(landing), false);
  });

  it('document.write and untrusted markup injection are absent', () => {
    for (const html of [app, landing]) {
      assert.equal([...html.matchAll(/document\.write/g)].length, 0);
    }
    assert.equal(/innerHTML\s*=\s*`[\s\S]{0,200}location\./.test(appJs), false);
  });

  it('every external <script>/<link> resource is https and on the allowlist', () => {
    const allowed = new Set([
      'challenges.cloudflare.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com'
    ]);
    const joined = app + landing;
    const urls = [...joined.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const u of urls) {
      if (/^(data:|#|\/|[a-z0-9_.-]+\.(html|svg|png|ico|webmanifest|xml|txt)([?#]|$))/i.test(u)) continue;
      assert.match(u, /^https:\/\//, 'non-https resource: ' + u);
      const host = new URL(u).host;
      if (/^(api\.|data-api\.|indexer\.)/.test(host)) continue; // fetch targets, tightened at call sites
      assert.ok(allowed.has(host) || host === 'signalcraft.click' || host.endsWith('.signalcraft.click'), 'unexpected host: ' + host);
    }
  });

  it('lead CSV sanitizer still prefixes formula injection', () => {
    assert.match(sanitizeCsvField('=cmd|"/c calc"!A0'), /^"'=/);
    assert.match(appJs, /sanitizeCsvField\(l\.email\)/);
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>').includes('<img'), false);
  });

  it('share popups request noopener and do not echo the query string', () => {
    assert.match(appJs, /noopener/);
    assert.equal(/window\.open\([^)]*location\.search/.test(appJs), false);
  });

  it('no javascript: URLs in markup', () => {
    assert.equal(/href\s*=\s*["']javascript:/i.test(app + landing), false);
  });

  it('no on-chain pills or netflow fields exist anywhere (removed fabricated data)', () => {
    assert.equal(/netflowM|whalePct|sig\.onchain|onchain/i.test(joinedJs), false);
    assert.equal(/netflowM|whalePct|sig\.onchain|onchain/i.test(stripScripts(app) + stripScripts(landing)), false);
  });
});
