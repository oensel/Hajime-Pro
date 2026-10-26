# Startgeld-Lastschrift (Stufe 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein meldender Verein kann das Startgeld per SEPA-Basislastschrift zahlen: Er erteilt bei der Anmeldung ein Einmal-Mandat, ein Admin seines Vereins bestätigt es; der Ausrichter erstellt nach dem Turnier die Rechnungen (sie sind zugleich Vorabankündigung) und lädt eine pain.008-Sammeldatei für sein Online-Banking herunter.

**Architecture:** Neue Tabelle `lastschrift_mandate` (je Turnier und Verein höchstens ein aktives Mandat; IBAN, Kontoinhaber und IP als ein AES-GCM-Chiffretext über `verschluesseleFeld` aus Stufe 2), Spalte `turnier_zahlwege.mandat_gueltig` als abgeleiteter Merker für die Kampfbereitschaft, Bestätigung über `token_einmal` (neuer Zweck `mandat`), ein stündlicher Job für die Umstellung unbestätigter Mandate auf Bar am Anmeldeschluss, reine Module für Gläubiger-ID, SEPA-Zeichensatz, TARGET-Kalender, Mandatstext und den pain.008-Generator; Download über `/api/abrechnung/:turnierId/sepa` mit Merker gegen Doppeleinzug.

**Tech Stack:** Node/Express (ES-Module), Knex/PostgreSQL, Vanilla-JS, `node:test`, Playwright; kein XML-Paket (der Generator baut das XML selbst mit Maskierung).

**Spec:** `docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md` (Stufe 3, Festlegungen 3, 6, 7, 10; Abschnitt „Stand nach Stufe 1 / Abweichungen“). **Setzt Stufe 2 voraus:** `docs/superpowers/plans/2026-10-25-startgeld-rechnungen-stufe2.md`. Genutzte Stufe-2-Interfaces (Namen exakt so): Task 1 (`pruefeIban`, `maskiereIban`, `normalisiereIban`, `verschluesseleFeld`, `entschluesseleFeld`, `schluesselVorhanden`, `IBAN_MUSTER`), Task 2 (`fehlendeStammdaten`, `rechnungsAnzeigeStatus`, `addiereTage`, `heuteBerlin`, `baueVerwendungszweck`), Task 3 (Tabelle `vereins_abrechnung`, `ladeStammdaten`, `speichereStammdaten`, `ermittleZahlungsempfaenger`, `requireTurnierAdmin`), Task 6 (`pruefeSensibleAktion`), Task 8 (`ladeAbrechnung`, `VereinsZeile`), Task 9 (`RechnungsDaten`, `baueRechnungsZeilen`, `erzeugeRechnungPdf`), Task 10 (`sendeMail` mit Anhängen, `erstelleRechnungen`, Tabelle `rechnungen` mit Partial-Unique-Index `WHERE status <> 'zurueckgebucht'`).

## Entscheidungen des Planers
- **L1 pain.008-Version:** `pain.008.001.08` (Namespace `urn:iso:std:iso:20022:tech:xsd:pain.008.001.08`, DK-Anlage 3 ab Version 3.7). Stand der Recherche (Oktober 2026): Die deutschen Banken haben die Pflichtumstellung von November 2025 auf November 2026 verschoben; `pain.008.001.02` gilt bis dahin noch, danach Migrationsstopp. **Vor dem ersten produktiven Einsatz mit der Hausbank des Ausrichters prüfen** (u. a. Pflicht von `DbtrAgt`/BIC, strukturierte Adressen). Die Version steht als Konstante `PAIN008_VERSION` an einer Stelle.
- **L2 Mandat:** nur SEPA-Core (`LclInstrm CORE`), Einmal-Mandat (`SeqTp OOFF`), je Turnier und Verein; Mandatsreferenz `<Rechnungspräfix ohne Bindestrich>M<turnierId>V<zahlwegId>` auf 35 Zeichen und den SEPA-Zeichensatz gekürzt, eindeutig per Unique-Index.
- **L3 Gesichert:** `lastschrift` gilt als gesichert nur mit `turnier_zahlwege.mandat_gueltig = true` (Mandat `gueltig`); `istZahlwegGesichert` wertet beides aus.
- **L4 Bestätigung:** Ersteller mit Rolle `admin` des zahlenden Vereins → sofort `gueltig`. Sonst ein Token je Admin (bestätigt, freigegeben, nicht gesperrt) mit `zweck 'mandat'`, `bezug = <mandatId>`, 168 Stunden; die Seite `mandat-bestaetigen.html?token=` ist wie `freigabe.html` öffentlich (Token genügt), zeigt Mandat (IBAN maskiert) und verlangt das Häkchen „Ich bin berechtigt, den Verein zu vertreten“. Die erste Entscheidung verbraucht alle Tokens dieses Mandats. „Ablehnen“ löscht die IBAN, Status `abgelehnt`, der Verein muss neu wählen (bis zum Anmeldeschluss, sonst Bar).
- **L5 Widerruf:** Wechsel weg von Lastschrift ist bis zum Anmeldeschluss für Rolle `benutzer` möglich, solange das Mandat `unbestaetigt` oder `abgelehnt` ist; ein `gueltiges` Mandat widerruft nur ein Admin des zahlenden Vereins (Spec, Berechtigungen). Widerruf löscht den Chiffretext (IBAN), Status `widerrufen`, Datensatz bleibt als Nachweis bis `loeschen_ab`.
- **L6 Umstellung am Anmeldeschluss:** stündlicher Job und zusätzlich unmittelbar vor jedem Turnier-Export (Holen auf den Hallen-Server): unbestätigte Mandate → Status `umgestellt`, IBAN gelöscht, Zahlweg `bar`, Mail an Rechnungs-E-Mail und Admins des zahlenden Vereins. Erinnerung einmalig 3 Tage vor dem Anmeldeschluss.
- **L7 Fälligkeit:** Einzugsdatum der Rechnung = `fruehestesFaelligkeitsdatum(rechnungsdatum, vorabankuendigung_tage, heute)` = nächster TARGET2-Geschäftstag ab `max(rechnungsdatum + Vorabankündigungsfrist, heute + 1 Geschäftstag)`. Die Rechnung ist die Vorabankündigung. Wird die Datei später erzeugt, nimmt sie `max(einzug_am, nächster Geschäftstag nach heute)` und warnt.
- **L8 Doppeleinzug:** `rechnungen.sepa_datei_id` wird beim Erzeugen gesetzt; ohne `neu: true` + ausdrückliche `rechnungIds` enthält eine Datei nur Rechnungen ohne `sepa_datei_id`. Der XML-Inhalt wird nicht gespeichert (enthält Klar-IBANs), nur die Kopfdaten in `sepa_dateien`.
- **L9 Status:** Lastschrift-Rechnungen werden `versandt`; mit Datei und erreichtem Einzugsdatum zeigt `rechnungsAnzeigeStatus` `eingezogen` (abgeleitet). Rücklastschrift → gespeicherter Status `zurueckgebucht`, Zahlweg des Vereins wird auf `ueberweisung` oder `bar` umgestellt (Ausrichter-Admin, auch nach Anmeldeschluss, protokolliert); der nächste Rechnungslauf erstellt die neue Rechnung mit neuer Nummer.
- **L10 Transfer:** zum Hallen-Server reist für Lastschrift-Vereine nur `zahlweg: 'lastschrift'` + `gesichert: boolean` (plus die Rechnungsangaben wie in Stufe 1), nie Mandat oder IBAN. Beim Rückspielen gilt weiter: bestehende Zahlweg-Zeilen der Cloud bleiben unberührt.
- **L11 Schlüssel:** weiter `ZAHLUNGSDATEN_SCHLUESSEL`; neu `ZAHLUNGSDATEN_SCHLUESSEL_ALT` (nur Entschlüsseln, erkannt über die `kid` im Chiffretext) und das Skript `scripts/zahlungsdaten-schluessel.mjs` (`pruefen` | `umschluesseln --ja`). Lastschrift wird nur angeboten, wenn `schluesselVorhanden()`.
- **L12 Aufbewahrung:** `loeschen_ab` = letzter Einzug + 14 Monate; ohne Einzug (widerrufen, abgelehnt, umgestellt) = Statusdatum + 14 Monate. Täglicher Lauf löscht Mandate ab `loeschen_ab` vollständig; Rechnungen behalten Mandatsreferenz und maskierte IBAN als Kopie.

