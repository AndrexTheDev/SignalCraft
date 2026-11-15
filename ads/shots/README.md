# Marketing-Screenshots (v3.5 + v3.6, 2026-11-15)

Diese Shots wurden am 2026-11-15 frisch aus dem aktuellen Build generiert
(headless Chromium, lokaler Server, DEMO-Build-Snapshot mit ehrlichen
Platzhaltern). Sie zeigen ausschließlich die ehrliche UI: exklusives
Grade-A-Board, Kaufdruck-Score (Taker-Flows), fertige Trade-Pläne –
keine Wal-/Netflow-/News-Mockups, kein Share-to-Unlock, kein Lead-Formular,
kein 120+-Board.

Die v3.6-Dateien (`*_v36.jpg`) zeigen den Stand mit sechs transparenten
Faktoren und den erweiterten Dossier-Zeilen (ADX 14 / +DI−DI, risikoadjustierte
Momentum, Bollinger-Squeeze/OBV). Die DEMO-Platzhalter („—“) in den v3.6-Shots
stehen für den Build-Snapshot ohne Live-Feed; mit Live-Daten füllen sie sich.

Die alten v3.x-Shots waren fabricationslastig und wurden entfernt; sie sind
über `git log --diff-filter=D -- ads/shots/` in der Historie auffindbar,
**dürfen aber nicht veröffentlicht werden**.

## Dateien (v3.6)

- 01_landing_en_v36.jpg — Landing (EN), Hero + Board-Beispiel
- 02_terminal_en_v36.jpg — Terminal (EN, Gallery Dark): Exclusive Grade-A Board
- 03_sentiment_open_en_v36.jpg — Kaufdruck-Drawer offen
- 04_chart_open_en_v36.jpg — Candlestick-Chart mit Entry/SL/TP
- 05_dossier_en_v36.jpg — Dossier-Modal, gescrollt zu Marktstruktur + Positions-Rechner + Score-Komponenten (DEMO zeigt den ehrlichen „Build-Snapshot (älteres Scoring-Modell)“-Hinweis statt Balken)
- 06_sharecard_en_v36.jpg — Share-Card (Canvas, 1200×675)
- 07_donation_en_v36.jpg — Spenden-Modal (SOL/BTC/ETH)
- 08_theme_amber_es_v36.jpg — Terminal Amber Theme (ES)
- 09_theme_paper_en_v36.jpg — Paper Light Theme (EN)
- 10_rtl_arabic_mobile_v36.jpg — Arabisch (RTL), Mobile
- 11_landing_zh_tablet_v36.jpg — Landing Chinesisch, Tablet
- 12_empty_search_en_v36.jpg — Leerer Suchzustand („ZZZNOCOIN999“)
- 13_landing_full_en_v36.jpg — Landing komplett (EN)

Drive-Kopie: „SignalCraft v3.6 Screenshots“
(https://drive.google.com/drive/folders/1gkZuZ6Htw4G13jUpEiwxmZVG5tfo7_Dn).

## Dateien (v3.5)

- 01_landing_en_v35.jpg — Landing (EN), Hero + Board-Beispiel
- 02_terminal_en_v35.jpg — Terminal (EN, Gallery Dark): Exclusive Grade-A Board
- 03_sentiment_open_en_v35.jpg — Kaufdruck-Drawer offen
- 04_chart_open_en_v35.jpg — Candlestick-Chart mit Entry/SL/TP
- 05_dossier_en_v35.jpg — Dossier-Modal inkl. Positions-Rechner
- 06_sharecard_en_v35.jpg — Share-Card (Canvas, 1200×675)
- 07_donation_en_v35.jpg — Spenden-Modal (Ehrenwort, SOL/BTC/ETH)
- 08_theme_amber_es_v35.jpg — Terminal Amber Theme (ES, frei wählbar)
- 09_theme_paper_en_v35.jpg — Paper Light Theme (EN, frei wählbar)
- 10_rtl_arabic_mobile_v35.jpg — Arabisch (RTL), Mobile
- 11_landing_zh_tablet_v35.jpg — Landing Chinesisch, Tablet
- 12_empty_search_en_v35.jpg — Leerer Suchzustand („ZZZNOCOIN999“)
- 13_landing_full_en_v35.jpg — Landing komplett (EN)

## Neu erstellen

```bash
npm run test:step5   # Landing ×5 Sprachen ×Viewports + Terminal ×5 ×3 Themes + State-Extras
npm run test:step7   # Extras: Dossier ES, Theme Amber ES, Deep-Link, ZH-Landing …
```

Die Shots landen in `tests/artifacts/shots/` und müssen vor dem Posten
geprüft werden: nur echte Build-UI. Siehe auch ads/signalcraft_promo_kit.txt.
