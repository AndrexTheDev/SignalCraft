import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, exists, htmlIds, inlineScripts, stripScripts, writeReport
} from './helpers/html.mjs';

const app = read('app.html');
const landing = read('index.html');
const appJs = inlineScripts(app).join('\n');
const landJs = inlineScripts(landing).join('\n');
const appMarkup = stripScripts(app);
const landMarkup = stripScripts(landing);

export const AD_HOST = 'globalimmaturelunatic.com';
export const AD_SLOTS = {
  side: { key: '6372f131e3637d818f7cc8c102951da9', w: 160, h: 600, ids: ['adSideL', 'adSideR'] },
  sticky: { key: '13b82827e922917915d927184e84b454', w: 300, h: 250, id: 'adStickyM' },
  native: { key: '8a466ff3d4c93e29bba42607317f6266', id: 'adNative' },
  social: { key: '9d2f8187ee40c1bb86d4839820efab46' },
  popunder: { key: 'eacc536c1170ad59f25e5561dc85e037' }
};

const SLOT_HOOKS = [
  ['adSideL', 'side-left'],
  ['adSideR', 'side-right'],
  ['adStickyM', 'sticky-mobile'],
  ['adNative', 'native-footer']
];

function adScriptUrls(html) {
  return [...html.matchAll(/https:\/\/globalimmaturelunatic\.com\/[^"'\\s]+/g)].map((m) => m[0]);
}

function thirdPartyScriptHosts(html) {
  const hosts = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1], 'https://signalcraft.atelier/');
      if (u.protocol === 'https:' || u.protocol === 'http:') hosts.add(u.host);
    } catch {}
  }
  return [...hosts];
}