## Global Constraints
- Lastschrift nur wenn: Turnier bietet `lastschrift` an, Stammdaten vollständig (`fehlendeStammdaten` leer) **und** Gläubiger-ID gültig **und** Zahlungsempfänger lesbar **und** `schluesselVorhanden()`; sonst fehlt `lastschrift` in `angebotene` und `PUT` mit Lastschrift antwortet 400.
- Mandatsangaben: IBAN (`pruefeIban`), Kontoinhaber (Pflicht, ≤ 70), Zustimmung `zustimmung: true`, `vertretung_bestaetigt: true`; gespeichert: Zeitstempel, Benutzer-ID, IP (`req.ip`), Textversion `MANDATSTEXT_VERSION` und der vollständige Mandatstext.
- Vorabankündigungsfrist je Turnier `vorabankuendigung_tage`, ganze Zahl 1–14, Standard 5 (Festlegung 6).
- SEPA-Zeichensatz: `a-z A-Z 0-9 / - ? : ( ) . , ' +` und Leerzeichen; Umlaute transliteriert (`ä→ae`, `ö→oe`, `ü→ue`, `ß→ss`, `Ä→Ae`, `Ö→Oe`, `Ü→Ue`), `&→+`, alle übrigen Zeichen → Leerzeichen, Mehrfach-Leerzeichen zusammengefasst; Namen ≤ 70, `Ustrd` ≤ 140, `MndtId`/`EndToEndId`/`PmtInfId`/`MsgId` ≤ 35 ohne Leerzeichen.
- SEPA-Datei, Mandatsliste mit Klar-IBAN: nur Admin des Ausrichters bzw. Super-Admin im Modus; Super-Admins immer mit `X-2FA-Code` (`pruefeSensibleAktion` mit `frischeAnmeldungGenuegt: false`); jeder Download im Aktionsprotokoll (ohne IBAN, mit Anzahl und Summe in `details`).
- IBAN des Zahlers nie in Protokoll, Konsole, Fehlermeldungen, API-Antworten (nur `maskiereIban`), Mails (nur maskiert) oder Exporten.
- Mitglieder sehen weder Zahlweg noch Betrag fremder Vereine (unverändert aus Stufe 1).
- Code im Stil der Umgebung; deutsche Texte; Zeiten Europe/Berlin.

## Review Focus
1. Nicht-Admin erteilt ein Mandat mit fremder IBAN und niemand bestätigt: Kämpfer bleiben nicht kampfbereit über Lastschrift, am Anmeldeschluss Umstellung auf Bar mit Mail, die IBAN ist danach in keiner Spalte mehr vorhanden. (Task 3 und 6)
2. SEPA-Datei zweimal erzeugt: zweiter Aufruf ohne `neu` → 409 „Für alle Lastschriften gibt es schon eine Datei.“; mit `neu` nur die ausdrücklich genannten Rechnungen. (Task 9)
3. Vereinsnamen/Verwendungszwecke mit `&`, `<`, Umlauten, Emojis oder 200 Zeichen: gültiges XML, Zeichensatzregeln eingehalten, Längen gekürzt. (Task 8)
4. Einzugsdatum fällt auf Wochenende/Feiertag (Karfreitag, 1. Mai, 25./26.12., 1.1.) oder die Datei wird nach dem angekündigten Datum erzeugt: nächster TARGET-Geschäftstag, nie in der Vergangenheit. (Task 1 und 9)
5. Admin wechselt nach bestätigtem Mandat auf Überweisung, während eine Bestätigungsmail eines anderen Admins noch offen ist: der alte Link antwortet 410, das widerrufene Mandat wird nicht wieder gültig. (Task 3)

---

## Datei-Übersicht
- Create `migrations/20261103100000_startgeld_lastschrift.js`.
- Create `src/shared/glaeubigerId.js`, `src/shared/sepaZeichen.js`, `src/shared/targetKalender.js`, `src/shared/mandatText.js`.
- Create `src/services/mandate.js`, `src/services/mandatJob.js`, `src/services/sepaDatei.js`, `src/services/sepaExport.js`.
- Create `src/controllers/mandatController.js`, `src/routes/mandatRoutes.js`, `public/mandat-bestaetigen.html`, `public/js/mandatBestaetigen.js`, `scripts/zahlungsdaten-schluessel.mjs`.
- Modify `src/shared/zahlweg.js`, `src/shared/abrechnung.js`, `src/services/zahlwege.js`, `src/services/zahlwegTransfer.js`, `src/services/einmalToken.js`, `src/services/abrechnungStammdaten.js`, `src/services/rechnungslauf.js`, `src/services/rechnungPdf.js`, `src/services/abrechnung.js`, `src/utils/feldVerschluesselung.js`, `src/controllers/zahlwegController.js`, `src/controllers/turnierController.js`, `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`, `src/services/aktionsProtokoll.js`, `src/app.js`, `public/js/zahlwegDialog.js`, `public/js/vereinAbrechnung.js`, `public/turnier.html`, `public/js/turnier.js`, `public/js/abrechnung.js`, `src/services/rechtstexte.js`, `docs/datenschutz/*`, `docs/betrieb.md`, `CLAUDE.md`.

---

### Task 1: Reine Module (Gläubiger-ID, Zeichensatz, TARGET-Kalender, Mandatstext)

