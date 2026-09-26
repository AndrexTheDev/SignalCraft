/** Pure logic mirrors of Signalcraft terminal helpers — kept in sync for unit tests. */

export function fmtP(v) {
  if (!isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 1) return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const dec = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(abs))));
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeCsvField(field) {
  let str = String(field || '').trim();
  if (str.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(str[0])) {
    str = "'" + str;
  }
  return '"' + str.replace(/"/g, '""') + '"';
}

export const QUAL_MIN = 78;

export function gradeFromQuant(quantScore) {
  return quantScore >= 93 ? 'A+' : quantScore >= 86 ? 'A' : quantScore >= QUAL_MIN ? 'B+' : quantScore >= 70 ? 'B' : 'C';
}

export function longLevels(entry, stopLoss, tp1, tp2) {
  const risk = entry - stopLoss;
  const rr1 = risk > 0 ? (tp1 - entry) / risk : NaN;
  const rr2 = risk > 0 ? (tp2 - entry) / risk : NaN;
  return { risk, rr1, rr2 };
}

export function parseRrString(s) {
  const m = String(s || '').match(/1\s*:\s*([0-9.]+)/);
  return m ? Number(m[1]) : NaN;
}

export function rsi(c, p) {
  p = p || 14;
  const g = [], l = [];
  for (let i = 1; i < c.length; i++) {
    g.push(Math.max(c[i] - c[i - 1], 0));
    l.push(Math.max(c[i - 1] - c[i], 0));
  }
  let ag = g.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let al = l.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < g.length; i++) {
    ag = (ag * (p - 1) + g[i]) / p;
    al = (al * (p - 1) + l[i]) / p;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}

export function sma(x, p) {
  if (x.length < p) return null;
  return x.slice(-p).reduce((a, b) => a + b, 0) / p;
}

export function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function emailLooksValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}
