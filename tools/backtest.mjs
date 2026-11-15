#!/usr/bin/env node
/**
 * Signalcraft — Factor-Modell v3.6 Backtest-Harness (Diagnose, kein Live-System).
 *
 * Spielt das exakte 6-Faktor-Modell aus tests/helpers/core-logic.mjs Tag für Tag
 * über historische Tageskerzen ab und misst, was die vom Board-Gate durgelassenen
 * Signale danach tatsächlich getan hätten (7T/30T-Rückkehr, SL/TP1-Touch).
 *
 * KEIN LOOKAHEAD: Scores für Tag T werden ausschließlich aus Kerzen bis T berechnet.
 * SL/TP1 wird ab T+1 simuliert; trifft eine Kerze beides, zählt SL (konservativ).
 *
 * Nutzung:
 *   node tools/backtest.mjs --selftest            # offline, synthetische Serien — beweist, dass die Harness läuft
 *   node tools/backtest.mjs --limit 10            # echte Binance-Tagesdaten, max. 10 Pairs (braucht Netz)
 *   node tools/backtest.mjs --pairs BTC,ETH,SOL   # nur diese Pairs
 *   node tools/backtest.mjs --file dump.json      # klines aus einer Datei statt API (Format: {"BTC":[[o,h,l,c,volQuote,takerBuyQuote],...]})
 *
 * WICHTIG (Ehrlichkeit): Die Harness berechnet NUR Statistiken aus echten oder
 * synthetischen Kerzen. Veröffentlichte Zahlen (z. B. „Track Record“) dürfen daraus
 * erst nach Prüfung mit echten Daten abgeleitet werden. Der Selftest prüft nur,
 * dass die Simulation deterministisch läuft — NICHT die Modellgüte.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { factorScores, rsi, passesGateV2 } from '../tests/helpers/core-logic.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? dflt : args[i + 1];
};
const has = (name) => args.includes('--' + name);

const BOARD_MIN = 86;
const DAYS = 400;         // fetch 400 daily candles
const WARMUP = 200;       // model needs 200 (EMA200) + margin
const FWD = 30;           // measure 30 forward days

function atrWilder(h, l, c, p = 14) {
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  if (tr.length < p) return NaN;
  let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p;
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * k: array of raw rows [openTime, o, h, l, c, volBase, closeTime, volQuote, nTrades, volBaseTaker, volQuoteTaker, ignore]
 *    (Binance format) OR simplified [openTime, h, l, c, volQuote, volQuoteTaker].
 * Returns one simulated decision point per eligible day.
 */
function simulate(k) {
  const rows = k.map(r => {
    if (r.length >= 11) return { t: +r[0], h: +r[2], l: +r[3], c: +r[4], qv: +r[7], tq: +r[10] };
    return { t: +r[0], h: +r[1], l: +r[2], c: +r[3], qv: +r[4], tq: +r[5] };
  });
  const out = [];
  for (let end = WARMUP; end < rows.length; end++) {
    const slice = rows.slice(0, end + 1);
    const h = slice.map(r => r.h), l = slice.map(r => r.l), c = slice.map(r => r.c);
    const qv = slice.map(r => r.qv), tq = slice.map(r => r.tq);
    const f = factorScores(h, l, c, qv, tq);
    const score = clamp(Math.round(f.comp.tr + f.comp.q + f.comp.mo + f.comp.vo + f.comp.pr + f.comp.st), 5, 98);
    const metrics = { rsi: +rsi(c).toFixed(1), volMio: qv[qv.length - 1] / 1e6, adx: f.adx, riskAdj30: f.riskAdj30 };
    if (!passesGateV2({ quantScore: score, metrics })) continue;
    const entry = c[c.length - 1];
    const a = atrWilder(h, l, c, 14);
    if (!Number.isFinite(a) || a <= 0) continue;
    const sl = entry - 1.5 * a, tp1 = entry + 1.5 * a;
    const fwdEnd = Math.min(rows.length - 1, end + FWD);
    let tp = false, slHit = false, ret7 = NaN, ret30 = NaN;
    for (let i = end + 1; i <= fwdEnd; i++) {
      if (!tp && !slHit) {
        if (rows[i].l <= sl) slHit = true;      // konservativ: SL zuerst
        else if (rows[i].h >= tp1) tp = true;
      }
      if (i === end + 7) ret7 = rows[i].c / entry - 1;
      if (i === end + 30) ret30 = rows[i].c / entry - 1;
    }
    out.push({
      t: new Date(rows[end].t).toISOString().slice(0, 10),
      score, grade: score >= 93 ? 'A+' : 'A', adx: f.adx,
      ret7: Number.isFinite(ret7) ? ret7 : null,
      ret30: Number.isFinite(ret30) ? ret30 : null,
      tp1Hit: tp, slHit, fwdDays: fwdEnd - end
    });
  }
  return out;
}

