/** Pure logic mirrors of Signalcraft terminal helpers — kept in sync for unit tests. */

export function fmtP(v) {
  if (!isFinite(v)) return '-';
  const abs = Math.abs(v);
  if (abs >= 1) return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const dec = Math.min(12, Math.max(2, 2 - Math.floor(Math.log10(abs))));
  return Number(v).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

export function r5(x) {
  const n = Number(x);
  return Number.isFinite(n) ? +n.toPrecision(5) : 0;
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

export const QUAL_MIN = 86;
export const MIN_RSI = 75;
export const MIN_VOL_MIO = 10;

export function gradeFromQuant(quantScore) {
  return quantScore >= 93 ? 'A+' : quantScore >= 86 ? 'A' : quantScore >= 78 ? 'B+' : quantScore >= 70 ? 'B' : 'C';
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

export function qualityScore(sig) {
  const n = Number(sig && sig.quantScore);
  return Number.isFinite(n) ? n : 0;
}

export function passesQualityGate(sig, minScore = QUAL_MIN) {
  const score = qualityScore(sig);
  if (!(score >= minScore)) return false;
  const m = sig && sig.metrics;
  if (m && (Number.isFinite(m.rsi) || Number.isFinite(m.volMio))) {
    if (Number.isFinite(m.rsi) && m.rsi > MIN_RSI) return false;
    if (Number.isFinite(m.volMio) && m.volMio < MIN_VOL_MIO) return false;
  }
  return true;
}

export function pairSymbol(pair) {
  const s = String(pair || '').split(' / ')[0].trim();
  return s || '—';
}

export function takeProfitLevels(sig) {
  const entry = Number(sig && sig.entryPrice);
  const t = sig && sig.targets;
  const tp1 = (t && t[0] != null) ? t[0] : (Number.isFinite(entry) ? entry * 1.05 : NaN);
  const tp2 = (t && t[1] != null) ? t[1] : (Number.isFinite(entry) ? entry * 1.08 : NaN);
  return { tp1, tp2 };
}

export function capLeads(leads, max = 500) {
  const arr = Array.isArray(leads) ? leads.slice() : [];
  while (arr.length >= max) arr.shift();
  return arr;
}

export function filterSignals(list, { filter = 'all', sector = 'all', q = '', minScore = QUAL_MIN } = {}) {
  const query = String(q || '').trim().toLowerCase();
  return list.filter((sig) => {
    if (!passesQualityGate(sig, minScore)) return false;
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
  return !!(ca && Array.isArray(ca.signals) && ca.signals.length >= 100
    && ca.signals.every((s) => s && typeof s === 'object' && typeof s.pair === 'string' && typeof s.id === 'string'));
}

export function candleHL(c) {
  if (Array.isArray(c)) return { h: +c[1], l: +c[2], c: +c[3] };
  return { h: +(c && c.h), l: +(c && c.l), c: +(c && c.c) };
}

/** Conservative long path: same-bar SL+TP counts as stop. start = first index to inspect. */
export function simulateLongTp1(entry, sl, tp1, candles, start) {
  entry = +entry; sl = +sl; tp1 = +tp1;
  if (!(entry > 0 && sl > 0 && sl < entry && tp1 > entry) || !Array.isArray(candles)) return 'none';
  let filled = false;
  for (let i = start || 0; i < candles.length; i++) {
    const b = candleHL(candles[i]);
    if (!Number.isFinite(b.h) || !Number.isFinite(b.l)) continue;
    if (!filled) {
      if (b.h >= entry && b.l <= entry) {
        filled = true;
        if (b.l <= sl) return 'stop';
        if (b.h >= tp1) return 'hit';
      }
      continue;
    }
    if (b.l <= sl) return 'stop';
    if (b.h >= tp1) return 'hit';
  }
  return filled ? 'open' : 'none';
}

function bucketPct(b) {
  const d = (b.hit || 0) + (b.stop || 0);
  return d ? Math.round((100 * b.hit) / d) : null;
}

/** Historical per-setup backtest path: no overlapping rolling closes. */
export function copyLevelsText(sig) {
  const { tp1, tp2 } = takeProfitLevels(sig);
  const tpPart = '$' + fmtP(tp1) + ' / $' + fmtP(tp2);
  const pair = String((sig && sig.pair) || '—');
  return pair + ' Setup | Entry: $' + fmtP(sig.entryPrice) + ' | SL: $' + fmtP(sig.stopLoss) + ' | TP: ' + tpPart + ' | R:R: ' + sig.riskRewardRatio + ' (Signalcraft)';
}

export function sortSignalsList(list, sortMode) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (sortMode === 'confluence') {
    arr.sort((a, b) => b.confluenceScore - a.confluenceScore);
  } else if (sortMode === 'sentiment') {
    arr.sort((a, b) => (b.sentiment ? b.sentiment.score : 0) - (a.sentiment ? a.sentiment.score : 0));
  } else if (sortMode === 'risk') {
    const order = { LOW: 1, MEDIUM: 2, HIGH: 3 };
    arr.sort((a, b) => order[a.riskLevel] - order[b.riskLevel]);
  } else if (sortMode === 'time') {
    arr.sort((a, b) => b.timestamp - a.timestamp);
  }
  return arr;
}

export function fmtUtcTime(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toISOString().slice(11, 19) + ' UTC';
}

export function sectorCounts(list, minScore) {
  minScore = minScore == null ? QUAL_MIN : minScore;
  const gated = (list || []).filter((s) => passesQualityGate(s, minScore));
  const counts = { all: gated.length };
  gated.forEach((s) => { counts[s.sector] = (counts[s.sector] || 0) + 1; });
  return counts;
}

export function trackRecordSetups(setups) {
  const tot = { hit: 0, stop: 0, open: 0, none: 0, n: 0 };
  const byGrade = {};
  const list = Array.isArray(setups) ? setups : [];
  for (let s = 0; s < list.length; s++) {
    const row = list[s] || {};
    const k = row.k || row.k24 || [];
    const entry = +(row.e != null ? row.e : row.entryPrice);
    const sl = +(row.sl != null ? row.sl : row.stopLoss);
    const tp1 = +(row.tp != null ? row.tp : (row.targets && row.targets[0]));
    if (!(entry > 0 && sl > 0 && sl < entry && tp1 > entry && k.length > 1)) continue;
    const risk = (entry - sl) / entry;
    const rew = (tp1 - entry) / entry;
    if (!(risk > 0 && rew > 0)) continue;
    const g = row.g || row.grade || 'A';
    const btEntry = candleHL(k[0]).c;
    if (!Number.isFinite(btEntry) || btEntry <= 0) continue;
    if (!byGrade[g]) byGrade[g] = { hit: 0, stop: 0, open: 0, none: 0 };
    const r = simulateLongTp1(btEntry, btEntry * (1 - risk), btEntry * (1 + rew), k, 1);
    tot[r]++;
    byGrade[g][r]++;
    tot.n++;
  }
  const grades = {};
  Object.keys(byGrade).forEach((g) => {
    const b = byGrade[g];
    const n = (b.hit || 0) + (b.stop || 0) + (b.open || 0) + (b.none || 0);
    grades[g] = Object.assign({}, b, { n, pct: bucketPct(b) });
  });
  return {
    total: tot,
    byGrade: grades,
    pct: bucketPct(tot),
    resolved: tot.hit + tot.stop,
    setups: tot.n,
    hit: tot.hit,
    stop: tot.stop,
    open: tot.open
  };
}


// ===== Signal factor model v2 (mirrors app.html for unit tests) =====

export function emaSeries(x, p) {
  const k = 2 / (p + 1);
  const out = new Array(x.length);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = x[i] * k + out[i - 1] * (1 - k);
  return out;
}

export function emaLast(x, p) { const a = emaSeries(x, p); return a[a.length - 1]; }

export function adxWilder(h, l, c, p) {
  p = p || 14;
  const n = c.length;
  if (n < 2 * p + 2) return { adx: NaN, plusDi: NaN, minusDi: NaN };
  const tr = [], pdm = [], mdm = [];
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  let atr = tr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let spdm = pdm.slice(0, p).reduce((a, b) => a + b, 0) / p;
  let smdm = mdm.slice(0, p).reduce((a, b) => a + b, 0) / p;
  const dx = [];
  let lastPdi = 0, lastMdi = 0;
  for (let i = p; i < tr.length; i++) {
    atr = (atr * (p - 1) + tr[i]) / p;
    spdm = (spdm * (p - 1) + pdm[i]) / p;
    smdm = (smdm * (p - 1) + mdm[i]) / p;
    const pdi = atr === 0 ? 0 : (100 * spdm) / atr;
    const mdi = atr === 0 ? 0 : (100 * smdm) / atr;
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum);
    if (i === tr.length - 1) { lastPdi = pdi; lastMdi = mdi; }
  }
  if (dx.length < p) return { adx: NaN, plusDi: lastPdi, minusDi: lastMdi };
  let adx = dx.slice(0, p).reduce((a, b) => a + b, 0) / p;
  for (let i = p; i < dx.length; i++) adx = (adx * (p - 1) + dx[i]) / p;
  return { adx: adx, plusDi: lastPdi, minusDi: lastMdi };
}

export function returnVol(c, p) {
  const r = [];
  for (let i = Math.max(1, c.length - p); i < c.length; i++) r.push(c[i] / c[i - 1] - 1);
  if (!r.length) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) * (b - m), 0) / r.length;
  return Math.sqrt(v);
}

export function riskAdjMom(c, p) {
  p = p || 30;
  if (c.length < p + 2) return NaN;
  const ret = c[c.length - 1] / c[c.length - 1 - p] - 1;
  const vol = returnVol(c, p) * Math.sqrt(p);
  return vol === 0 ? 0 : ret / vol;
}

export function obvTrend(c, qv, p) {
  p = p || 20;
  if (c.length < p + 2 || qv.length !== c.length) return { pct: 0, dir: 'flat' };
  const series = [0];
  let obv = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] === c[i - 1] ? 0 : (c[i] > c[i - 1] ? 1 : -1);
    obv += d * qv[i];
    series.push(obv);
  }
  const delta = series[series.length - 1] - series[series.length - 1 - p];
  const avgVol = qv.slice(-p).reduce((a, b) => a + b, 0) / p;
  const pct = avgVol === 0 ? 0 : delta / (avgVol * p);
  return { pct: pct, dir: pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat' };
}