**Files:**
- Create: `src/shared/glaeubigerId.js`, `src/shared/sepaZeichen.js`, `src/shared/targetKalender.js`, `src/shared/mandatText.js`
- Test: `tests/unit/sepaGrundlagen.test.js`

**Interfaces:**
- Produces:
  - `pruefeGlaeubigerId(text): { ok: boolean, wert: string|null, fehler: string|null }` — Großbuchstaben ohne Leerzeichen; Aufbau Land (2 Buchstaben) + Prüfziffern (2) + Geschäftsbereichskennung (3 alphanumerisch, für die Prüfung ignoriert) + nationale Kennung; DE genau 18 Zeichen, sonst 8–35; Prüfziffern: nationale Kennung + Land + `00`, Buchstaben A=10 … Z=35, `98 − (Zahl mod 97)`, zweistellig
  - `sepaText(text, maxLaenge): string` (Regeln aus Global Constraints, getrimmt, gekürzt) und `sepaKennung(text, maxLaenge = 35): string` (zusätzlich ohne Leerzeichen)
  - `istTargetGeschaeftstag(isoDatum): boolean` (nicht Sa/So, 1.1., Karfreitag, Ostermontag, 1.5., 25.12., 26.12.; Ostern per Gauß/Anonymous-Gregorian-Algorithmus)
  - `naechsterGeschaeftstag(isoDatum): string` (das Datum selbst, wenn Geschäftstag)
  - `addiereGeschaeftstage(isoDatum, n): string`
  - `fruehestesFaelligkeitsdatum(rechnungsdatum, vorabTage, heute): string` (L7)
  - `MANDATSTEXT_VERSION = '2026-11-v1'` und `baueMandatstext({ glaeubigerName, glaeubigerId, mandatsreferenz, vorabTage, turnierBezeichnung, zahlenderVerein }): string` — Inhalt: Überschrift „SEPA-Lastschriftmandat (einmalige Zahlung)“, Gläubiger mit Gläubiger-ID, Mandatsreferenz, Ermächtigung des Gläubigers zum Einzug und Weisung an das Kreditinstitut (übliche deutsche Standardformulierung „Wir ermächtigen … Zahlungen von unserem Konto mittels Lastschrift einzuziehen. Zugleich weisen wir unser Kreditinstitut an, die … gezogenen Lastschriften einzulösen.“), Hinweis „Wir können innerhalb von acht Wochen, beginnend mit dem Belastungsdatum, die Erstattung des belasteten Betrages verlangen. Es gelten dabei die mit unserem Kreditinstitut vereinbarten Bedingungen.“, Zweck „Startgeld <Turnier>“, Vorabankündigung „spätestens <n> Tage vor Fälligkeit per E-Mail (Rechnung)“. Rechtlich zu prüfen (Spec), deshalb versioniert.
- [ ] **Step 1: Failing tests:** `pruefeGlaeubigerId('DE98ZZZ09999999999').ok === true` (Testnummer der Bundesbank), `'DE99ZZZ09999999999'` falsch, `'de98 zzz0 9999 9999 99'` normalisiert gültig, `'DE98ZZZ0999'` Längenfehler; `sepaText('Jürgen & Söhne <GmbH> 😀', 70) === 'Juergen + Soehne GmbH'`; `sepaKennung('JCK M12 V3')` ohne Leerzeichen; `istTargetGeschaeftstag('2027-03-26')` (Karfreitag 2027) false, `'2027-03-29'` (Ostermontag) false, `'2027-03-30'` true, `'2026-12-26'` false; `naechsterGeschaeftstag('2026-12-24')` → `'2026-12-24'`, `('2026-12-25')` → `'2026-12-28'`; `fruehestesFaelligkeitsdatum('2026-11-20', 5, '2026-11-20') === '2026-11-25'`, mit Rechnungsdatum in der Vergangenheit (`'2026-11-01'`, heute `'2026-11-20'`) → `'2026-11-23'`; Mandatstext enthält Gläubiger-ID, Mandatsreferenz, „acht Wochen“ und „5 Tage“.
- [ ] **Step 2:** `node --test tests/unit/sepaGrundlagen.test.js` → FAIL.
- [ ] **Step 3: Implement** (framework-frei).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Gläubiger-ID, SEPA-Zeichensatz, TARGET-Kalender, Mandatstext"`

### Task 2: Migration, Gläubiger-ID in den Stammdaten, Turnierfeld und Angebot

**Files:**
- Create: `migrations/20261103100000_startgeld_lastschrift.js`
- Modify: `src/services/abrechnungStammdaten.js` (Feld `glaeubiger_id` mit `pruefeGlaeubigerId`; neue Funktion), `src/shared/abrechnung.js` (`fehlendeStammdaten` unverändert; neu `lastschriftMoeglich`), `src/shared/zahlweg.js`, `src/controllers/turnierController.js` (`leseZahlwegFelder`: `lastschrift` ankreuzbar; `vorabankuendigung_tage` in Anlegen/Ändern/Export/Import/Duplizieren und `TURNIER_SPALTEN_OHNE_PDF`), `src/controllers/zahlwegController.js` (`angebotenInStufe1` ersetzen durch `ermittleAngeboteneZahlwege`), `src/services/zahlwege.js` (`speichereZahlweg`: Angebotsprüfung über dieselbe Funktion), `public/js/vereinAbrechnung.js` (Feld Gläubiger-ID), `public/turnier.html` + `public/js/turnier.js` (Kästchen „Lastschrift“, deaktiviert mit Grund, solange `lastschriftMoeglich` nein; Feld „Vorabankündigung (Tage)“)
- Test: `tests/unit/lastschriftAngebot.test.js` (Cloud-Modus), `tests/unit/zahlweg.test.js` (erweitern)

**Interfaces:**
- Schema:
  - `vereins_abrechnung.glaeubiger_id string(35) null`
  - `turniere.vorabankuendigung_tage integer not null default 5`
  - `turnier_zahlwege.mandat_gueltig boolean not null default false`
  - `lastschrift_mandate(id, turnier_id → turniere ON DELETE SET NULL, turnier_bezeichnung string, zahlweg_id → turnier_zahlwege ON DELETE SET NULL, verein_name string not null, zahlender_verein_id → vereine ON DELETE SET NULL, mandatsreferenz string(35) not null unique, daten_verschluesselt text null, iban_maske string, mandatstext text not null, textversion string not null, glaeubiger_id string not null, glaeubiger_name string not null, status string not null, erteilt_am timestamptz not null, erteilt_von string not null, vertretung_bestaetigt boolean not null, bestaetigt_am timestamptz, bestaetigt_von string, entschieden_am timestamptz, erinnert_am timestamptz, letzter_einzug_am date, loeschen_ab date, created_at, updated_at)`; Partial-Unique-Index auf `(turnier_id, verein_name) WHERE status IN ('unbestaetigt','gueltig')`; Status-Werte `unbestaetigt` | `gueltig` | `abgelehnt` | `widerrufen` | `umgestellt`
  - `token_einmal.bezug string null`
  - `sepa_dateien(id, turnier_id → turniere ON DELETE SET NULL, msg_id string(35) unique, erzeugt_am timestamptz default now(), erzeugt_von string, faelligkeit date, anzahl integer, summe_cent integer)`
  - `rechnungen`: `mandat_id → lastschrift_mandate ON DELETE SET NULL`, `mandatsreferenz string(35)`, `mandat_datum date`, `iban_maske_zahler string`, `einzug_am date`, `sepa_datei_id → sepa_dateien ON DELETE SET NULL`, `zurueckgebucht_am timestamptz`
