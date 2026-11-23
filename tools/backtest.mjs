#!/usr/bin/env node
/**
 * Signalcraft historical research harness — NOT a published-signal track record.
 *
 * Scores use the six-factor mirror and 200 closed daily candles. A completed
 * UTC day's quote volume is the 24h-volume proxy at that day's close. The live
 * app evaluates an unfinished candle and a rolling ticker during the day, so
 * this is not an exact replay of what users saw. No cross-sectional top-10
 * selection, live availability gate, fees, spread, slippage or actual fills are
 * simulated. Signals/forward windows may overlap and pairs are selected today.
 * Entry assumes the signal-day close; stop/TP1 checks begin on the next day and
 * stop wins if both touch in one bar. A stop can fill worse than its level.
 *
 * node tools/backtest.mjs --selftest
 * node tools/backtest.mjs --limit 10 | --pairs BTC,ETH
 * node tools/backtest.mjs --file dump.json
 * File: {"BTC": [[openTime, high, low, close, quoteVolume, takerBuyQuote], ...]}
 * or the Binance raw kline shape. Times are UTC daily open times in milliseconds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { factorScores, rsi, adxWilder, riskAdjMom, r5, roundTargetUp, validLongPlan, parseMarketNumber, priceChange, factorWindowComputable } from '../tests/helpers/core-logic.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86400000;
const DAYS = 400;
const WINDOW = 200;
const FWD = 30;

/** Fail closed on malformed, out-of-order or discontinuous input. */
export function normalizeCandles(data) {
  if (!Array.isArray(data)) throw new Error('Kerzen müssen ein Array sein');
  let previousTime = null;
  return data.map((row, i) => {
    if (!Array.isArray(row) || !(row.length === 6 || row.length >= 11)) throw new Error(`Kerze ${i}: ungültiges Format`);
    const raw = row.length >= 11;
    const keys = raw ? [0, 1, 2, 3, 4, 6, 7, 10] : [0, 1, 2, 3, 4, 5];
    if (keys.some(k => row[k] == null || (typeof row[k] === 'string' && !row[k].trim()))) throw new Error(`Kerze ${i}: fehlender Wert`);
    const t = parseMarketNumber(row[0]);
    const o = raw ? parseMarketNumber(row[1]) : null;
    const h = parseMarketNumber(row[raw ? 2 : 1]), l = parseMarketNumber(row[raw ? 3 : 2]);
    const c = parseMarketNumber(row[raw ? 4 : 3]), qv = parseMarketNumber(row[raw ? 7 : 4]), tq = parseMarketNumber(row[raw ? 10 : 5]);
    const close = raw ? parseMarketNumber(row[6]) : t + DAY - 1;
    if (![t, h, l, c, qv, tq, close].every(Number.isFinite) || (raw && !Number.isFinite(o)) ||
        !Number.isSafeInteger(t) || !Number.isSafeInteger(close) || t <= 0 || t % DAY !== 0 || close !== t + DAY - 1 ||
        !Number.isFinite(new Date(t).getTime()) || !Number.isFinite(new Date(close).getTime()) ||
        (i > 0 && t - previousTime !== DAY) || l <= 0 || c < l || h < c ||
        (raw && (o < l || o > h)) || qv < 0 || tq < 0 || tq > qv) {
      throw new Error(`Kerze ${i}: ungültige Werte oder lückenhafte Tagesreihe`);
    }
    previousTime = t;
    return { t, h, l, c, qv, tq };
  });
}

/** Excludes the running UTC day and any future rows. */
export function closedCandles(data, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Ungültiger Zeitstempel');
  const currentStart = Math.floor(now / DAY) * DAY;
  return normalizeCandles(data).filter(row => row.t < currentStart);
}

export function atrWilder(h, l, c, p = 14) {
  const tr = [];
  for (let i = 1; i < c.length; i++) tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  if (tr.length < p) return NaN;
  let a = tr.slice(0, p).reduce((x, y) => x + y, 0) / p;
  for (let i = p; i < tr.length; i++) a = (a * (p - 1) + tr[i]) / p;
  return a;
}

export function passesResearchGate(score, metrics) {
  return Number.isFinite(score) && score >= 86 &&
    ['rsi', 'volMio', 'adx', 'riskAdj30'].every(key => typeof metrics?.[key] === 'number' && Number.isFinite(metrics[key])) &&
    metrics.rsi <= 75 && metrics.volMio >= 10 && metrics.adx >= 15 && metrics.riskAdj30 > 0;
}


