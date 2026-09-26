import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fmtP, escapeHtml, sanitizeCsvField, QUAL_MIN, gradeFromQuant,
  longLevels, parseRrString, rsi, sma, hashStr, mulberry32, emailLooksValid
} from './helpers/core-logic.mjs';
import { read, inlineScripts, extractArray } from './helpers/html.mjs';

describe('step2 / fmtP', () => {
  it('renders majors with up to 2 fraction digits', () => {
    assert.match(fmtP(86097), /86/);
    assert.equal(fmtP(1.5).includes('1'), true);
  });
  it('keeps meme-coin precision below 1', () => {
    const s = fmtP(5.02e-6);
    assert.equal(s.includes('0'), true);
    assert.notEqual(s, '0');
    assert.notEqual(s, '0.00');
  });
  it('guards non-finite input', () => {
    assert.equal(fmtP(NaN), '-');
    assert.equal(fmtP(Infinity), '-');
  });
});

describe('step2 / xss + csv', () => {
  it('escapeHtml neutralizes tags and quotes', () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
    assert.equal(escapeHtml(`a&b"c'd`), 'a&amp;b&quot;c&#39;d');
    assert.equal(escapeHtml(null), '');
  });
  it('sanitizeCsvField quotes and prefixes formula injection', () => {
    assert.equal(sanitizeCsvField('=cmd|"/c calc"!A0'), '"\'=cmd|""/c calc""!A0"');
    assert.match(sanitizeCsvField('=1+1'), /^"'=/);
    assert.match(sanitizeCsvField('+1'), /^"'\+/);
    assert.match(sanitizeCsvField('@SUM(1)'), /^"'@/);
    assert.equal(sanitizeCsvField('hello "world"'), '"hello ""world"""');
  });
});

describe('step2 / quality gate + grades', () => {
  it('B+ starts at QUAL_MIN 78', () => {
    assert.equal(QUAL_MIN, 78);
    assert.equal(gradeFromQuant(93), 'A+');
    assert.equal(gradeFromQuant(86), 'A');
    assert.equal(gradeFromQuant(78), 'B+');
    assert.equal(gradeFromQuant(77), 'B');
    assert.equal(gradeFromQuant(69), 'C');
  });
});

describe('step2 / risk-reward geometry', () => {
  it('classic 1:2 plan (TP2) computes correctly', () => {
    const { rr1, rr2 } = longLevels(100, 90, 110, 120);
    assert.equal(rr1, 1);
    assert.equal(rr2, 2);
  });
  it('parseRrString reads 1:2.0', () => {
    assert.equal(parseRrString('1:2.0'), 2);
    assert.equal(parseRrString('1:3.5'), 3.5);
  });
});

describe('step2 / indicators', () => {
  it('RSI is 100 on a strictly rising series', () => {
    const c = Array.from({ length: 50 }, (_, i) => 100 + i);
    assert.ok(rsi(c) > 90);
  });
  it('RSI is 0 on a strictly falling series', () => {
    const c = Array.from({ length: 50 }, (_, i) => 100 - i);
    assert.ok(rsi(c) < 10);
  });
  it('SMA of 1..10 period 5 is 8', () => {
    assert.equal(sma([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), 8);
  });
});

describe('step2 / rng is deterministic', () => {
  it('hashStr is stable', () => {
    assert.equal(hashStr('SIG-BTC-014'), hashStr('SIG-BTC-014'));
    assert.notEqual(hashStr('a'), hashStr('b'));
  });
  it('mulberry32 repeats', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    assert.equal(a(), b());
    assert.equal(a(), b());
  });
});

describe('step2 / lead email', () => {
  it('accepts normal addresses and rejects junk', () => {
    assert.equal(emailLooksValid('trader@example.com'), true);
    assert.equal(emailLooksValid('not-an-email'), false);
    assert.equal(emailLooksValid('a@b'), false);
    assert.equal(emailLooksValid(''), false);
  });
});

describe('step2 / seed vs live contract', () => {
  it('seed sentiment bull+bear is a 100 split (not 0 bear)', () => {
    const js = inlineScripts(read('app.html')).join('\n');
    const seed = JSON.parse(extractArray(js, 'const SEED_SIGNALS ='));
    const broken = seed.filter((s) => {
      const b = s.sentiment?.bullPct;
      const r = s.sentiment?.bearPct;
      return b + r !== 100;
    });
    assert.equal(broken.length, 0, 'bull/bear not a 100 split: ' + broken.slice(0, 3).map((s) => s.id).join(','));
  });

  it('toSignal live builder assigns bearPct (not hardcoded 0)', () => {
    const js = inlineScripts(read('app.html')).join('\n');
    assert.equal(/bearPct:\s*0\s*,/.test(js), false, 'live toSignal still hardcodes bearPct: 0');
  });
});