- Produces:
  - `lastschriftMoeglich({ stammdaten, turnier, empfaengerLesbar: boolean, schluessel: boolean }): { moeglich: boolean, grund: string|null }` (`src/shared/abrechnung.js`; Gründe: „Gläubiger-ID fehlt“, „Abrechnungsdaten unvollständig“, „Konto des Ausrichters nicht lesbar“, „Schlüssel für Zahlungsdaten fehlt“)
  - `istZahlwegGesichert(zeile)` (geändert): `ueberweisung` → true; `lastschrift` → `zeile.mandat_gueltig === true`; sonst false
  - `ermittleAngeboteneZahlwege(knex, turnier): Promise<string[]>` (`zahlwege.js`) — `parseAngeboteneZahlwege` und `lastschrift` nur bei `lastschriftMoeglich`; leere Liste → `['ueberweisung','bar']`
  - `ladeLastschriftStatus(knex, turnier): Promise<{ moeglich, grund }>` (`abrechnungStammdaten.js`) und `GET /api/abrechnung/stammdaten-pruefung/:turnierId` liefert zusätzlich `lastschrift: { moeglich, grund }`
- [ ] **Step 1: Failing tests:** Stammdaten mit ungültiger Gläubiger-ID → 400; Turnier mit `angebotene_zahlwege = 'ueberweisung,bar,lastschrift'`: ohne Gläubiger-ID liefert `GET /api/zahlweg/:id` `angebotene` ohne `lastschrift`, mit gültiger ID und Schlüssel mit; ohne `ZAHLUNGSDATEN_SCHLUESSEL` wieder ohne; `istZahlwegGesichert({zahlweg:'lastschrift', mandat_gueltig:false})` false, mit true true; `vorabankuendigung_tage: 20` → 400, ohne Angabe 5; Migration `latest`/`rollback`/`latest` läuft.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.** `synchronisiereGesichert` braucht keine Änderung (liest die Zeilen samt `mandat_gueltig`).
- [ ] **Step 4:** `node --test tests/unit/` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Schema, Gläubiger-ID und Angebot nur bei vollständigen Stammdaten"`

### Task 3: Mandats-Service (erteilen, bestätigen, ablehnen, widerrufen)

**Files:**
- Create: `src/services/mandate.js`
- Modify: `src/services/einmalToken.js` (`ZWECKE` um `'mandat'`; `erzeugeToken` nimmt `bezug = null`; `SPALTEN` um `bezug`; neue Funktion), `src/services/zahlwege.js` (`speichereZahlweg` delegiert bei `lastschrift` an `erteileMandat`, beim Wechsel weg an `widerrufeMandat`)
- Test: `tests/unit/mandate.test.js` (`starteTestPostgres`, `setzeTestVersand`)

**Interfaces:**
- Consumes: `pruefeIban`, `maskiereIban`, `verschluesseleFeld` (Stufe 2 Task 1), `baueMandatstext`, `MANDATSTEXT_VERSION`, `sepaKennung` (Task 1), `ladeStammdaten` (Stufe 2 Task 3), `synchronisiereGesichert` (Stufe 1), `sendeMail`, `ermittleBasisUrl(req)` aus `src/utils/basisUrl.js` (im Controller; Jobs nutzen `normalisiereBasisUrl(process.env.PUBLIC_BASE_URL)` wie `startOrgaErinnerung`).
- Produces:
  - `erteileMandat(knex, { turnier, zahlwegZeile, eingabe: { iban, kontoinhaber, zustimmung, vertretung_bestaetigt }, benutzer: { id, istAdminDesVereins: boolean }, ip, basisUrl, sende }): Promise<{ mandat: MandatOeffentlich, bestaetigungNoetig: boolean }>` — prüft Eingabe (400), widerruft ein vorhandenes aktives Mandat desselben Vereins, legt das neue an (`daten_verschluesselt = verschluesseleFeld(JSON.stringify({ iban, kontoinhaber, ip }))`), setzt bei Admin `gueltig` + `bestaetigt_*`, sonst `unbestaetigt` und je Admin ein Token (`zweck 'mandat'`, `bezug`, `gueltigStunden: 168`) mit Mail „Bitte bestätigen Sie das SEPA-Lastschriftmandat …“ (Link `<basis>/mandat-bestaetigen.html?token=…`, IBAN nur maskiert); setzt `turnier_zahlwege.mandat_gueltig` und ruft `synchronisiereGesichert`
  - `MandatOeffentlich = { id, mandatsreferenz, status, iban_maske, kontoinhaber_maske, erteilt_am, bestaetigt_am, textversion }` (`kontoinhaber_maske` = erste 2 Zeichen + `…`)
  - `ladeMandatFuerToken(knex, token): Promise<{ mandat: MandatOeffentlich, mandatstext, vereinName, turnierBezeichnung } | null>` (über `pruefeToken(knex, token, 'mandat')`)
  - `entscheideMandat(knex, token, { entscheidung: 'bestaetigen'|'ablehnen', vertretung_bestaetigt: boolean }): Promise<MandatOeffentlich>` — `verbrauchePruefe`; nur `unbestaetigt` entscheidbar (sonst `FachFehler(410, 'Über dieses Mandat wurde schon entschieden oder es wurde zurückgezogen.')`); verbraucht alle übrigen Tokens desselben `bezug` (`verbraucheAlleZuBezug(knex, 'mandat', bezug)` in `einmalToken.js`); `ablehnen` löscht `daten_verschluesselt`, setzt `loeschen_ab`
  - `widerrufeMandat(knex, { turnierId, vereinName, benutzer: { id, istAdminDesVereins }, grund: 'wechsel'|'umstellung'|'ruecklastschrift' }): Promise<boolean>` — L5-Regel (403 „Ein bestätigtes Lastschriftmandat kann nur ein Admin des Vereins widerrufen.“), löscht Chiffretext, Status `widerrufen` bzw. `umgestellt`, `loeschen_ab`, offene Tokens verbrauchen, `mandat_gueltig = false`
  - `ladeMandatIban(knex, mandatId): Promise<{ iban, kontoinhaber }>` — nur für die SEPA-Datei (Task 9)
  - `berechneLoeschenAb(isoDatum): string` (+14 Monate)
