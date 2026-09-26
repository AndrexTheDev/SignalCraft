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

export function filterSignals(list, { filter = 'all', sector = 'all', q = '', minScore = QUAL_MIN } = {}) {
  const query = String(q || '').trim().toLowerCase();
  return list.filter((sig) => {
    const score = sig.quantScore ?? sig.confluenceScore ?? 0;
    if (score < minScore) return false;
    if (filter === 'risk-low' && sig.riskLevel !== 'LOW') return false;
    if (filter === 'risk-medium' && sig.riskLevel !== 'MEDIUM') return false;
    if (filter === 'risk-high' && sig.riskLevel !== 'HIGH') return false;
    if (sector !== 'all' && sig.sector !== sector) return false;
    if (query) {
      const hay = [sig.pair, sig.sector, sig.notes].map((x) => String(x || '').toLowerCase()).join(' ');
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

export function paginate(list, page, size) {
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size) || 1);
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * size;
  const end = Math.min(start + size, total);
  return { total, totalPages, current, start, end, slice: list.slice(start, end) };
}

export function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    const to = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * to((n >> 16) & 255) + 0.7152 * to((n >> 8) & 255) + 0.0722 * to(n & 255);
  };
  const a = lum(hexA), b = lum(hexB);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

export function atrK(h, l, c, p) {
  p = p || 14;
  const tr = [];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p;
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}

const BOARD_SECTORS = ['all', 'majors', 'layer1-2', 'defi', 'ai', 'memes'];
const BOARD_SORTS = ['confluence', 'sentiment', 'risk', 'time'];

export function parseBoardQuery(search) {
  const raw = String(search || '');
  const p = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  const sectorRaw = p.get('sector') || 'all';
  const sector = BOARD_SECTORS.indexOf(sectorRaw) >= 0 ? sectorRaw : 'all';
  let risk = 'all';
  const r = String(p.get('risk') || '').toLowerCase();
  if (r === 'low' || r === 'medium' || r === 'high') risk = 'risk-' + r;
  else if (r === 'risk-low' || r === 'risk-medium' || r === 'risk-high') risk = r;
  const sortRaw = p.get('sort') || 'confluence';
  const sort = BOARD_SORTS.indexOf(sortRaw) >= 0 ? sortRaw : 'confluence';
  return {
    sector: sector,
    risk: risk,
    sort: sort,
    q: String(p.get('q') || '').trim(),
    sig: String(p.get('sig') || '').trim(),
    lang: p.get('lang') || ''
  };
}

export function serializeBoardQuery(state, currentSearch) {
  const raw = String(currentSearch || '');
  const p = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
  const next = new URLSearchParams();
  p.forEach(function (v, k) {
    if (k === 'sector' || k === 'risk' || k === 'sort' || k === 'q' || k === 'sig') return;
    next.set(k, v);
  });
  if (state && state.q) next.set('q', state.q);
  if (state && state.sector && state.sector !== 'all') next.set('sector', state.sector);
  if (state && state.risk && state.risk !== 'all') next.set('risk', String(state.risk).replace(/^risk-/, ''));
  if (state && state.sort && state.sort !== 'confluence') next.set('sort', state.sort);
  if (state && state.sig) next.set('sig', state.sig);
  return next.toString();
}

export const AD_HOST = 'globalimmaturelunatic.com';
export const AD_KEYS = {
  side: '6372f131e3637d818f7cc8c102951da9',
  sticky: '13b82827e922917915d927184e84b454',
  native: '8a466ff3d4c93e29bba42607317f6266',
  social: '9d2f8187ee40c1bb86d4839820efab46',
  popunder: 'eacc536c1170ad59f25e5561dc85e037'
};
export const AD_POPUNDER_GAP_MS = 2 * 3600e3;
export const AD_POPUNDER_DAY_MAX = 4;
export const AD_STICKY_DISMISS_MS = 1_800_000;

export function popunderCapOk(now, lastTs, dayCount, dayStamp, today, gapMs, dayMax) {
  gapMs = gapMs == null ? AD_POPUNDER_GAP_MS : gapMs;
  dayMax = dayMax == null ? AD_POPUNDER_DAY_MAX : dayMax;
  const day = dayStamp !== today ? 0 : (dayCount || 0);
  return (now - (lastTs || 0)) >= gapMs && day < dayMax;
}

export function stickyIsDismissed(now, storedTs, ttlMs) {
  ttlMs = ttlMs == null ? AD_STICKY_DISMISS_MS : ttlMs;
  const d = +storedTs || 0;
  return !!(d && now - d < ttlMs);
}

export function shouldRefillAdSlot(state, hasIframe, display) {
  if (hasIframe) return false;
  if (display === 'none') return false;
  return state === 'err' || state === 'ok';
}

export function shouldHideFailedAd(state, hasIframe) {
  return !hasIframe && state === 'err';
}

export function isPinnedAdUrl(url) {
  try {
    const u = new URL(String(url), 'https://signalcraft.atelier/');
    return u.protocol === 'https:' && u.hostname === AD_HOST;
  } catch {
    return false;
  }
}

export function safeJsonArray(raw) {
  try {
    const v = JSON.parse(String(raw == null ? '[]' : raw));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function clampPct(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, x));
}

export function longPlanValid(sig) {
  const entry = Number(sig && sig.entryPrice);
  const sl = Number(sig && sig.stopLoss);
  const tp1 = Number(sig && sig.targets && sig.targets[0]);
  const tp2 = Number(sig && sig.targets && sig.targets[1]);
  return Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp1) && Number.isFinite(tp2)
    && sl < entry && entry < tp1 && tp1 <= tp2;
}

export function isLiveCache(ca) {
  return !!(ca && Array.isArray(ca.signals) && ca.signals.length === 120
    && ca.signals.every((s) => s && typeof s === 'object' && typeof s.pair === 'string' && typeof s.id === 'string'));
}
