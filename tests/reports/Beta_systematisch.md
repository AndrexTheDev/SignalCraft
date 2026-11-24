# Signalcraft – systematischer Test- und Beta-Bericht

## Testgegenstand und Ergebnis

Geprüft wurde der **lokale, nicht veröffentlichte Arbeitsstand** auf dem aktuellen Branch. Die Tests änderten weder die produktive Website noch Börsenkonten und führten keine Trades oder Spenden aus.

- Build und Prüfung der zehn generierten Sprachseiten: bestanden.
- Unit-Tests: **434/434 bestanden**.
- Browser-E2E-Tests: **348/348 bestanden** (headless Chromium).
- Separater synthetischer Backtest-Selbsttest: bestanden; keine Aussage über reale Rendite.
- `npm audit` einschließlich Entwicklungsabhängigkeiten: **0 bekannte gemeldete Schwachstellen** zum Prüfzeitpunkt; keine Garantie für unbekannte Lücken.
- `git diff --check`: bestanden.

## Beta-Durchläufe

Die Browser-Beta-Durchläufe sind **automatisiert und verwenden künstliche Börsenantworten**, sofern nicht ausdrücklich anders angegeben. Sie sind kein Test durch menschliche Betatester.

| Bereich | Geprüft | Ergebnis |
|---|---|---|
| Signale | Bis zu zehn Karten; klare Angabe von Paar, Quelle, Risiko, Einstieg, Stop und Zielen; keine Karte ohne gültige Daten | Bestanden in den simulierten Szenarien |
| Nutzerpfad | Suche ohne Treffer, Filter zurücksetzen, Sortierung, Dossier öffnen und per Escape schließen, Datenschutzlink | In fünf Sprachen bestanden |
| Sprachen und Layout | Deutsch, Englisch, Spanisch, Arabisch und Chinesisch; 320, 375, 768, 1024 und 1440 CSS-Pixel; Prüfung wichtiger Bedienelemente auf Abschneiden | Bestanden nach Korrektur des Sortierfelds |
| Vergrößerung | 200 % per CSS-Zoom in Chromium simuliert | Wichtige geprüfte Bedienelemente erreichbar; kein Ersatz für echten Browser-Zoom |
| Fehlerfälle | Simulierte HTTP 451 und 429, Ausfall beider Quellen, ungültige Daten, Timeouts, verspätete Antworten und partielle Daten | Geeignete Alternativquelle oder leeres Board; keine Ersatzsignale |
| Null Treffer | Gültige Marktberechnung ohne bestandenen Qualitätsfilter | Leeres LIVE-Board statt Ausfallmeldung |
| Datenzuordnung | Ticker und Tageskerzen derselben Börse, ausgewiesene Binance-/Binance.US-Modellquelle | In simulierten Fallback-Szenarien bestanden |
| Rechnerische Stichprobe | Drei synthetische Paar-Historien: RSI, ATR, SMA200, risikoadjustiertes Momentum, Einstieg, Stop und erstes Ziel unabhängig nachgerechnet; Score-Summe und Gate-Grenzen auf Konsistenz geprüft | Bestanden. Die vollständige Score-Methodik und ADX wurden dabei nicht unabhängig nachimplementiert. |
| Automatische Barrierefreiheit | axe-core auf Startseite, Terminal und geöffnetem Dossier in fünf Sprachen; zusätzlich drei Farbschemata mit geöffneten Bereichen und Dossier | In diesen Zuständen keine gemeldeten Verstöße. Automatische Tests ersetzen keine manuelle oder assistive Prüfung. |
| Navigation ohne JavaScript | Generierte Sprachseiten, erreichbare Rechtslinks und ausklappbare Erklärungen | In den getesteten Fällen bestanden |
| Routing | Lokaler Server und Worker-Unit-Tests für Sprachrouten, Rechtsseiten und echte 404-Antworten | Bestanden; tatsächliches neues Cloudflare-Deployment nicht geprüft |