export function simulate(data, now = Date.now(), diagnostics = null) {
  const rows = closedCandles(data, now), out = [];
  if (diagnostics) Object.assign(diagnostics, { windows: 0, noVolumeWindows: 0, unsafeWindows: 0 });
  for (let end = WINDOW - 1; end < rows.length; end++) {
    if (diagnostics) diagnostics.windows++;
    const slice = rows.slice(end + 1 - WINDOW, end + 1);
    const h = slice.map(r => r.h), l = slice.map(r => r.l), c = slice.map(r => r.c);
    const qv = slice.map(r => r.qv), tq = slice.map(r => r.tq);
    if (!(qv.at(-1) > 0) || !qv.slice(-31, -1).some(v => v > 0) || !qv.slice(-7, -3).some(v => v > 0)) {
      if (diagnostics) diagnostics.noVolumeWindows++;
      continue;
    }
    if (!factorWindowComputable(h, c, qv, tq)) {
      if (diagnostics) diagnostics.unsafeWindows++;
      continue;
    }
    const f = factorScores(h, l, c, qv, tq);
    if (!Number.isFinite(f.tbDelta) || !Number.isFinite(f.bbWidthPct)) {
      if (diagnostics) diagnostics.unsafeWindows++;
      continue;
    }
    const score = Math.max(5, Math.min(98, Math.round(f.comp.tr + f.comp.q + f.comp.mo + f.comp.vo + f.comp.pr + f.comp.st)));
    const metrics = { rsi: rsi(c), volMio: qv.at(-1) / 1e6, adx: adxWilder(h, l, c, 14).adx, riskAdj30: riskAdjMom(c, 30) };
    if (!passesResearchGate(score, metrics)) continue;
    const last = c.at(-1), a = atrWilder(h, l, c, 14);
    if (!Number.isFinite(a) || a <= 0) continue;
    const rawSl = last - 1.5 * a, rawTp1 = last + 1.5 * a;
    const hi20 = Math.max(...h.slice(-20));
    let rawTp2 = Math.max(last + 3 * a, Math.min(last + 4.5 * a, hi20 * 1.01));
    if (rawTp2 <= rawTp1 * 1.03) rawTp2 = last + 3 * a;
    const entry = r5(last), sl = r5(rawSl), tp1 = r5(rawTp1);
    const tp2 = roundTargetUp(Math.max(rawTp2, tp1, entry + 2 * (entry - sl)));
    if (!validLongPlan(entry, sl, tp1, tp2)) continue;
    const fwdEnd = Math.min(rows.length - 1, end + FWD);
    let tp = false, slHit = false, ret7 = null, ret30 = null;
    for (let i = end + 1; i <= fwdEnd; i++) {
      if (!tp && !slHit) {
        if (rows[i].l <= sl) slHit = true;
        else if (rows[i].h >= tp1) tp = true;
      }
      if (i === end + 7) ret7 = priceChange(rows[i].c, entry);
      if (i === end + 30) ret30 = priceChange(rows[i].c, entry);
    }
    out.push({ t: new Date(rows[end].t).toISOString().slice(0, 10), score, grade: score >= 93 ? 'A+' : 'A',
      adx: f.adx, entry, sl, tp1, tp2, ret7, ret30, tp1Hit: tp, slHit, fwdDays: fwdEnd - end });
  }
  return out;
}

export function aggregate(all) {
  const closed = all.filter(d => d.fwdDays >= FWD);
  const tp = closed.filter(d => d.tp1Hit).length, sl = closed.filter(d => d.slHit).length;
  const unresolved = closed.filter(d => !d.tp1Hit && !d.slHit).length;
  const validReturn = value => Number.isFinite(value) && value > -1;
  const r30 = closed.map(d => d.ret30).filter(validReturn), r7 = closed.map(d => d.ret7).filter(validReturn);
  // Incremental mean avoids overflow in an intermediate sum of valid returns.
  const averagePercent = values => {
    if (!values.length) return 'n/a';
    let avg = 0;
    values.forEach((value, i) => { avg += (value - avg) / (i + 1); });
    const pct = avg * 100;
    return Number.isFinite(pct) ? pct.toFixed(2) + ' %' : 'n/a';
  };
  return {
    decisions: all.length, closed: closed.length, incomplete: all.length - closed.length,
    tp1Hits: tp, slHits: sl, unresolved: unresolved,
    hitRate: closed.length ? (100 * tp / closed.length).toFixed(1) + ' %' : 'n/a',
    r7Count: r7.length, r30Count: r30.length,
    avgRet7: averagePercent(r7), avgRet30: averagePercent(r30),
    winRate30: r30.length ? (100 * r30.filter(x => x > 0).length / r30.length).toFixed(1) + ' %' : 'n/a'
  };
}