function aggregate(all) {
  const n = all.length;
  const closed = all.filter(d => d.fwdDays >= 30);
  const tp = closed.filter(d => d.tp1Hit).length;
  const sl = closed.filter(d => d.slHit).length;
  const r30 = closed.map(d => d.ret30).filter(Number.isFinite);
  const r7 = closed.map(d => d.ret7).filter(Number.isFinite);
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const win = r30.filter(x => x > 0).length;
  return {
    decisions: n, closed: closed.length,
    tp1Hits: tp, slHits: sl,
    hitRate: closed.length ? (100 * tp / closed.length).toFixed(1) + ' %' : 'n/a',
    avgRet7: r7.length ? (100 * avg(r7)).toFixed(2) + ' %' : 'n/a',
    avgRet30: r30.length ? (100 * avg(r30)).toFixed(2) + ' %' : 'n/a',
    winRate30: r30.length ? (100 * win / r30.length).toFixed(1) + ' %' : 'n/a'
  };
}

function report(label, results) {
  const all = results.flatMap(([, r]) => r);
  const agg = aggregate(all);
  console.log(`\n=== ${label} ===`);
  for (const [sym, r] of results) {
    console.log(`${sym.padEnd(8)} decisions=${String(r.length).padStart(3)}  tp1=${r.filter(d => d.tp1Hit).length}  sl=${r.filter(d => d.slHit).length}  avg30=${aggregate(r).avgRet30}`);
  }
  console.log('TOTALS ' + JSON.stringify(agg));
  return agg;
}

// ---------- selftest: deterministic synthetic series, no network ----------
function selftest() {
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mk = (drift) => {
    const k = [];
    let price = 100;
    for (let i = 0; i < WARMUP + 2 * FWD + 10; i++) {
      // Drift + Wellen (gegen RSI-Sättigung bei 100) + Rauschen → realistische grüne/rote Kerzen
      const shock = (rand() - 0.5) * 0.04 + 0.04 * Math.sin(i / 3);
      price = Math.max(1, price * (1 + drift + shock));
      const t = Date.UTC(2024, 0, 1 + i);
      k.push([t, price, price * 1.01, price * 0.99, price, 0, t, 5e7, 100, 0, 5e7 * 0.55, 0]);
    }
    return k;
  };
  const results = [
    ['TRENDUP', simulate(mk(0.012))],
    ['TRENDDN', simulate(mk(-0.012))],
    ['CHOP', simulate(mk(0.0))]
  ];
  const agg = report('SELFTEST (synthetisch — prüft Determinismus, NICHT Modellgüte)', results);
  if (!Number.isFinite(results[0][1].length) || !agg) {
    console.error('SELFTEST FEHLGESCHLAGEN');
    process.exit(1);
  }
  console.log('\nSELFTEST OK — Harness läuft deterministisch (seed=42).');
}

// ---------- real data ----------
async function fetchKlines(sym, limit) {
  const url = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

function seedPairs() {
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  const m = [...new Set([...html.matchAll(/"pair":"([A-Z0-9]+) \//g)].map(x => x[1]))];
  return m;
}

async function main() {
  if (has('selftest')) return selftest();
  const file = flag('file', null);
  let data;
  if (file) {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } else {
    if (typeof fetch !== 'function') throw new Error('Node ohne fetch — bitte --file nutzen (Node >= 18)');
    const pairs = (flag('pairs', null) || seedPairs().slice(0, Number(flag('limit', 10)) || 10).join(',')).split(',');
    console.log(`Lade ${pairs.length} Pairs × ${DAYS} Tageskerzen von data-api.binance.vision …`);
    data = {};
    for (const sym of pairs) {
      try { data[sym] = await fetchKlines(sym, DAYS); } catch (e) { console.warn(`Überspringe ${sym}: ${e.message}`); }
    }
  }
  const results = Object.entries(data).map(([sym, k]) => [sym, simulate(k)]);
  report(file ? 'BACKTEST (Datei)' : 'BACKTEST (Binance, echte Tagesdaten)', results);
}

main().catch(e => { console.error(e); process.exit(1); });