- [ ] **Step 1: Failing tests:** Benutzer (Rolle `benutzer`) erteilt Mandat → `unbestaetigt`, zwei Admins bekommen je eine Mail mit unterschiedlichem Link und maskierter IBAN, die Klar-IBAN steht in keiner Mail und in keiner Spalte außer verschlüsselt; Zahlweg-Zeile `mandat_gueltig` false; Bestätigen mit Token von Admin 1 → `gueltig`, `mandat_gueltig` true, Kämpfer `startgeld_zahlweg_gesichert` true; Token von Admin 2 danach → 410; ohne `vertretung_bestaetigt` → 400; Admin erteilt → sofort `gueltig`, keine Mail; ungültige IBAN → 400; Wechsel auf Überweisung durch Benutzer bei gültigem Mandat → 403, durch Admin → Mandat `widerrufen`, `daten_verschluesselt` null, Zahlweg `ueberweisung`; offener Token nach Widerruf → 410; Ablehnen → `abgelehnt`, Chiffretext null; zweites Erteilen ersetzt das erste (genau ein aktives Mandat).
- [ ] **Step 2:** `node --test tests/unit/mandate.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS; `node --test tests/unit/einmalToken.test.js tests/unit/zahlwegeService.test.js` (vorhandene) → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Mandat erteilen, bestätigen, ablehnen, widerrufen"`

### Task 4: API und Oberfläche für Mandat und Bestätigung

**Files:**
- Create: `src/controllers/mandatController.js`, `src/routes/mandatRoutes.js`, `public/mandat-bestaetigen.html`, `public/js/mandatBestaetigen.js`
- Modify: `src/app.js` (`app.use('/api/mandat', getMandatRoutes(knex))` ohne `requireWriteAuth`, mit `erzeugeApiRatenbegrenzung()`, nur Cloud), `src/controllers/zahlwegController.js` (`lese` liefert `mandat: MandatOeffentlich|null`, `mandatsvorschau: { mandatstext, glaeubigerId, glaeubigerName, vorabTage, mandatsreferenzMuster }` wenn Lastschrift angeboten; `speichere` reicht `iban`, `kontoinhaber`, `zustimmung`, `vertretung_bestaetigt`, `req.ip` und `istAdminDesVereins` durch; Antwort mit `bestaetigungNoetig`), `public/js/zahlwegDialog.js` (Lastschrift-Formular), `src/services/aktionsProtokoll.js`
- Test: `tests/unit/mandatRoutes.test.js` (Cloud-Modus), `tests/unit/zahlwegRoutes.test.js` (erweitern)

**Interfaces:**
- Consumes: Task 3.
- Produces:
  - `GET /api/mandat/:token` → `{ mandat, mandatstext, vereinName, turnierBezeichnung }` (404 unbekannt, 410 entschieden/abgelaufen, über `tokenBekannt`)
  - `POST /api/mandat/:token` Body `{ entscheidung, vertretung_bestaetigt }` → `{ success: true, mandat }`
  - Dialog: bei Wahl „Lastschrift“ Felder IBAN (Live-Prüfung über `/js/shared/iban.js`), Kontoinhaber, Mandatstext (aus `mandatsvorschau`), Hinweis auf acht Wochen und Vorabankündigung, zwei Pflicht-Häkchen („Ich bin berechtigt, den Verein zu vertreten“, „Ich erteile das Mandat“); nach dem Speichern bei `bestaetigungNoetig` Hinweis „Ein Admin Ihres Vereins muss das Mandat per Mail bestätigen. Bis dahin gilt das Startgeld nicht als gesichert.“; bestehendes Mandat wird nur maskiert angezeigt (Status-Chip)
  - `AKTIONEN`: `'POST /api/mandat/:token'` → `['mandat.entscheidung', 'Lastschriftmandat bestätigt oder abgelehnt']`; `PUT /api/zahlweg/:id` bleibt generisch, zusätzlich schreibt `erteileMandat`/`widerrufeMandat` je einen Eintrag über `protokolliereKonto` (`mandat.erteilt` / `mandat.widerrufen`, `details: { mandatId, turnierId }`, mit IP, ohne IBAN)
- [ ] **Step 1: Failing tests:** `PUT` mit Lastschrift als Benutzer → 200, `bestaetigungNoetig: true`, Antwort enthält nur `iban_maske`; `GET /api/mandat/<token>` ohne Anmeldung → 200 ohne Klar-IBAN; `POST` bestätigen → 200; erneut → 410; unbekannter Token → 404; `aktionsprotokoll` enthält `mandat.erteilt` mit IP und ohne IBAN-Muster (`IBAN_MUSTER` findet nichts in `details`/`beschreibung`).
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement** Server-Teil.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5: Implement** Dialog und Bestätigungsseite (ohne `menu.js`, Muster `freigabe.html`); manueller Check im Cloud-Modus: Benutzer erteilt Mandat, Mail im Log (ohne SMTP), Link öffnet die Seite, Bestätigen → Dialog zeigt „gültig“.
- [ ] **Step 6: Commit** `git commit -m "Lastschrift: Mandatsdialog und Bestätigung per Mail-Link"`

### Task 5: Transfer zum Hallen-Server

**Files:**
- Modify: `src/services/zahlwegTransfer.js` (`exportiereZahlwege` liefert zusätzlich `gesichert: istZahlwegGesichert(z)`; `pruefeTransferZeile` akzeptiert `lastschrift`; `ersetzeZahlwege` übernimmt `mandat_gueltig = (zahlweg === 'lastschrift' && gesichert === true)`), `src/services/rueckspielen.js` (`uebernehmeNeueZahlwege` legt neue Vereine weiter nur als `bar` an)
- Test: `tests/unit/zahlwegTransfer.test.js`, `tests/unit/rueckspielen.test.js` (erweitern)

**Interfaces:**
- Consumes: `istZahlwegGesichert` (Task 2), Stufe-2 Task 5/6.
- Produces: Export-Zeile `{ verein_name, zahlweg, gesichert, rechnung_email, rechnung_ansprechperson, rechnung_anschrift }`, nie `mandat_*`, `iban*`, `daten_verschluesselt`.
- [ ] **Step 1: Failing tests:** Export eines Turniers mit gültigem Mandat: Zeile `zahlweg 'lastschrift', gesichert true`, kein Schlüssel, der `iban` oder `mandat` enthält, `IBAN_MUSTER` findet im gesamten JSON keine Zahler-IBAN; Import am Hallen-Server setzt `mandat_gueltig` und damit `startgeld_zahlweg_gesichert`; Datei mit `gesichert: true` und Zahlweg `bar` → `mandat_gueltig` false; Rückspielen einer Datei mit geändertem Lastschrift-Verein lässt Cloud-Zeile und Mandat unverändert.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: reduzierter Transfer zum Hallen-Server"`

