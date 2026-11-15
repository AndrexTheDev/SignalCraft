# Signalcraft Atelier

Kostenlose Krypto-Signale aus echten Binance-Daten – exklusiv: nur **Grade A** kommt aufs Board.  
Live: [signalcraft.click](https://signalcraft.click)

Statische Site — kein Backend, kein Account, keine Ads. Landing (`index.html`) + Terminal (`app.html`).

## Produkt (v3.5)

- 120 Paare werden aus echten Binance-Tagesdaten bewertet; nur **Grade A** (Quant ≥ 86 **und** RSI(14) ≤ 75 **und** 24h-Volumen ≥ 10 Mio. $) kommt aufs Board — im Build-Seed sind das genau 10 Setups.
- Fertiger Trade-Plan je Signal: Entry, Stop, TP1/TP2, R:R ≥ 1:2.
- Kaufdruck-Score 0–100 aus echten Taker-Flows (7d), Volumen-Momentum und globalem Fear-&-Greed-Index. **Keine** erfundenen On-Chain-/Social-/News-Daten.
- Dossier mit ATR, SMA 50/200, 90T-Hoch-Abstand, 7T/30T-Performance, 1–2%-Risiko-Positionsgrößen-Rechner.
- Live-Preise aus 11 öffentlichen CEX-APIs (Binance, OKX, Bybit, Kraken u. a.) plus DEX-Quellen (Hyperliquid, dYdX v4, DexScreener); Fallback: Build-Snapshot, klar gekennzeichnet. DE / EN / ES / AR / ZH.
- Landing-Track-Record: ein nicht-überlappender historischer Pfad pro veröffentlichtem Grade-A-Setup (24 Tageskerzen, Stop = Verlust). Stand des Seeds: **8/10 Pfade TP1 erreicht** (A+ 1/1, A 7/9) — kleine ehrliche Stichprobe, **keine** Performance-Zusage, keine Prognose.
- Fear-&-Greed-Anzeige: ohne API-Antwort bleibt der Wert leer (`–`) statt eines erfundenen Defaults.
- Spenden: SOL / BTC / ETH (Copy-Buttons). Fortschrittsbalken = lokaler Community-Seed, kein Payment-API.

## Lokal

```bash
npm install
npm run serve          # http://0.0.0.0:4173
npm run test:unit      # statische Verträge (node --test)
```

E2E (Chromium) läuft über `npm run test:step3` … `test:step29` und benötigt ein funktionierendes Chromium-Binary (libnss3 etc.). Ohne diese Bibliotheken schlagen die Browser-Tests fehl — im Zweifel `test:unit` als verlässliches Gate nutzen.

## Deploy

Cloudflare Worker **signalcraft**, assets-only (`wrangler.toml`).  
`.assetsignore` hält Tests, Ads-Kit, `node_modules` und Uploads vom öffentlichen Bundle fern.

## Hinweis

Kein Finanzrat. Spot-Setups, eigenes Risiko. Historie ≠ Zukunft.
