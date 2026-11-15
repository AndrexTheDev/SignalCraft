import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, exists, inlineScripts, htmlIds, writeReport
} from './helpers/html.mjs';

const app = read('app.html');
const landing = read('index.html');
const joined = app + '\n' + landing;
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const joinedJs = appJs + '\n' + landJs;

const FORBIDDEN_HOSTS = [
  'globalimmaturelunatic.com',
  'googlesyndication.com',
  'doubleclick.net',
  'googletagservices.com',
  'amazon-adsystem.com',
  'adnxs.com',
  'adservice.google',
  'pagead2.googlesyndication'
];

const FORBIDDEN_TOKENS = [
  'adSideL', 'adSideR', 'adStickyM', 'adStickyX', 'adNative',
  'data-ad-slot', 'data-ad-state', 'adgate-card', 'btnAdRecheck',
  'detectAdBlock', 'refreshAdGate', 'forceAdBlock', 'radGateNote',
  'sc_sticky_dismiss', 'sc_pu_ts', 'sc_pu_day', 'sc_live_v1',
  'document.write'
];

describe('step10 / no third-party advertising stack', () => {
  it('no ad network host appears anywhere in either page', () => {
    for (const host of FORBIDDEN_HOSTS) {
      assert.equal(joined.includes(host), false, 'ad host present: ' + host);
    }
    assert.equal(/http:\/\/globalimmaturelunatic/.test(joined), false);
  });

  it('no ad slot markup, gate machinery or popunder keys remain', () => {
    for (const token of FORBIDDEN_TOKENS) {
      assert.equal(joined.includes(token), false, 'leftover token: ' + token);
    }
    assert.equal(/container-8a466ff3d4c93e29bba42607317f6266/.test(joined), false);
  });

  it('ad slot ids are absent and unique ids still hold on both pages', () => {
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const ids = htmlIds(html);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual(dups, [], name + ' duplicate ids');
      for (const id of ['adSideL', 'adSideR', 'adStickyM', 'adNative']) {
        assert.equal(ids.includes(id), false, name + ' still ships #' + id);
      }
    }
  });

  it('third-party <script> hosts are an allowlist (fonts + turnstile only)', () => {
    const allowed = new Set([
      'challenges.cloudflare.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com'
    ]);
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const hosts = new Set();
      for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
        const u = new URL(m[1], 'https://signalcraft.click/');
        if (u.protocol === 'https:' || u.protocol === 'http:') hosts.add(u.host);
      }
      const extra = [...hosts].filter((h) => !allowed.has(h));
      assert.deepEqual(extra, [], name + ' extra script hosts: ' + extra.join(','));
    }
  });

  it('no document.write, no eval, no new Function in either page', () => {
    assert.equal(/document\.write/.test(joinedJs), false);
    const stripped = joinedJs.replace(/\.eval\(/g, '');
    assert.equal(/\beval\s*\(/.test(stripped), false);
    assert.equal(/\bnew Function\s*\(/.test(joinedJs), false);
  });

  it('signals are never behind an ad-block gate (product promise)', () => {
    assert.equal(/detectAdBlock|refreshAdGate|forceAdBlock|adgate-card|adBlockActive|adblock/i.test(joinedJs), false);
    assert.equal(/adBlockActive/.test(joinedJs), false);
    // the rejection counter shows *rejected setups*, not blocked visitors
    assert.match(appJs, /GATE_FILTERED/);
  });

  it('robots.txt keeps /ads/, /tests/, /uploads/ off the public index', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Disallow:\s*\/ads\//);
    assert.match(robots, /Disallow:\s*\/tests\//);
    assert.match(robots, /Disallow:\s*\/uploads\//);
  });

  it('writes the no-ads inventory report', () => {
    writeReport('step10-no-ads.json', {
      adNetworksRemoved: FORBIDDEN_HOSTS,
      gateMachineryRemoved: ['detectAdBlock', 'refreshAdGate', 'forceAdBlock', 'adgate-card', 'radGateNote'],
      pages: ['index.html', 'app.html']
    });
    assert.equal(exists('tests/reports/step10-no-ads.json'), true);
  });
});