### Task 6: Anmeldeschluss-Job (Erinnerung, Umstellung auf Bar)

**Files:**
- Create: `src/services/mandatJob.js`
- Modify: `src/app.js` (Start nur Cloud, nie bei `NODE_ENV=test`; Muster `startOrgaErinnerung`), `src/controllers/turnierController.js` (`exportTurnier` ruft vor `baueTurnierExport` `stelleUnbestaetigteUm(knex, { turnierId })`)
- Test: `tests/unit/mandatJob.test.js`

**Interfaces:**
- Consumes: `widerrufeMandat` (Task 3, `grund: 'umstellung'`), `ermittleEffektivenStatus`, `turnierHatEchteKaempfe`, `sendeMail`.
- Produces:
  - `stelleUnbestaetigteUm(knex, { turnierId = null, sende = sendeMail, jetzt = new Date() } = {}): Promise<number>` — für Turniere, deren effektiver Status nicht mehr `veroeffentlicht` ist: Mandate `unbestaetigt` oder `abgelehnt` mit Zahlweg `lastschrift` → `widerrufeMandat(…, 'umstellung')`, Zahlweg `bar`, `synchronisiereGesichert`, Mail an Rechnungs-E-Mail und Admins des zahlenden Vereins („… wird das Startgeld bar vor Ort kassiert.“), Protokoll `mandat.umgestellt`
  - `erinnereUnbestaetigte(knex, { sende, jetzt }): Promise<number>` — Anmeldeschluss in ≤ 3 Tagen, `erinnert_am` leer → neue Tokens an alle Admins (alte verbrauchen), `erinnert_am` per atomarem `UPDATE … WHERE erinnert_am IS NULL RETURNING`
  - `startMandatJob(knex, { intervallMs = 3_600_000 } = {}): () => void`
- [ ] **Step 1: Failing tests:** Turnier mit Anmeldeschluss gestern, Mandat `unbestaetigt` → nach `stelleUnbestaetigteUm` Zahlweg `bar`, Mandat `umgestellt`, kein Chiffretext, Mail an Rechnungs-E-Mail und Admins; Turnier mit offener Anmeldung unverändert; gültiges Mandat unverändert; zweiter Lauf ändert nichts; Erinnerung genau einmal bei zwei parallelen Läufen; Export ruft die Umstellung für das eine Turnier.
- [ ] **Step 2:** `node --test tests/unit/mandatJob.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: unbestätigte Mandate am Anmeldeschluss auf Bar umstellen"`

### Task 7: Lastschrift-Rechnungen

**Files:**
- Modify: `src/services/rechnungslauf.js` (`erstelleRechnungen`), `src/services/rechnungPdf.js` (`RechnungsDaten` um `lastschrift: { mandatsreferenz, mandatDatum, glaeubigerId, ibanMaske, einzugAm } | null`), `src/services/abrechnung.js` (`ladeAbrechnung`: Lastschrift-Vereine ohne gültiges Mandat erscheinen mit `hinweis: 'Mandat nicht gültig'` und blockieren den Lauf), `src/shared/abrechnung.js` (`rechnungsAnzeigeStatus` mit `eingezogen`, L9)
- Test: `tests/unit/rechnungslauf.test.js`, `tests/unit/rechnungPdf.test.js`, `tests/unit/abrechnungLogik.test.js` (erweitern)

**Interfaces:**
- Consumes: `fruehestesFaelligkeitsdatum` (Task 1), Mandatsdaten (Task 3).
- Produces: Lastschrift-Rechnung mit `zahlweg 'lastschrift'`, `mandat_id`, `mandatsreferenz`, `mandat_datum`, `iban_maske_zahler`, `einzug_am`, ohne `zahlungsziel_datum`; PDF-Text „Der Betrag von <Betrag> wird per SEPA-Lastschrift am <Datum> von Ihrem Konto <Maske> eingezogen. Mandatsreferenz <…>, Gläubiger-ID <…>.“ (dient als Vorabankündigung), kein Girocode; Mail-Betreff `Rechnung <Nummer> – <Turnier> (Einzug per Lastschrift)`; `rechnungsAnzeigeStatus(r, heute)` = `eingezogen`, wenn `zahlweg 'lastschrift'`, `sepa_datei_id` gesetzt, `einzug_am <= heute`, Status nicht `bezahlt`/`zurueckgebucht`.
- [ ] **Step 1: Failing tests:** Lauf mit gültigem Mandat: Rechnung mit `einzug_am` = `fruehestesFaelligkeitsdatum(rechnungsdatum, 5, heute)`, `iban_maske_zahler` gesetzt; PDF-Zeilen enthalten „SEPA-Lastschrift“, Mandatsreferenz, keine Klar-IBAN; Lastschrift-Verein ohne gültiges Mandat → Lauf 409 „Verein … hat kein gültiges Mandat.“; Anzeigestatus `eingezogen` erst ab Einzugsdatum mit Datei.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Rechnung als Vorabankündigung mit Einzugsdatum"`

### Task 8: pain.008-Generator

**Files:**
- Create: `src/services/sepaDatei.js`
- Test: `tests/unit/sepaDatei.test.js`

**Interfaces:**
- Consumes: `sepaText`, `sepaKennung` (Task 1).
- Produces:
  - `PAIN008_VERSION = 'pain.008.001.08'`
  - `erzeugePain008({ msgId, erzeugtAm: Date, glaeubiger: { name, iban, glaeubigerId }, faelligkeit: string, posten: Array<{ endToEndId, betragCent, mandatsreferenz, mandatDatum, zahlerName, zahlerIban, verwendungszweck }> }): { xml: string, anzahl: number, summeCent: number }` — UTF-8, ein `PmtInf`; Pflichtelemente: `GrpHdr` (`MsgId`, `CreDtTm` ISO ohne Millisekunden, `NbOfTxs`, `CtrlSum` mit zwei Nachkommastellen, `InitgPty/Nm`), `PmtInf` (`PmtInfId`, `PmtMtd DD`, `BtchBookg true`, `NbOfTxs`, `CtrlSum`, `PmtTpInf` mit `SvcLvl/Cd SEPA`, `LclInstrm/Cd CORE`, `SeqTp OOFF`, `ReqdColltnDt`, `Cdtr/Nm`, `CdtrAcct/Id/IBAN`, `CdtrAgt/FinInstnId/Othr/Id NOTPROVIDED`, `ChrgBr SLEV`, `CdtrSchmeId/Id/PrvtId/Othr` mit `Id` = Gläubiger-ID und `SchmeNm/Prtry SEPA`), je Posten `DrctDbtTxInf` (`PmtId/EndToEndId`, `InstdAmt Ccy="EUR"`, `DrctDbtTx/MndtRltdInf` mit `MndtId`, `DtOfSgntr`, `DbtrAgt/FinInstnId/Othr/Id NOTPROVIDED`, `Dbtr/Nm`, `DbtrAcct/Id/IBAN`, `RmtInf/Ustrd`); alle Texte über `sepaText`/`sepaKennung` und XML-maskiert; wirft bei leerer Postenliste, Betrag ≤ 0 oder ungültiger IBAN (`pruefeIban`)
