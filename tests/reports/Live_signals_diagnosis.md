# Live-Daten und leeres Signalboard – systematische Prüfung

## Ausgangslage

Die vom Nutzer bereitgestellten Screenshots zeigen im Terminal einen LIVE-Snapshot vom 24. November 2026, 09:36:38 UTC, mit 118 von 120 ausgewerteten Paaren und null angezeigten Setups. Ein früherer Screenshot zeigt die Meldung, dass keines der ausgewerteten Paare die Qualitätsfilter erfüllt. Das belegt eine weitgehend funktionierende Datenverbindung für diesen Abruf, aber weder den konkreten Ausschlussgrund für jedes Paar noch die Fehlerfreiheit oder wirtschaftliche Wirksamkeit des Modells. Die Startseite zeigte einen statischen, missverständlichen Hinweis unter „Aktuelle Signale“.

## Änderungen

- Die Startseite bezeichnet den statischen Kasten als Hinweis auf das Terminal statt als aktuelle Signalliste.
- Das Terminal kann drei separate USDT-Marktpreise aus den bereits abgerufenen 24h-Tickern anzeigen, wenn deren Preis und Ticker valide und frisch sind. Sie sind ausdrücklich keine Signale. Pro Zeile stehen Quelle und UTC-Frischeanker. Sie funktionieren unabhängig von einem erfolgreichen Kerzen-/Signalabruf und führen nicht zu zusätzlichen API-Abfragen.
- Die Preise sind weder ausführbare Angebote noch ein Nachweis für einen kürzlich erfolgten Handel. Das Fensterende eines Tickers ist nicht der Zeitpunkt des letzten Trades. Alte, fehlende und ungültige Werte werden nicht absichtlich angezeigt. Bei gedrosselten Browser-Timern kann das Ausblenden verzögert werden; bei erneut sichtbarem Tab wird die Frische geprüft.
- Die aufklappbare Signalauswahl zeigt höchsten Score und Zahl der Ausschlüsse pro Bedingung. Ein Paar kann mehrere Bedingungen verfehlen. Die Daten beziehen sich nur auf tatsächlich ausgewertete Paare.
- Das Diagnosetool gibt diese aggregierte Filterdiagnose und die Anzahl angezeigter Marktpreise ohne einzelne Preisdaten aus.
- Das Long-Gate und seine Schwellen sind unverändert; ein leeres Board bleibt möglich. Das relative Volumen und damit der Live-Score wurden später angepasst (siehe unten). Es gibt keine Demodaten, keine garantierte Signalanzahl und keine belegte Strategieperformance.

## Tests

- Unit: 441/441 bestanden.
- Browser-E2E: 354/354 bestanden. Neu: null Gate-Treffer mit sichtbaren Preisen, korrekte Quellen, ungültige Preise, Ausfall der Kerzen bei weiterhin verfügbaren Tickern, kompletter Ausfall, Ablauf, fünf Sprachen, mobile Breite, Signal-Karten mit synthetischen Eingangsdaten, 24h-Volumenfaktor und ausgewählter axe-core-Check.
- Prerender-Check, synthetischer Backtest-Selbsttest und `git diff --check` bestanden. `npm audit`: keine gemeldeten Schwachstellen.
- Die neuen Browser-Szenarien verwenden simulierte Börsenantworten; sie sind kein Nachweis echter Handelsgelegenheiten. Der Backtest-Selbsttest prüft nur Determinismus synthetischer Daten.
- Direkte Abrufe einzelner Binance-Ticker und weniger BTC-Tageskerzen über das Seitenabrufwerkzeug lieferten Daten; dies beweist weder Browser-CORS noch ein korrektes vollständiges 120-Paar-Signalranking. Der ungemockte Produktionsbrowser in der Sandbox scheiterte erneut mit `net::ERR_CONNECTION_CLOSED`.

## Ergänzende Stichprobe: Long-Momentum