describe('step10 / ad slot inventory', () => {
  it('both pages expose the four layout slots with stable ids', () => {
    for (const [name, html, markup] of [
      ['app.html', app, appMarkup],
      ['index.html', landing, landMarkup]
    ]) {
      const ids = new Set(htmlIds(html));
      for (const [id, slot] of SLOT_HOOKS) {
        assert.ok(ids.has(id), `${name} missing #${id}`);
        assert.match(markup, new RegExp(`id="${id}"[^>]*data-ad-slot="${slot}"|data-ad-slot="${slot}"[^>]*id="${id}"`));
      }
      assert.ok(ids.has('adStickyX'), `${name} missing #adStickyX`);
      assert.ok(ids.has(`container-${AD_SLOTS.native.key}`), `${name} missing native container`);
    }
  });

  it('ad ids are unique on each page', () => {
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const ids = htmlIds(html);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual(dups, [], name + ' duplicate ids: ' + dups.join(','));
    }
  });

  it('side skyscrapers are 160×600, aria-hidden, and gated to wide viewports', () => {
    for (const html of [app, landing]) {
      assert.match(html, /#adSideL/);
      assert.match(html, /#adSideR/);
      assert.match(html, /\.side-ad iframe \{[^}]*width:\s*160px/);
      assert.match(html, /\.side-ad iframe \{[^}]*height:\s*600px/);
      assert.match(html, /@media \(min-width:\s*1520px\) \{ \.side-ad \{ display:\s*flex/);
      assert.match(stripScripts(html), /id="adSideL"[^>]*aria-hidden="true"/);
      assert.match(stripScripts(html), /id="adSideR"[^>]*aria-hidden="true"/);
      assert.match(html, new RegExp(`'key': '${AD_SLOTS.side.key}'`));
      assert.match(html, /'height': 600,\s*'width': 160/);
    }
  });

  it('mobile sticky is 300×250, dismissible, and gated under 900px', () => {
    for (const html of [app, landing]) {
      assert.match(html, /id="adStickyM"/);
      assert.match(html, /\.ad-sticky-m iframe \{[^}]*width:\s*300px/);
      assert.match(html, /\.ad-sticky-m iframe \{[^}]*height:\s*250px/);
      assert.match(html, /@media \(max-width:\s*899px\) \{ body\.has-sticky-ad/);
      assert.match(html, /matchMedia\('\(max-width: 899px\) and \(min-height: 500px\)'\)/);
      assert.match(html, /sc_sticky_dismiss/);
      assert.match(html, /id="adStickyX"[^>]*type="button"/);
      assert.match(html, /id="adStickyX"[^>]*aria-label=/);
      assert.match(html, new RegExp(AD_SLOTS.sticky.key));
    }
  });

  it('native footer banner container matches its invoke key', () => {
    for (const html of [app, landing]) {
      assert.match(html, new RegExp(`id="container-${AD_SLOTS.native.key}"`));
      assert.match(html, new RegExp(`${AD_HOST}/${AD_SLOTS.native.key}/invoke\\.js`));
      assert.match(html, /data-cfasync="false"/);
    }
  });

  it('social bar and popunder scripts are present once per page', () => {
    for (const html of [app, landing]) {
      const social = [...html.matchAll(new RegExp(AD_SLOTS.social.key, 'g'))];
      assert.ok(social.length >= 1, 'social bar missing');
      const pop = [...html.matchAll(new RegExp(AD_SLOTS.popunder.key, 'g'))];
      assert.ok(pop.length >= 1, 'popunder missing');
    }
  });
});

describe('step10 / ad network pin', () => {
  it('ad creatives load only from the pinned HTTPS host', () => {
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const urls = adScriptUrls(html);
      assert.ok(urls.length >= 4, name + ' too few ad urls: ' + urls.length);
      for (const u of urls) {
        assert.match(u, /^https:\/\//);
        assert.match(u, new RegExp(AD_HOST));
      }
      assert.equal(/http:\/\/globalimmaturelunatic/.test(html), false, name + ' mixed content');
    }
  });

  it('does not ship a second display-ad network', () => {
    const joined = app + landing;
    for (const host of [
      'googlesyndication.com', 'doubleclick.net', 'googletagservices.com',
      'amazon-adsystem.com', 'adnxs.com', 'adservice.google', 'pagead2.googlesyndication'
    ]) {
      assert.equal(joined.includes(host), false, 'unexpected ad host ' + host);
    }
  });

  it('third-party script hosts are an allowlist', () => {
    const allowed = new Set([
      AD_HOST,
      'challenges.cloudflare.com',
      'fonts.googleapis.com',
      'fonts.gstatic.com'
    ]);
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const hosts = thirdPartyScriptHosts(html);
      const extra = hosts.filter((h) => !allowed.has(h));
      assert.deepEqual(extra, [], name + ' extra script hosts: ' + extra.join(','));
    }
  });
});

describe('step10 / gates and heal', () => {
  it('terminal ad-block gate and bait detector are wired', () => {
    assert.match(appJs, /function detectAdBlock\s*\(/);
    assert.match(appJs, /function refreshAdGate\s*\(/);
    assert.match(appJs, /function forceAdBlock\s*\(/);
    assert.match(appJs, /adgate-card/);
    assert.match(appJs, /btnAdRecheck/);
    assert.match(appJs, /adsbox ad-banner ad-placement text-ads/);
    assert.match(app, /agT:/);
    assert.match(app, /adThanks:/);
  });

  it('landing radar gate hides live rows when a blocker is detected', () => {
    assert.match(landMarkup, /id="radGateNote"/);
    for (const n of [1, 2, 3, 4, 5]) assert.match(landMarkup, new RegExp(`id="radRow${n}"`));
    assert.match(landJs, /baitEl\.className = 'adsbox ad-banner ad-placement text-ads'/);
    assert.match(landJs, /radGateNote/);
  });

  it('popunder is capped, skipped for WebDriver, and uses a 2h gap', () => {
    for (const js of [app, landing]) {
      assert.match(js, /if \(navigator\.webdriver\) return;/);
      assert.match(js, /DAY_MAX = 4/);
      assert.match(js, /GAP = 2 \* 3600e3/);
      assert.match(js, /K_TS = 'sc_pu_ts'/);
      assert.match(js, /K_DAY = 'sc_pu_day'/);
    }
  });

  it('empty slots heal once then hide on persistent error', () => {
    for (const html of [app, landing]) {
      assert.match(html, /data-ad-state/);
      assert.match(html, /setTimeout\(function \(\) \{/);
      assert.match(html, /, 20000\);/);
      assert.match(html, /, 45000\);/);
      assert.match(html, /function heal\s*\(/);
      assert.match(html, /9d2f8187/);
    }
  });

  it('sticky document.write is isolated to the mobile slot IIFE', () => {
    for (const [name, html] of [['app.html', app], ['index.html', landing]]) {
      const writes = [...html.matchAll(/document\.write/g)];
      assert.equal(writes.length, 1, name + ' document.write count ' + writes.length);
      assert.match(html, /document\.currentScript\.parentElement/);
      assert.match(html, /document\.write\('<scr' \+ 'ipt>/);
    }
  });
});

describe('step10 / ads folder + robots', () => {
  it('robots.txt keeps /ads/ off the public index', () => {
    const robots = read('robots.txt');
    assert.match(robots, /Disallow:\s*\/ads\//);
    assert.equal(exists('ads'), true);
  });

  it('writes the slot inventory report', () => {
    const report = {
      host: AD_HOST,
      slots: AD_SLOTS,
      pages: ['index.html', 'app.html'],
      hooks: SLOT_HOOKS,
      notes: [
        'side 160x600 @ min-width 1520px',
        'sticky 300x250 @ max-width 899px, session dismiss 30min',
        'native footer container id matches invoke key',
        'social bar script self-positions',
        'popunder interaction-gated, 4/day, 2h gap, skip webdriver'
      ]
    };
    writeReport('step10-ad-inventory.json', report);
    assert.equal(exists('tests/reports/step10-ad-inventory.json'), true);
  });
});