- [ ] **Step 1: Failing tests:** zwei Posten (2400 + 1600 Cent) → `NbOfTxs` 2, `CtrlSum` `40.00` in `GrpHdr` und `PmtInf`; `SeqTp` `OOFF`, `LclInstrm` `CORE`, Namespace mit `pain.008.001.08`; Name `Jürgen & Söhne <e.V.>` erscheint als `Juergen + Soehne e.V.`; Verwendungszweck mit 200 Zeichen ist im XML ≤ 140; `EndToEndId` ohne Leerzeichen ≤ 35; das XML ist wohlgeformt (Prüfung: keine unmaskierten `<`/`&` in Textknoten per regulärem Ausdruck sowie Gleichheit öffnender/schließender Tags je Elementname); leere Liste wirft. (Gegen das offizielle XSD wird im manuellen Schritt von Task 9 geprüft.)
- [ ] **Step 2:** `node --test tests/unit/sepaDatei.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: pain.008-Sammeldatei"`

### Task 9: SEPA-Download mit Schutz gegen Doppeleinzug

**Files:**
- Create: `src/services/sepaExport.js`
- Modify: `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`, `src/services/aktionsProtokoll.js`, `public/js/abrechnung.js` (Knopf „SEPA-Datei erzeugen“ mit Code-Abfrage für Super-Admins, Anzeige „Datei erzeugt am …“, „Neu erzeugen“ nur mit Auswahl der Rechnungen und Warnung)
- Test: `tests/unit/sepaExport.test.js` (Cloud-Modus, Routen)

**Interfaces:**
- Consumes: `erzeugePain008` (Task 8), `ladeMandatIban` (Task 3), `ermittleZahlungsempfaenger`, `ladeStammdaten`, `pruefeSensibleAktion`, `requireTurnierAdmin` (Stufe 2), `naechsterGeschaeftstag`, `addiereGeschaeftstage` (Task 1).
- Produces:
  - `erzeugeSepaExport(knex, { turnier, benutzerId, neu = false, rechnungIds = null, heute }): Promise<{ xml, dateiname, anzahl, summeCent, faelligkeit, warnung: string|null }>` — wählt Lastschrift-Rechnungen des Turniers mit Status `versandt` oder `offen` (nicht `bezahlt`/`zurueckgebucht`) und `sepa_datei_id IS NULL`; mit `neu` genau `rechnungIds` (müssen zum Turnier gehören); keine → `FachFehler(409, 'Für alle Lastschriften gibt es schon eine Datei.')`; Fälligkeit = `max(einzug_am aller Posten, naechsterGeschaeftstag(addiereGeschaeftstage(heute, 1)))` (Warnung, wenn später als angekündigt); in einer Transaktion `sepa_dateien` anlegen (`msg_id` = `sepaKennung('HJ' + turnierId + '-' + Zeitstempel')`), `rechnungen.sepa_datei_id`/`einzug_am` setzen, `lastschrift_mandate.letzter_einzug_am` = Fälligkeit und `loeschen_ab = berechneLoeschenAb(Fälligkeit)`; Klar-IBANs nur im Rückgabewert
  - `POST /api/abrechnung/:turnierId/sepa` Body `{ neu?: boolean, rechnungIds?: number[] }` → `application/xml`, `Content-Disposition: attachment; filename="sepa-lastschrift-<turnierId>-<YYYY-MM-DD>.xml"`, Header `X-Sepa-Warnung` bei Warnung; vorher `pruefeSensibleAktion(knex, req, { frischeAnmeldungGenuegt: false })` (403 `code 'zwei_faktor'`)
  - `GET /api/abrechnung/:turnierId/sepa` → `{ dateien: Array<{ id, erzeugt_am, faelligkeit, anzahl, summe_cent }> }`
  - `AKTIONEN`: `'POST /api/abrechnung/:id/sepa'` → `['abrechnung.sepa', 'SEPA-Lastschriftdatei erzeugt']`; zusätzlich `protokolliere` mit `details: { anzahl, summeCent, sepaDateiId }`
- [ ] **Step 1: Failing tests:** erster Download → 200, XML mit zwei Posten, `sepa_dateien` 1 Zeile, Rechnungen tragen `sepa_datei_id`; zweiter ohne `neu` → 409; mit `neu` und einer Rechnungs-ID → 200 mit einem Posten; Rechnungs-ID eines anderen Turniers → 400; Rolle `benutzer` des Ausrichters → 403; Super-Admin mit `zf` von eben, ohne Header → 403 `zwei_faktor` (frische Anmeldung genügt hier nicht); Einzugsdatum gestern → Fälligkeit nächster Geschäftstag nach heute und Header `X-Sepa-Warnung`; `aktionsprotokoll` ohne IBAN-Muster; Mandat `letzter_einzug_am` gesetzt.
- [ ] **Step 2:** `node --test tests/unit/sepaExport.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Manueller Check:** erzeugte Datei mit `xmllint --schema pain.008.001.08.xsd` (XSD von iso20022.org bzw. der DK-Seite, nicht ins Repository einchecken) prüfen; Ergebnis und Quelle des Schemas im Commit-Text nennen; scheitert die Prüfung, Generator in Task 8 korrigieren.
- [ ] **Step 6: Commit** `git commit -m "Lastschrift: SEPA-Download mit Merker gegen Doppeleinzug"`

### Task 10: Rücklastschrift und Umstellung durch den Ausrichter

**Files:**
- Modify: `src/services/rechnungslauf.js`, `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`, `src/services/aktionsProtokoll.js`, `public/js/abrechnung.js` (Aktion „Rücklastschrift erfassen“ mit Wahl Überweisung/Bar)
- Test: `tests/unit/ruecklastschrift.test.js`

**Interfaces:**
- Consumes: `widerrufeMandat` (Task 3, `grund 'ruecklastschrift'`), `synchronisiereGesichert`, `erstelleRechnungen` (Stufe 2).
- Produces:
  - `erfasseRuecklastschrift(knex, { turnier, rechnungId, neuerZahlweg: 'ueberweisung'|'bar', benutzerId }): Promise<{ rechnung, zahlweg }>` — nur Lastschrift-Rechnungen mit `sepa_datei_id` (sonst 400); Status `zurueckgebucht`, `zurueckgebucht_am`; Mandat widerrufen; Zahlweg-Zeile auf `neuerZahlweg` (ohne Anmeldeschluss-Sperre); `synchronisiereGesichert(…, { statusAbleiten: false })`; der nächste `erstelleRechnungen` legt eine neue Rechnung an (Partial-Unique-Index aus Stufe 2)
  - `POST /api/abrechnung/:turnierId/rechnungen/:rechnungId/ruecklastschrift { neuerZahlweg }` (`requireTurnierAdmin`); `AKTIONEN` → `['abrechnung.ruecklastschrift', 'Rücklastschrift erfasst und Zahlweg umgestellt']`
- [ ] **Step 1: Failing tests:** Rücklastschrift auf eine eingezogene Rechnung → Status `zurueckgebucht`, Zahlweg `ueberweisung`, Mandat `widerrufen`; erneuter Rechnungslauf erzeugt genau eine neue Überweisungs-Rechnung mit der nächsten Nummer, die alte bleibt; Rechnung ohne Datei → 400; Überweisungs-Rechnung → 400.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Rücklastschrift erfassen und Zahlweg umstellen"`

