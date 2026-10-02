# Third-Party-Daten

## src/config/plz_koordinaten.json

Geografische Mittelpunkt-Koordinaten deutscher Postleitzahlen, verwendet für die
Entfernungsberechnung in der Turnierübersicht (`src/utils/entfernungHelper.js`).

- Ursprungsdaten: [GeoNames](https://www.geonames.org/)
- Aufbereitung/Konvertierung: [zauberware/postal-codes-json-xml-csv](https://github.com/zauberware/postal-codes-json-xml-csv)
- Lizenz: [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/)
- Änderung durch dieses Projekt: aus der Original-CSV wurden nur `zipcode`, `latitude` und
  `longitude` übernommen; bei mehreren Orten je Postleitzahl wurde der Mittelwert aus
  Breiten-/Längengrad gebildet.

## public/fonts/schriften/

Die Schriften **Outfit** und **Plus Jakarta Sans** (variable Fonts, Teilmengen latin und latin-ext)
werden lokal ausgeliefert, damit das Frontend im Hallenbetrieb ohne Internetzugang vollständig
funktioniert (`public/css/schriften.css`).

- Quelle: npm-Pakete `@fontsource-variable/outfit` und `@fontsource-variable/plus-jakarta-sans`, Version 5.3.0
- Lizenz: [SIL Open Font License 1.1](https://openfontlicense.org/) — Lizenztexte in
  `public/fonts/schriften/LICENSE-Outfit.txt` und `LICENSE-PlusJakartaSans.txt`
- Änderung durch dieses Projekt: keine, die Dateien wurden unverändert übernommen
