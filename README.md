# Signalcraft Atelier

Kostenlose Krypto-Signale mit Live-Sentiment, On-Chain-Score und **B+-Quality-Gate**.  
Live: [signalcraft.atelier](https://signalcraft.atelier)

Statische Site — kein Backend, kein Account. Landing (`index.html`) + Terminal (`app.html`).

## Produkt (v3.4)

- 120+ Paare werden bewertet; **nur Grade B+** (Quant ≥ 78) kommt aufs Board (58 Setups im Seed).
- Fertiger Trade-Plan: Entry, Stop, TP1/TP2, R:R.
- 11 CEX + 12 DEX, DE / EN / ES / AR / ZH.
- Track-Record auf der Landing ist ein **berechneter** TP1-Hit aus den B+-Kerzen, keine erfundene Zahl.
- Spenden: SOL / BTC / ETH (Copy-Buttons). Die Fortschrittsleiste ist ein lokaler Community-Seed, kein Payment-API.

## Lokal

```bash
npm install
npm run serve          # http://0.0.0.0:4173
npm run test:unit      # schnelle Verträge
```

E2E (Chromium) über `npm run test:step3` … `test:step29`. Screenshot-Matrix: `test:step5` / `test:step7`.

## Deploy

Cloudflare Worker **signalcraft**, assets-only (`wrangler.toml`).  
`.assetsignore` hält Tests, Ads-Kit, `node_modules` und Uploads vom öffentlichen Bundle fern.

## Hinweis

Kein Finanzrat. Spot-Setups, eigenes Risiko.
