# Startgeld-Abrechnung und Lastschrift (Stufen 2 und 3)

Ausgelagert aus der CLAUDE.md; nur lesen, wenn das Thema die Aufgabe betrifft. Spec: `docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md`, Plan Stufe 3: `docs/superpowers/plans/2026-10-25-startgeld-lastschrift-stufe3.md` (Entscheidungen L1–L12). Betrieb/Schlüssel: `docs/betrieb.md`, Datenschutz: `docs/datenschutz/`.

## Tabellen
- **`vereins_abrechnung`** (Stufe 2): Stammdaten des Ausrichters je Verein, IBAN verschlüsselt; neu in Stufe 3: `glaeubiger_id` (Formatprüfung `src/shared/glaeubigerId.js`), `vorabankuendigung_tage` (Standard 5) und `mandat_zusatztext` (optionaler Zusatz des Ausrichters unter dem festen Mandatstext, höchstens 500 Zeichen; gilt nur für neu erteilte Mandate, Textversion dann `…+zusatz`). Gepflegt wird alles auf `verein-abrechnung.html` (Menüpunkt „Zahlungsdaten“, nur Cloud, nur Vereins-Admins).
- **`turnier_zahlwege`**: Zahlweg je Verein und Turnier (`ueberweisung`, `bar`, `lastschrift`); `mandat_gueltig` kennzeichnet ein gültiges Mandat (L3: `lastschrift` ist nur dann „gesichert“).
- **`lastschrift_mandate`**: Einmal-Mandat je Turnier und Verein (Status `unbestaetigt`, `gueltig`, `abgelehnt`, `widerrufen`, `umgestellt`), Kontoinhaber/IBAN nur als Chiffretext (`daten_verschluesselt`, `iban_maske`), Mandatstext samt `textversion`, Nachweis (`erteilt_am/_von`, `vertretung_bestaetigt`, `bestaetigt_am/_von`), `letzter_einzug_am`, `loeschen_ab`. Unique-Index auf aktive Mandate je Turnier und Verein.
- **`sepa_dateien`**: Kopfdaten erzeugter pain.008-Dateien (`msg_id`, `faelligkeit`, `anzahl`, `summe_cent`, `warnung`), nie der XML-Inhalt (enthält Klar-IBANs).
- **`rechnungen`** (neue Spalten): `mandat_id`, `mandatsreferenz`, `mandat_datum`, `iban_maske_zahler`, `einzug_am`, `sepa_datei_id`, `zurueckgebucht_am`; Status `zurueckgebucht` zusätzlich.

## Entscheidungen L1–L12 (Kurzform)
L1 `pain.008.001.08` (Konstante `PAIN008_VERSION`; Hausbank klären). L2 nur SEPA-Core, OOFF, Mandatsreferenz je Turnier/Verein. L3 gesichert nur mit gültigem Mandat. L4 Bestätigung: Admin des zahlenden Vereins sofort, sonst Einmal-Link (7 Tage, `mandat-bestaetigen.html`) an alle Admins. L5 Widerruf: bis Anmeldeschluss, gültige Mandate nur durch Admins. L6 Umstellung unbestätigter Mandate auf Bar am Anmeldeschluss (stündlicher `mandatJob` und vor jedem Turnier-Export), Erinnerung 3 Tage vorher. L7 Einzugsdatum = nächster TARGET2-Geschäftstag nach Rechnungsdatum + Vorabankündigungsfrist (`src/shared/targetKalender.js`). L8 Doppeleinzug-Schutz über `rechnungen.sepa_datei_id`. L9 Status `eingezogen` wird abgeleitet; Rücklastschrift → `zurueckgebucht` und Umstellung des Zahlwegs. L10 zum Hallen-Server reist nur `zahlweg` + `gesichert`, nie Mandat oder IBAN. L11 `ZAHLUNGSDATEN_SCHLUESSEL`, `_ALT` und `scripts/zahlungsdaten-schluessel.mjs`. L12 Löschung der Mandate 14 Monate nach dem letzten Einzug.

## Module
`src/services/`: `mandate.js` (Erteilen/Bestätigen/Widerrufen, Löschlauf), `mandatJob.js` (Umstellung, Erinnerung), `sepaExport.js` + `sepaDatei.js` (Auswahl, Prüfungen, pain.008-Erzeugung), `rechnungslauf.js`, `rechnungPdf.js`, `zahlwege.js`, `zahlwegTransfer.js`, `zahlungsdatenSchluessel.js`. `src/shared/`: `mandatText.js`, `sepaZeichen.js`, `glaeubigerId.js`, `targetKalender.js`. Routen: `mandatRoutes.js` (öffentlich, Token), `abrechnungRoutes.js` (inkl. SEPA-Download nur für Turnier-Admins mit 2FA-Code und Rücklastschrift). Seiten: `abrechnung.html`, `verein-abrechnung.html`, `mandat-bestaetigen.html`.

## Tests
`tests/unit/`: `mandate`, `mandatJob`, `mandatRoutes`, `mandatAufbewahrung`, `lastschriftAngebot`, `sepaGrundlagen`, `sepaDatei`, `sepaExport`, `ruecklastschrift`, `rechnungslauf`, `rechnungPdf`, `zahlweg*`, `feldVerschluesselung`, `rechtliches`.

## Offene Punkte
Rechtliche Prüfung von Mandatstext, Vorabankündigungsfrist und Online-Mandat; Hausbank-Test der pain.008-Version (nur ISO-Schema geprüft); keine Info-Mail an den Verein bei Rücklastschrift; Wiederholungsmandate, B2B und Bankdatei-Import sind nicht Teil von Stufe 3.