function report(label, results, coverage) {
  const all = results.flatMap(([, r]) => r);
  const agg = aggregate(all);
  console.log(`\n=== ${label} ===`);
  console.log('COVERAGE ' + JSON.stringify(coverage));
  if (coverage.skipped) console.log('Warnung: Paare wurden übersprungen oder sind fehlgeschlagen; Einzelheiten stehen auf stderr.');
  console.log('closedDays/range: verfügbare abgeschlossene UTC-Tageskerzen je Paar; keine Zusicherung vollständiger Marktabdeckung.');
  console.log('unsafeWindows: wegen numerisch unsicherer Zwischenwerte übersprungen; noVolumeWindows: unzureichende Volumendaten.');
  console.log('FORSCHUNGSDIAGNOSE: abgeschlossene UTC-Tage; keine Live-Board-Rekonstruktion, keine Gebühren/Slippage, keine realen Fills.');
  console.log('Heutige Paar-Auswahl, überlappende Signale; Entry zum gerundeten Tagesschluss angenommen.');
  console.log('7T/30T-Renditen sind Kursveränderungen unabhängig von Stop/TP, keine realisierte Rendite. Keine Aussage zur künftigen Performance.');
  console.log('Nur 30 Tage vollständig beobachtete Fenster zählen für Quoten und Renditen. Unresolved: weder TP1 noch Stop erreicht; r7Count/r30Count: gültige Renditen.');
  for (const [sym, r, span] of results) {
    const a = aggregate(r);
    console.log(`${sym.padEnd(8)} decisions=${String(a.decisions).padStart(3)}  completed=${a.closed}  tp1=${a.tp1Hits}  sl=${a.slHits}  unresolved=${a.unresolved}  r7Count=${a.r7Count}  r30Count=${a.r30Count}  avg30=${a.avgRet30}  closedDays=${span.closedDays}  range=${span.first}..${span.last}  windows=${span.windows}  noVolumeWindows=${span.noVolumeWindows}  unsafeWindows=${span.unsafeWindows}`);
  }
  console.log('TOTALS ' + JSON.stringify(agg));
  return agg;
}

function syntheticData() {
  let seed = 42;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const mk = drift => {
    const k = []; let price = 100;
    for (let i = 0; i < WINDOW + 2 * FWD + 10; i++) {
      const shock = (rand() - 0.5) * 0.04 + 0.04 * Math.sin(i / 3);
      price = Math.max(1, price * (1 + drift + shock));
      const t = Date.UTC(2024, 0, 1 + i);
      k.push([t, price, price * 1.01, price * 0.99, price, 0, t + DAY - 1, 5e7, 100, 0, 5e7 * 0.55, 0]);
    }
    return k;
  };
  return [['TRENDUP', mk(0.012)], ['TRENDDN', mk(-0.012)], ['CHOP', mk(0.0)]];
}

function candleSpan(closed, diagnostics) {
  return { closedDays: closed.length, first: new Date(closed[0].t).toISOString().slice(0, 10), last: new Date(closed.at(-1).t).toISOString().slice(0, 10), ...diagnostics };
}

function selftest() {
  const now = Date.UTC(2026, 0, 1), series = syntheticData();
  const evaluate = list => list.map(([sym, rows]) => {
    const diagnostics = {}, decisions = simulate(rows, now, diagnostics);
    return [sym, decisions, candleSpan(closedCandles(rows, now), diagnostics)];
  });
  const results = evaluate(series), repeated = evaluate(syntheticData());
  if (JSON.stringify(results) !== JSON.stringify(repeated) || !results[0][1].length) throw new Error('SELFTEST FEHLGESCHLAGEN');
  report('SELFTEST (synthetisch — prüft Determinismus, NICHT Modellgüte)', results, { requested: series.length, processed: results.length, skipped: 0 });
  console.log('\nSELFTEST OK — zwei unabhängige synthetische Läufe sind identisch.');
}