Für drei USDT-Paare wurden je 32 Binance-Vision-Tages-Schlusswerte über das Seitenabrufwerkzeug stichprobenartig abgerufen; die letzte Kerze war noch nicht abgeschlossen. Das ist eine separate spätere Stichprobe, nicht der ursprüngliche 118-Paare-Snapshot. Bei diesen Werten ergeben sich folgende 30-Tage-Veränderungen und die mit einer unabhängigen Referenz nachgerechneten risikoadjustierten Momentumwerte:

| Paar | 30-Tage-Veränderung | Risikoadjustiertes Momentum |
| --- | ---: | ---: |
| BTC/USDT | −25,12 % | −1,92405 |
| ETH/USDT | −27,57 % | −1,51131 |
| SOL/USDT | −30,18 % | −1,70310 |

Die produktive Modellfunktion und die unabhängige Referenz stimmen für diese drei Reihen überein. Die Modellprüfung schließt jeden dieser drei Kandidaten bei negativem Momentum aus, selbst wenn alle übrigen Gatewerte erfüllt wären. Die Daten sind eine Momentaufnahme; die laufende Tageskerze ändert sich. Die Untersuchung belegt weder, warum alle 118 Paare ausgeschlossen wurden, noch die vollständige Korrektheit von Score, ADX oder weiteren Modellteilen. Die 32 Schlusswerte pro Paar liegen ausschließlich als historische Regressionstestdaten in `tests/step97-real-momentum-sample.test.mjs`, nicht in der öffentlichen Seite. Die Benutzeroberfläche weist nun darauf hin, dass nur Kauf-/Long-Setups berechnet werden; Short-Setups sind nicht implementiert.

## Untersuchung und Anpassung des relativen Volumens

Zuvor wurde das Volumen der unvollständigen UTC-Tageskerze mit dem Durchschnitt 30 vollständig abgeschlossener Tage verglichen. Dieser bewusst dokumentierte Modellansatz ist tageszeitabhängig: Nach UTC-Mitternacht ist der Zähler typischerweise sehr kurz, während die Vergleichstage jeweils 24 Stunden umfassen. Der Quotient floss sowohl in den Volumenfaktor des Quant-Scores als auch in den modellierten Kaufdruck ein.

Lokal wird nun für beide Berechnungen das bereits validierte rollierende 24h-USDT-Volumen desselben Handelsplatzes durch das mittlere Volumen der letzten 30 abgeschlossenen Tageskerzen geteilt. Die beiden Zeitfenster können sich überlappen; das ist kein identischer Vergleich rollierender historischer 24h-Fenster. Weitere Faktoren verwenden weiterhin die laufende Tageskerze, und die Änderung beseitigt nicht jede Tageszeitabhängigkeit. Die Modellversion wurde von 3 auf 4 erhöht; alte Signale werden weder übernommen noch als neue berechnet. Bei ungültiger oder numerisch nicht darstellbarer Division wird der betreffende Kandidat verworfen und die gültige Alternativquelle versucht.

Bei synthetischer Teil-Tageskerze führte ein Verhältnis von 1,25 zu vier Volumenpunkten mehr als die alte Teil-Tages-Berechnung; andere Score-Komponenten blieben in diesem Vergleich identisch. Historische Forschung mit abgeschlossenen Tageskerzen bleibt rechnerisch unverändert. Die Änderung kann Scores, Rangfolge und Gate-Treffer erhöhen oder senken; sie ist weder ein Beleg für höhere Signalqualität noch eine Garantie für Signale. Reale Intraday-Replays, robuste historische Vergleiche und ein unabhängiger Out-of-sample-Test stehen aus. In der Binance-Stichprobe bleibt das negative Momentum der drei geprüften Coins ein eigener Ausschlussgrund.

## Offene Prüfungen

Auf einem echten Client die lokale Vorschau laden, unter „Wie werden Signale ausgewählt?“ die tatsächlichen Ausschlusszahlen prüfen und frische Kurs-/Quellangaben mit der Börse abgleichen. Erst danach Modell, numerische Berechnung und sinnvolle Schwellen anhand echter historischer Daten und getrennten Testzeiträumen untersuchen; nicht allein für ein gefülltes Board Grenzen senken. Produktionsdeployment und vollständiger Echt-Browser-Nachweis sind noch nicht erfolgt.