### Task 11: Aufbewahrung und Schlüsselverwaltung

**Files:**
- Create: `scripts/zahlungsdaten-schluessel.mjs`
- Modify: `src/utils/feldVerschluesselung.js` (Entschlüsseln wählt den Schlüssel über `kid`: `ZAHLUNGSDATEN_SCHLUESSEL` oder `ZAHLUNGSDATEN_SCHLUESSEL_ALT`; neu `schluesselKennung(env): { aktuell: string|null, alt: string|null }`), `src/services/mandate.js` (`loescheAbgelaufeneMandate`), `src/app.js` (täglicher Lauf nur Cloud, Muster `bereinigeKonten`)
- Test: `tests/unit/feldVerschluesselung.test.js` (erweitern), `tests/unit/mandatAufbewahrung.test.js`

**Interfaces:**
- Produces:
  - `loescheAbgelaufeneMandate(knex, heute: string): Promise<number>` — löscht Zeilen mit `loeschen_ab < heute`; Rechnungen behalten ihre Kopien (`mandat_id` wird per FK `NULL`)
  - `schluessel umschluesseln`: `node scripts/zahlungsdaten-schluessel.mjs pruefen` (zählt Chiffretexte je `kid` in `vereins_abrechnung.iban_verschluesselt` und `lastschrift_mandate.daten_verschluesselt`, meldet nicht entschlüsselbare) und `umschluesseln --ja` (alles mit dem alten Schlüssel → neuer Schlüssel, in einer Transaktion, danach `pruefen`-Ausgabe)
- [ ] **Step 1: Failing tests:** Chiffretext mit altem Schlüssel ist mit `ZAHLUNGSDATEN_SCHLUESSEL_ALT` lesbar; neue Verschlüsselung nutzt immer den aktuellen; `umschluesseln` (als Funktion `schluesseleUm(knex, env)` aus dem Skript exportiert) macht alle Texte mit neuem `kid` lesbar ohne `_ALT`; `loescheAbgelaufeneMandate` löscht ein Mandat mit `loeschen_ab` gestern, nicht eines mit heute, die verknüpfte Rechnung behält `mandatsreferenz`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "Lastschrift: Aufbewahrung der Mandate und Schlüsselwechsel"`

### Task 12: Datenschutz, Betrieb, Dokumentation und Gesamtlauf

**Files:**
- Modify: `src/services/rechtstexte.js` + `tests/unit/rechtliches.test.js` (Abschnitt „SEPA-Lastschrift“: Mandatsdaten, IP und Zeitstempel als Nachweis, Speicherung verschlüsselt, Löschung 14 Monate nach dem letzten Einzug, Weitergabe der Bankverbindung an die Bank des Ausrichters über die Sammeldatei), `docs/datenschutz/verarbeitungsverzeichnis.md`, `docs/datenschutz/toms-und-loeschkonzept.md` (Mandate 14 Monate, Bestätigungs-Tokens, Schlüsselwechsel), `docs/datenschutz/unterauftragnehmer-und-dsfa.md` (Schwellenwertanalyse um Bankverbindungen ergänzen), `docs/datenschutz/README.md`, `docs/betrieb.md` (Abschnitt „Schlüssel für Zahlungsdaten“: erzeugen mit `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, getrennt von den Sicherungen verwahren — ausgedruckt im Tresor oder Passwortmanager der Vereinsführung; Wechsel mit `ZAHLUNGSDATEN_SCHLUESSEL_ALT` + Skript; Verlust = alle IBANs neu erfassen, Mandate neu einholen; Hinweis pain.008-Version mit der Hausbank prüfen), `CLAUDE.md` (Domänenmodell `lastschrift_mandate`, `sepa_dateien`, neue Spalten; Architektur „Startgeld-Lastschrift (Stufe 3)“ mit L1–L12 in Kurzform und Tests)

- [ ] **Step 1:** Texte und Test ergänzen; `node --test tests/unit/rechtliches.test.js` → PASS.
- [ ] **Step 2:** `npm run ci:lokal` → grün.
- [ ] **Step 3: Commit** `git commit -m "Lastschrift: Datenschutz, Betrieb und Dokumentation"`

---

## Selbstprüfung (Spec-Abdeckung Stufe 3)
- Gläubiger-ID mit Formatprüfung, Lastschrift nur bei vollständigen Stammdaten → Tasks 1, 2.
- Mandatsdialog (IBAN-Prüfsumme, Kontoinhaber, Mandatstext mit Gläubiger-ID, Mandatsreferenz, acht Wochen, Vorabankündigungsfrist, Vertretungsbestätigung, Zeitstempel/Benutzer/IP/Textversion), verschlüsselt → Tasks 1, 3, 4.
- Bestätigung (Admin sofort, sonst Einmal-Link 7 Tage an alle Admins, einer genügt), unbestätigt = nicht gesichert, Umstellung auf Bar am Anmeldeschluss mit Mail → Tasks 3, 4, 6.
- Widerruf beim Wechsel (IBAN löschen, protokolliert) → Tasks 3, 4.
- pain.008 (Version recherchiert und markiert), OOFF, Fälligkeit = Rechnungsdatum + Frist auf Geschäftstag, Zeichensatz, Verwendungszweck ≤ 140 → Tasks 1, 7, 8.
- Download nur Admin, Protokoll, Code für Super-Admins, „Datei erzeugt am“ gegen Doppeleinzug → Task 9.
- Rücklastschrift mit Umstellung, Rechnungstext „Einzug per Lastschrift“ → Tasks 7, 10.
- Löschung 14 Monate, Schlüsselverwaltung (Variable, getrennte Verwahrung, Wechsel) → Tasks 11, 12.
- Transfer ohne IBAN/Mandat → Task 5.
- Nicht in Stufe 3: Wiederholungsmandate (FRST/RCUR), B2B-Lastschrift, Bankdatei-Import, Gutschriften (Stufe 4).