export function bbWidthPercentile(c, p, lookback) {
  p = p || 20; lookback = lookback || 120;
  if (c.length < p + 5) return 50;
  const bws = [];
  for (let end = p; end <= c.length; end++) {
    const slice = c.slice(end - p, end);
    const mean = slice.reduce((a, b) => a + b, 0) / p;
    if (mean === 0) continue;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) * (b - mean), 0) / p);
    bws.push((4 * sd) / mean);
  }
  if (!bws.length) return 50;
  const cur = bws[bws.length - 1];
  const hist = bws.slice(-lookback);
  const below = hist.filter(x => x <= cur).length;
  return Math.round((below / hist.length) * 100);
}

export function factorScores(h, l, c, qv, tq) {
  const last = c[c.length - 1];
  const e20 = emaLast(c, 20), e50 = emaLast(c, 50), e200 = emaLast(c, 200);
  const p7 = last / c[c.length - 8] - 1;
  const p30 = last / c[c.length - 31] - 1;
  const relVol = qv[qv.length - 1] / (qv.slice(-31, -1).reduce((x, y) => x + y, 0) / 30);
  const adxR = adxWilder(h, l, c, 14);
  const ra30 = riskAdjMom(c, 30);
  const obv = obvTrend(c, qv, 20);
  const bwPct = bbWidthPercentile(c, 20, 120);
  const hi90 = Math.max.apply(null, h.slice(-90));
  const hi90d = (hi90 - last) / last;
  const tr = (last > e20 ? 6 : 0) + (e20 > e50 ? 7 : 0) + (e50 > e200 ? 6 : 0) + (last > e200 ? 6 : 0);
  const adxV = adxR.adx;
  let q = Number.isFinite(adxV) ? (adxV >= 25 ? 10 : adxV >= 20 ? 7 : adxV >= 15 ? 4 : 1) : 2;
  if (Number.isFinite(adxR.plusDi) && adxR.plusDi > adxR.minusDi) q += 5;
  let mo = Number.isFinite(ra30) ? (ra30 >= 0.9 ? 13 : ra30 >= 0.6 ? 11 : ra30 >= 0.35 ? 8 : ra30 >= 0.1 ? 5 : ra30 >= 0 ? 2 : 0) : 4;
  mo += (p7 >= 0.08 ? 6 : p7 >= 0.03 ? 4 : p7 >= 0 ? 2 : 0);
  mo += (p30 >= 0.20 ? 6 : p30 >= 0.08 ? 4 : p30 >= 0 ? 2 : 0);
  const vo = (relVol >= 2 ? 9 : relVol >= 1.5 ? 7 : relVol >= 1.1 ? 5 : relVol >= 0.8 ? 3 : 1) + (obv.dir === 'up' ? 6 : obv.dir === 'flat' ? 3 : 0);
  const tb7 = tq.slice(-7).reduce((x, y) => x + y, 0) / qv.slice(-7).reduce((x, y) => x + y, 0);
  const tq3 = tq.slice(-3).reduce((x, y) => x + y, 0), qv3 = qv.slice(-3).reduce((x, y) => x + y, 0);
  const tq4 = tq.slice(-7, -3).reduce((x, y) => x + y, 0), qv4 = qv.slice(-7, -3).reduce((x, y) => x + y, 0);
  const tb3 = qv3 === 0 ? 0 : tq3 / qv3, tbPrior = qv4 === 0 ? 0 : tq4 / qv4;
  const tbDelta = tb3 - tbPrior;
  const pr = (tb7 >= 0.55 ? 6 : tb7 >= 0.52 ? 5 : tb7 >= 0.5 ? 4 : tb7 >= 0.47 ? 2 : 1) + (tbDelta > 0.02 ? 4 : tbDelta > 0 ? 2 : 0);
  let st;
  if (bwPct <= 25) st = (last > e20 && p7 >= 0 ? 6 : 2);
  else if (bwPct <= 60) st = 4;
  else st = 3;
  st += (hi90d <= 0.05 ? 4 : hi90d <= 0.12 ? 3 : hi90d <= 0.25 ? 1 : 0);
  return {
    comp: { tr: tr, q: q, mo: mo, vo: vo, pr: pr, st: st },
    adx: Number.isFinite(adxV) ? +adxV.toFixed(1) : null,
    plusDi: Number.isFinite(adxR.plusDi) ? +adxR.plusDi.toFixed(1) : null,
    minusDi: Number.isFinite(adxR.minusDi) ? +adxR.minusDi.toFixed(1) : null,
    riskAdj30: Number.isFinite(ra30) ? +ra30.toFixed(2) : null,
    obvDir: obv.dir,
    bbWidthPct: bwPct,
    tbDelta: +(tbDelta * 100).toFixed(1)
  };
}

export const MIN_ADX = 15;
export const MIN_RISKADJ30 = 0;

export function passesGateV2(sig) {
  const mm = sig && sig.metrics ? sig.metrics : null;
  const rsi = mm ? Number(mm.rsi) : NaN;
  const vol = mm ? Number(mm.volMio) : NaN;
  const q = Number(sig && sig.quantScore);
  if (!Number.isFinite(q) || q < 86) return false;
  if (Number.isFinite(rsi) && rsi > 75) return false;
  if (Number.isFinite(vol) && vol < 10) return false;
  const adx = mm && mm.adx != null ? Number(mm.adx) : NaN;
  if (Number.isFinite(adx) && adx < MIN_ADX) return false;
  const ra = mm && mm.riskAdj30 != null ? Number(mm.riskAdj30) : NaN;
  if (Number.isFinite(ra) && !(ra > MIN_RISKADJ30)) return false;
  return true;
}