async function fetchKlines(sym, limit) {
  if (!/^[A-Z0-9]{1,20}$/.test(sym)) throw new Error('ungültiges Paar');
  const address = `https://data-api.binance.vision/api/v3/klines?symbol=${sym}USDT&interval=1d&limit=${limit}`;
  const res = await fetch(address, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

function seedPairs() {
  const html = fs.readFileSync(path.join(ROOT, 'app.html'), 'utf8');
  return [...new Set([...html.matchAll(/"pair":"([A-Z0-9]+) \//g)].map(x => x[1]))];
}

// JSON.parse silently overwrites repeated object keys. Scan the already-valid
// JSON text at the top level so duplicate pair series cannot disappear unseen.
function rejectDuplicatePairKeys(text) {
  let i = 0;
  const skipSpace = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  skipSpace();
  if (text[i++] !== '{') return;
  const keys = new Set();
  while (i < text.length) {
    skipSpace();
    if (text[i] === '}') return;
    const begin = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') break;
    }
    const key = JSON.parse(text.slice(begin, i));
    if (keys.has(key)) throw new Error('Doppelter Paar-Schlüssel in Datei');
    keys.add(key);
    skipSpace(); i++; // colon; full syntax was checked by JSON.parse
    let depth = 0, quoted = false;
    while (i < text.length) {
      const ch = text[i];
      if (quoted) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        if (depth === 0) break;
        depth--;
      } else if (ch === ',' && depth === 0) break;
      i++;
    }
    if (text[i] === ',') i++;
    else return;
  }
}

function parseArguments(args) {
  const options = {};
  const valid = new Set(['--file', '--pairs', '--limit', '--selftest']);
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (!valid.has(name)) throw new Error('Unbekannte Option: ' + name);
    if (Object.prototype.hasOwnProperty.call(options, name)) throw new Error('Option mehrfach angegeben: ' + name);
    if (name === '--selftest') { options[name] = true; continue; }
    if (i + 1 >= args.length || args[i + 1].startsWith('--') || !args[i + 1]) throw new Error('Wert fehlt für ' + name);
    options[name] = args[++i];
  }
  if (options['--selftest'] && Object.keys(options).length !== 1) throw new Error('--selftest darf nicht kombiniert werden');
  if (options['--file'] && (options['--pairs'] || options['--limit'])) throw new Error('--file darf nicht mit --pairs oder --limit kombiniert werden');
  if (options['--pairs'] && options['--limit']) throw new Error('--pairs und --limit dürfen nicht kombiniert werden');
  if (options['--limit'] && (!/^[1-9]\d*$/.test(options['--limit']) || !Number.isSafeInteger(Number(options['--limit'])))) throw new Error('--limit muss eine positive Ganzzahl sein');
  if (options['--pairs']) {
    const pairs = options['--pairs'].split(',');
    if (pairs.some(sym => !/^[A-Z0-9]{1,20}$/.test(sym))) throw new Error('Ungültiges Paar-Symbol');
    if (new Set(pairs).size !== pairs.length) throw new Error('Doppelte Paar-Symbole sind nicht erlaubt');
  }
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options['--selftest']) return selftest();
  const file = options['--file'];
  let data, requested;
  if (file) {
    const text = fs.readFileSync(file, 'utf8');
    data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Eingabe muss ein Objekt mit Paaren und Kerzenreihen sein');
    rejectDuplicatePairKeys(text);
    requested = Object.keys(data).length;
  } else {
    const pairs = options['--pairs'] ? options['--pairs'].split(',') : seedPairs().slice(0, Number(options['--limit'] || 10));
    requested = pairs.length;
    console.log(`Lade ${pairs.length} Paare × ${DAYS} Tageskerzen von data-api.binance.vision …`);
    data = {};
    for (const sym of pairs) {
      try { data[sym] = await fetchKlines(sym, DAYS); } catch (e) { console.warn(`Überspringe ${sym}: ${e.message}`); }
    }
  }
  const now = Date.now(), results = [];
  for (const [sym, rows] of Object.entries(data)) {
    // Do not let untrusted file keys inject terminal control sequences.
    if (!/^[A-Z0-9]{1,20}$/.test(sym)) { console.warn('Überspringe ungültigen Paar-Schlüssel (erlaubt: A–Z und 0–9).'); continue; }
    try {
      const closed = closedCandles(rows, now);
      if (closed.length < WINDOW) throw new Error('weniger als 200 abgeschlossene Tageskerzen');
      const diagnostics = {}, decisions = simulate(rows, now, diagnostics);
      results.push([sym, decisions, candleSpan(closed, diagnostics)]);
    } catch (e) { console.warn(`Überspringe ${sym}: ${e.message}`); }
  }
  const coverage = { requested, processed: results.length, skipped: requested - results.length };
  if (!results.length) { console.log('COVERAGE ' + JSON.stringify(coverage)); throw new Error('Keine gültige Kerzenreihe verfügbar'); }
  report(file ? 'BACKTEST (Datei)' : 'BACKTEST (Binance-Tagesdaten)', results, coverage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
