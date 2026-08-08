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