## Gefundene und lokal behobene Probleme

1. Bei 320 px konnte das Sortierfeld trotz unterdrücktem horizontalem Seitenüberlauf seitlich abgeschnitten werden. Flex-Verhalten und Größenbegrenzung wurden korrigiert; der Regressionstest prüft die tatsächlichen Elementgrenzen.
2. War Trendqualität der stärkste Modellfaktor, konnte statt einer Übersetzung `undefined` erscheinen. Alle fünf Übersetzungen und ein sicherer Fallback wurden ergänzt.
3. Der automatische Kontrasttest meldete zu geringe Kontraste bei den Links zu Anbieter und Datenschutz, der aktiven Sektorauswahl, einzelnen Grade- und Risikofarben sowie im hellen Farbschema. Die betroffenen Farben wurden angepasst; die getesteten Zustände bestehen anschließend den automatischen axe-Lauf. Die Überschriftenhierarchie der Karten wurde ebenfalls korrigiert.

## Echte Netz- und Produktionsprüfung

- Die **lokale** App wurde zusätzlich in Chromium ohne API-Mocks gestartet. Ihr Board blieb leer und zeigte fehlende Live-Daten. Alle 21 optionalen API-Stichproben scheiterten in dieser Umgebung mit Browser-Verbindungsfehlern ohne HTTP-Status; daraus lässt sich nicht ableiten, ob die Ursache Netzwerk, Browser, CORS, Region oder Anbieter ist.
- Der direkte Chromium-Aufruf der **veröffentlichten** Website scheiterte hier ebenfalls mit `net::ERR_CONNECTION_CLOSED`. Ein vollständiger produktiver Live-Durchlauf ist daher nicht bestätigt.
- Ein separater Seitenabruf über den Abrufdienst lieferte Inhalt von Startseite und Terminal, zeigte aber offenbar einen älteren Stand mit den früheren Formulierungen. Das ist kein Nachweis eines vollständigen Browser-Live-Abrufs und keine Prüfung des lokalen, unveröffentlichten Arbeitsstands.
- Es wurden keine realen Gate-Treffer oder drei realen Börsen-Snapshots unabhängig nachgerechnet. Es wurden keine echten Performance-Messungen unter Mobilfunk und keine API-Lasttests durchgeführt.

## Offene Prüfungen

1. Den lokalen Stand in einem anderen Netzwerk ohne Mocks ausführen: `npm run diagnose:live -- --probe`. Der Anschluss kontaktiert dabei echte Drittanbieter, die seine IP-Adresse sehen. Für die veröffentlichte Version: `npm run diagnose:live -- --url https://signalcraft.click/app --probe`.
2. Nach Verfügbarkeit mindestens drei **echte** Snapshots mit Rohdaten, Quellenzeit und Symbol sichern und unabhängig nachrechnen; dabei auch ADX, alle Score-Komponenten und Gate-Grenzen überprüfen.
3. Menschliche Beta-Durchläufe mit echten Geräten und Netzwerken; Firefox, Safari, echter Browser-Zoom, Screenreader, Tastatur und visuelle Kontrastprüfung sind noch nicht abgeschlossen.
4. Netzwerkvolumen, Antwortzeiten und Core Web Vitals unter kontrolliertem Mobilfunk messen. Die Vier-Sekunden-Wartefrist für Tickerquellen wurde nicht anhand realer Netzwerkmessungen optimiert.
5. Die Betreiber-/Datenschutzseiten sind lokal vorhanden, enthalten aber keine erfundene ladungsfähige Anschrift; die tatsächlichen Angaben bleiben zu vervollständigen. Es wurde keine rechtliche Prüfung durchgeführt.

**Wichtig:** Ein grüner automatischer Test belegt weder die ständige Verfügbarkeit externer APIs noch die Richtigkeit ihrer Quelldaten, Handelbarkeit, Gewinnchancen oder die vollständige Barrierefreiheit.
