# Signalcraft Atelier

Kostenlose Krypto-Signale aus echten Binance-Daten – exklusiv: nur **Grade A** kommt aufs Board.  
Live: [signalcraft.click](https://signalcraft.click)

Statische Site — kein Backend, kein Account, keine Ads, kein Tracking, keine E-Mail-Erfassung. Landing (`index.html`) + Terminal (`app.html`).

## Produkt (v3.6)

- 120 Paare werden aus echten Binance-Tagesdaten bewertet; nur **Grade A** (Quant ≥ 86 **und** RSI(14) ≤ 75 **und** 24h-Volumen ≥ 10 Mio. $ **und** ADX(14) ≥ 15 **und** positiv risikoadjustiertes 30T-Momentum) kommt aufs Board — im Build-Seed sind das genau 10 Setups. Hinweis: Die neuen Gate-Regeln gelten für live berechnete Signale; der statische Build-Snapshot im Seed bleibt als Fallback (DEMO-Modus) mit seiner ursprünglichen Kalibrierung sichtbar, wird also nicht stillschweigend „umbenotet“.

## Was ist neu in v3.6

- **Sechs-Faktor-Modell v2** durchgehend verdrahtet (Engine in `app.html`, gespiegelt in `tests/helpers/core-logic.mjs` mit Drift-Guard `step31`): Trend (EMA), Trend-Qualität (ADX(14) Wilder + DI-Richtung), risikoadjustiertes Momentum (30T-Return ÷ annualisierte Vol), relatives Volumen + OBV, Taker-Kaufdruck, Struktur (BB-Squeeze-Perzentil + Abstand zum 90T-Hoch).
- **Erweitertes Live-Gate**: zusätzlich ADX(14) ≥ 15 und positives risikoadjustiertes 30T-Momentum (nur für live berechnete Signale). Das Gate schlägt nie stillschweigend offen fehl; der DEMO-Build-Snapshot bleibt als solcher gekennzeichnet.
- **Dossier**: neue Zeilen (ADX mit +DI/−DI, risikoadjustiertes Momentum, Squeeze-Status mit OBV-Richtung, 90T-Hoch-Abstand), sechs Komponenten-Bars, LIVE/DEMO-Modus-Tags, lokalisierte Kicker- und Ticker-DEMO-Labels (DE/EN/ES/AR/ZH), korrigierte Abschnitts-Header (keine doppelten Klammern mehr), Komponenten-Wert XSS-gehärtet (`Number()`).
- **Landing + Terminal** komplett auf Sechs-Faktoren-Copy umgestellt; Meta/OG/Twitter/JSON-LD (`softwareVersion` 3.6) konsistent; Footer-Versionen synchron.
- **Tests**: neu `step30-factor-v2` (Engine v2) und `step31-mirror-sync` (Mirror-Drift-Guard). Stand: Unit 227/227, E2E 95/95 (14 Suites) — siehe `tests/reports/`.
- **Sicherheit**: A/B-getestet — ein strikter CSP im `<meta>`-Tag brach den Offline/DEMO-Render-Pfad (E2E fiel auf 86/95) und wurde deshalb bewusst **nicht** erzwungen. Empfehlung: auf dem Host zuerst `Content-Security-Policy-Report-Only` mit Report-Endpoint 1–2 Wochen laufen lassen, danach mit Nonces enforce'n (nie mit `'unsafe-inline'`).
- **Backtest-Harness** `tools/backtest.mjs` committed (`--selftest` prüft nur Determinismus, nicht Modellgüte). Historische Statistiken werden erst nach Prüfung mit echten Binance-Daten veröffentlicht — ohne Netz gibt es hier keine erfundenen Zahlen.

## Signal-Modell

Der Quant-Score (0–100) ist die rohe Summe von sechs transparenten Komponenten — keine versteckte Kalibrierung, kein erfundener On-Chain-Flow:

| # | Komponente | Max | Inhalt |
|---|-----------|-----|--------|
| tr | Trend | 25 | EMA20 über/unter Kurs, EMA20 > EMA50, EMA50 > EMA200, Kurs über EMA200 |
| q  | Trend-Qualität | 15 | ADX(14, Wilder) — ≥25 → 10 Pkt., ≥20 → 7, ≥15 → 4, sonst 1 — plus 5 Pkt. wenn +DI > −DI |
| mo | Momentum | 25 | Risikoadjustiertes 30T-Momentum (30T-Return ÷ auf 30T skalierte Monats-Vol, ≥0.9 → 13 Pkt.) plus 7T-Bestätigung (bis 6) und 30T-Bestätigung (bis 6) |
| vo | Volumen | 15 | Relatives Volumen vs. 30T-Durchschnitt (≥2× → 9 Pkt.) plus OBV-20T-Trend (Akkumulation +6, neutral +3) |
| pr | Kaufdruck | 10 | Taker-Buy-Anteil 7T (≥55 % → 6 Pkt.) plus Taker-Delta (3T vs. vorige 4T, bis +4) |
| st | Struktur | 10 | Bollinger-Bandbreiten-Perzentil (Squeeze ≤ 25 → bis 6 Pkt. bei bestätigter Expansion) plus Abstand zum 90T-Hoch (bis 4) |

Grades: A+ ≥ 93, A ≥ 86, B+ ≥ 78, B ≥ 70, sonst C. Das Board zeigt ausschließlich Grade A (Score ≥ 86) mit RSI(14) ≤ 75, ≥ 10 Mio. $ 24h-Volumen und — sobald die Signale live aus Tagesdaten berechnet sind — ADX(14) ≥ 15 und risikoadjustiertem 30T-Momentum > 0. Sämtliche Faktoren nutzen ausschließlich geschlossene Tageskerzen (kein Lookahead).

### Backtest-Harness

`tools/backtest.mjs` spielt das 6-Faktor-Modell Tag für Tag über Tageskerzen ab (kein Lookahead) und misst, was die vom Board-Gate zugelassenen Signale tatsächlich getan hätten (7T/30T-Return, SL/TP1-Touch, SL-zuerst konservativ). Läuft nur mit Netz-Zugriff auf Binance: `node tools/backtest.mjs --limit 10` (oder `--pairs BTC,ETH`, `--file dump.json`). `--selftest` prüft offline die Determinismus der Simulation, **nicht** die Modellgüte. Historische Statistiken dürfen erst nach Prüfung mit echten Daten veröffentlicht werden — die Harness liefert dafür das Messwerkzeug, keine fertigen Zahlen. Die Datei ist vom öffentlichen Bundle ausgeschlossen (`.assetsignore`). Das Risikoadjustieren des Momentums folgt dem Befund, dass Krypto-Momentum in liquiden Werten am robustesten ist und von einem Vol-Filter profitiert (u. a. Liu et al., „Cryptocurrency factor momentum“, Quantitative Finance 2023; Fieberg et al., 3.918 Coins, Journal of Financial Research 2023); ADX(14) auf Tagesbasis + DI-Richtung ist der robusteste Trendstärke-Filter dieser Klasse, Momentum ohne Trendstärke-Bestätigung ist überwiegend Chop-Rauschen.
- Fertiger Trade-Plan je Signal: Entry, Stop, TP1/TP2, R:R ≥ 1:2.
- Kaufdruck-Score 0–100 aus echten Taker-Flows (7d), Volumen-Momentum und globalem Fear-&-Greed-Index. **Keine** erfundenen On-Chain-/Social-/News-Daten.
- Dossier mit ATR, SMA 50/200, ADX(14), Risikoadjustiertem Momentum, BB-Squeeze-Status, OBV-Richtung, 90T-Hoch-Abstand, 7T/30T-Performance, 1–2%-Risiko-Positionsgrößen-Rechner.
- Live-Preise aus 11 öffentlichen CEX-APIs (Binance, OKX, Bybit, Kraken u. a.) plus DEX-Quellen (Hyperliquid, dYdX v4, DexScreener); Fallback: Build-Snapshot, klar gekennzeichnet. DE / EN / ES / AR / ZH.
- Landing-Track-Record: ein nicht-überlappender historischer Pfad pro veröffentlichtem Grade-A-Setup (24 Tageskerzen, Stop = Verlust). Stand des Seeds: **8/10 Pfade TP1 erreicht** (A+ 1/1, A 7/9) — kleine ehrliche Stichprobe, **keine** Performance-Zusage, keine Prognose.
- In schwachen Marktphasen kann das Live-Board leer sein (kein Setup erfüllt das Grade-A-Gate) — das ist beabsichtigt, kein Fehler; der Seed-Snapshot zeigt dann weiterhin die DEMO-Build-Daten.
- Fear-&-Greed-Anzeige: ohne API-Antwort bleibt der Wert leer (`–`) statt eines erfundenen Defaults.
- Spenden: SOL / BTC / ETH (Copy-Buttons). Ehrenwort-System: Wer gespendet hat, aktiviert lokal den Supporter-Badge — kein Payment-API, kein Fortschrittsbalken, keine Fake-Community-Zahlen.
- Themen: alle frei wählbar (Gallery Dark / Terminal Amber / Paper Light), ohne Share-to-Unlock. Keine E-Mail-Erfassung, kein Newsletter — die App speichert nur lokale Einstellungen (Sprache, Theme, Supporter-Badge) im Browser.

## Lokal

```bash
npm install
npm run serve          # http://0.0.0.0:4173
npm run test:unit      # statische Verträge (node --test, inkl. Faktor-Modell-Mirror)
```

E2E (Chromium) läuft über `npm run test:step3` … `test:step29` und nutzt `@sparticuz/chromium` (in devDependencies). Beim ersten Browser-Start extrahiert der Test-Helper die benötigten System-Bibliotheken (libnspr4/libnss3 u.a.) automatisch nach `/tmp/al2023/lib` — nach einem Sandbox-/Neustart also einfach die Tests erneut laufen lassen, `npm install` genügt als Vorbereitung. `npm run test:unit` bleibt das schnelle, abhängigkeitsfreie Gate.

## Deploy

Cloudflare Worker **signalcraft**, assets-only (`wrangler.toml`).  
`.assetsignore` hält Tests, Ads-Kit, `node_modules` und Uploads vom öffentlichen Bundle fern.

## Hinweis

Kein Finanzrat. Spot-Setups, eigenes Risiko. Historie ≠ Zukunft.
