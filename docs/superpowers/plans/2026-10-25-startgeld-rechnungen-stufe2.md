# Startgeld-Rechnungen (Stufe 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Admin des Ausrichters pflegt einmal die Abrechnungs-Stammdaten seines Vereins, spielt das Turnier nach dem Wettkampftag vom Hallen-Server in die Cloud zurück (Wettkampfdaten, Barzahlungen, vor Ort neu erfasste Vereine) und erstellt dort per Knopfdruck je meldendem Verein eine Rechnung bzw. Quittung als PDF (mit Girocode), die per Mail an die Rechnungs-E-Mail geht.

**Architecture:** Neue Tabellen `vereins_abrechnung` (Stammdaten je Verein, IBAN AES-GCM-verschlüsselt mit eigenem Schlüssel `ZAHLUNGSDATEN_SCHLUESSEL`), `rechnungen` (Momentaufnahme von Aussteller, Empfänger, Kämpferliste und PDF; überlebt das Löschen von Turnier/Verein) und `turnier_barzahlungen` (Kassenjournal). Reine Logik (Zählung, Nummern, Status, Verwendungszweck, IBAN, Girocode) liegt in `src/shared/`, die Abläufe in Services (`abrechnungStammdaten.js`, `rueckspielen.js`, `abrechnung.js`, `rechnungslauf.js`, `rechnungPdf.js`), die API unter `/api/abrechnung` (nur Cloud). Das Zurückspielen baut den vorhandenen `importTurnierErgebnisse` zu einem Service um, den der Datei-Upload in der Cloud und der neue Direktweg vom Hallen-Server (`/api/cloud/turniere/:id/zurueckspielen`) gemeinsam nutzen.

**Tech Stack:** Node/Express (ES-Module), Knex/PostgreSQL, `pdf-lib` + `@pdf-lib/fontkit` (Schriften `public/fonts/urkunden/NotoSans-*.ttf`), `qrcode-generator`, `nodemailer`, Vanilla-JS, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md` (Stufe 2; dort Abschnitt „Stand nach Stufe 1 / Abweichungen“ beachten). Vorgänger: `docs/superpowers/plans/2026-10-24-startgeld-zahlweg-stufe1.md` (auf `main`). Nachfolger: `docs/superpowers/plans/2026-10-25-startgeld-lastschrift-stufe3.md` (baut auf den Interfaces dieses Plans auf; Namen nicht ändern, ohne dort nachzuziehen).

## Entscheidungen des Planers (aus Spec und Code abgeleitet)
- **E1 Stammdaten-Seite:** Es gibt kein Vereinsprofil mit Reitern. Neu: Seite `verein-abrechnung.html?vereinId=` (Titel „Abrechnung“), verlinkt aus `profil.html` („Meine Vereine“, nur bei Rolle `admin` bzw. Super-Admin im Modus) und aus dem Startgeld-Block in `turnier.html`.
- **E2 Erhebung erst bei Bedarf:** Das Speichern eines Turniers mit Startgeld wird durch fehlende Stammdaten **nicht** blockiert (Rolle `benutzer` darf Turniere anlegen, aber keine Stammdaten pflegen). Der Startgeld-Block zeigt die fehlenden Angaben (`fehlendeStammdaten`) mit Link; gesperrt ist erst „Rechnungen erstellen“.
- **E3 IBAN des Ausrichters:** Turnierfelder `iban`/`kontoinhaber` haben Vorrang, wenn beide gefüllt sind, sonst gilt das Vereinskonto (Festlegung 11). In der Cloud sind die Turnierfelder bei Startgeld > 0 nur noch Pflicht, wenn der Verein kein Konto hinterlegt hat; `verwendungszweck` wird optional (Vorlage `Startgeld <Turniername> <Verein> <Rechnungsnummer>`). Am Hallen-Server bleibt die bisherige Pflicht (dort gibt es keine Stammdaten). Die Turnierfelder bekommen weiterhin **keine** Prüfsummenprüfung (bestehende Specs nutzen ungültige Test-IBANs), die Stammdaten-IBAN schon.
- **E4 Welche IBAN reist wohin:** Zum Hallen-Server reisen wie bisher nur die Turnierfelder `iban`/`kontoinhaber` (Empfängerkonto des Ausrichters, ohnehin auf jeder Rechnung). `vereins_abrechnung` wird nie exportiert; Rechnungen und Barzahlungs-Journal reisen nicht zum Hallen-Server. Im Rückweg ignoriert die Cloud alle Turnier-Stammfelder der Datei.
- **E5 Bereitschaft der Abrechnung:** aktiv, wenn `turniere.zurueckgespielt_am` gesetzt ist **oder** das Turnier in der Cloud live lief (`cloud_live.beendet_am` gesetzt) und nie geholt wurde (`auf_hallen_server_geholt_am` leer). Turniere ohne Cloud-Bezug (am Hallen-Server angelegt) gibt es in der Cloud nicht. Die Basis `gemeldet` ändert daran nichts (Rückspielen bleibt Pflicht, Spec Abschnitt 4).
- **E6 Rückspielen nur Admin:** `import-ergebnisse` verlangt künftig Rolle `admin` des Ausrichters oder Super-Admin im Modus (bisher Rolle `benutzer`). Super-Admins zusätzlich `pruefeSensibleAktion` (frische 2FA-Anmeldung ≤ 10 Min. oder Header `X-2FA-Code`), weil der Direktweg den TOTP-Code bereits beim Login verbraucht.
- **E7 Wiederholtes Rückspielen:** erlaubt, solange keine Rechnung `versandt_am` hat; danach 409, außer ein Admin hat `POST /api/abrechnung/:turnierId/rueckspielen-freigeben` ausgelöst (`turniere.rueckspielen_freigegeben = true`, wird vom nächsten Rückspielen verbraucht). Bestehende Rechnungen bleiben unverändert.
- **E8 Zählung:** je Verein alle Teilnehmer außer `status = 'zurueckgezogen'` (Selbstabmeldung) und außer dem Ausrichter-Verein; Basis `teilnahme_waage` zusätzlich nur `gewogen`. Ein Kämpfer zählt einmal: Schlüssel `judopass_id` (getrimmt, nicht leer) sonst `vorname|nachname|geburtsjahr` (klein, getrimmt).
- **E9 Bar:** Zahlweg Bar und alle gezählten Kämpfer `startgeld_bezahlt` → Quittung (`art = 'quittung'`, Status `bezahlt`). Sonst Rechnung über den Gesamtbetrag mit Zeile „bar erhalten“ und Restbetrag per Überweisung (Girocode über den Rest).
- **E10 Rechnungsnummer:** `<Präfix><Nummer fünfstellig>`, z. B. `JCK-00001`; Zähler je Verein `vereins_abrechnung.naechste_rechnungsnummer`, vergeben mit `SELECT … FOR UPDATE` in derselben Transaktion wie das Einfügen der Rechnung (lückenlos; Mailfehler lassen die Rechnung `offen`, sie wird erneut gesendet, nie verworfen).
- **E11 Status:** gespeichert `offen` | `versandt` | `bezahlt` (Stufe 3 ergänzt `zurueckgebucht`); `ueberfaellig` wird angezeigt, nicht gespeichert (versandt, Zahlungsziel vor heute).
- **E12 Neue Vereine vor Ort:** Am Hallen-Server erfasst der Kassendialog für Vereine „ohne Zahlweg“ die Rechnungsdaten (`POST /api/zahlweg/:turnierId/vor-ort`, Zahlweg immer `bar`). Beim Rückspielen übernimmt die Cloud nur Zahlweg-Zeilen von Vereinen, die dort noch keine haben, immer als `bar`; bestehende Zeilen bleiben unberührt.
- **E13 Mail:** `sendeMail` lernt Anhänge, Reply-To und Absendernamen und meldet `{ versendet, grund }`; bestehende Aufrufer bleiben unverändert. Ohne SMTP bleibt die Rechnung `offen` (PDF herunterladbar).
- **E14 Aufbewahrung:** `rechnungen.turnier_id` und `aussteller_verein_id` mit `ON DELETE SET NULL`, alle Druckdaten als Momentaufnahme in der Zeile (8 Jahre, Löschkonzept). Vereine zusammenführen: Stammdaten des Ziels gewinnen.

## Global Constraints
- Abrechnung, Stammdaten und Rechnungen nur im Modus `cloud` (Einzelbenutzerbetrieb: 409 „Die Abrechnung gibt es nur in der Cloud.“).
- Stammdaten, Abrechnungsseite, Rechnungslauf, Rückspiel-Freigabe: Admin des Ausrichters (freigegeben, Rolle `admin`) oder Super-Admin im Super-Admin-Modus.
- IBAN nie in Protokoll (`aktionsprotokoll.details`), Konsole, Fehlermeldungen, API-Antworten (nur Maske `DE89 **** **** **** **** 00` = erste 4 + letzte 2 Zeichen) oder Turnier-Export; `schwaerze` in `fehlerProtokoll.js` ersetzt IBAN-Muster durch `***IBAN***`.
- Verschlüsselung: AES-256-GCM, Schlüssel aus `ZAHLUNGSDATEN_SCHLUESSEL` (mindestens 32 Zeichen); fehlt er, schlagen Speichern/Lesen einer IBAN mit 503 „Der Schlüssel für Zahlungsdaten fehlt (ZAHLUNGSDATEN_SCHLUESSEL).“ fehl, alles andere läuft.
- Beträge intern in Cent (Integer); `turniere.startgeld` sind ganze Euro.
- Girocode nach EPC069-12: `BCD`, `002`, `1`, `SCT`, BIC leer, Name ≤ 70, IBAN ohne Leerzeichen, `EUR<betrag mit 2 Nachkommastellen>`, Purpose leer, Referenz leer, Text ≤ 140.
- Verwendungszweck ≤ 140 Zeichen; Platzhalter `<Turniername>`, `<Verein>`, `<Rechnungsnummer>`; fehlt `<Rechnungsnummer>` in der Vorlage, wird ` <Rechnungsnummer>` angehängt.
- Turnierfelder: `zahlungsziel_tage` (ganze Zahl 1–90, Standard 14), `rechnung_hinweis` (Text ≤ 1000, optional).
- Code im Stil der Umgebung: deutsche Bezeichner/Kommentare, Routen als `getXRoutes(knex)`, Fehler als `FachFehler`, Zeiten in Europe/Berlin.
- Bestehende Tests und das Verhalten kostenloser Turniere bleiben unverändert.

## Review Focus
1. Zweites Rückspielen nach versandten Rechnungen: 409, keine Teilnehmer gelöscht, Rechnungen unverändert; mit Freigabe genau einmal möglich. (Test in Task 6)
2. Datei eines anderen Turniers, abgeschnittene/zu kleine Datei (`anzahl` passt nicht zu den Listen) oder Hallen-Server-Datei mit geänderten Zahlungsdaten bestehender Vereine: 400 bzw. Zahlungsdaten bleiben wie in der Cloud. (Task 6)
3. Mail scheitert mitten im Lauf (SMTP-Fehler bei Verein 2 von 3): alle drei Rechnungen existieren mit lückenlosen Nummern, Verein 2 bleibt `offen` mit `versand_fehler`, erneutes Senden setzt `versandt`. Zwei gleichzeitige Läufe erzeugen keine doppelten Rechnungen oder Nummern. (Task 10)
4. Verein mit abweichend geschriebenem Namen (ohne Zahlweg-Zeile): steht in „Nicht zugeordnet“, „Rechnungen erstellen“ antwortet 409, bis er zugeordnet oder mit Rechnungsdaten erfasst ist. (Task 8)
5. `ZAHLUNGSDATEN_SCHLUESSEL` fehlt oder wurde getauscht: Stammdaten ohne IBAN lesbar, Speichern einer IBAN 503, Rechnungslauf nennt „Konto des Ausrichters nicht lesbar“ statt 500; kein Klartext in Logs. (Task 1 und 3)

---

## Datei-Übersicht
- Create `migrations/20261102100000_startgeld_rechnungen.js`.
- Create `src/shared/iban.js`, `src/shared/girocode.js`, `src/shared/abrechnung.js`.
- Create `src/utils/feldVerschluesselung.js`, `src/utils/sensibleAktion.js`.
- Create `src/services/abrechnungStammdaten.js`, `src/services/rueckspielen.js`, `src/services/abrechnung.js`, `src/services/rechnungPdf.js`, `src/services/pdfQr.js`, `src/services/rechnungslauf.js`.
- Create `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`.
- Create `public/verein-abrechnung.html`, `public/js/vereinAbrechnung.js`, `public/abrechnung.html`, `public/js/abrechnung.js`, `public/js/rueckspielDialog.js`.
- Modify `src/app.js`, `src/utils/mailer.js`, `src/services/fehlerProtokoll.js`, `src/services/aktionsProtokoll.js`, `src/services/helferAusweis.js`, `src/services/vereinsVerwaltung.js`, `src/services/zahlwege.js`, `src/services/zahlwegTransfer.js`, `src/services/cloudZugriff.js`, `src/routes/cloudRoutes.js`, `src/controllers/turnierController.js`, `src/controllers/zahlwegController.js`, `src/routes/zahlwegRoutes.js`, `src/controllers/authController.js`, `src/middleware/auth.js`, `src/services/rechtstexte.js`, `public/turnier.html`, `public/js/turnier.js`, `public/profil.html`, `public/teilnehmer.html`, `public/js/teilnehmer.js`, `public/js/zahlwegDialog.js`, `public/turniere.html` (Hallen-Server-Knopf), `tests/helpers/fake-cloud.mjs`, `docs/datenschutz/*`, `docs/betrieb.md`, `CLAUDE.md`.

---

### Task 1: IBAN, Girocode, Feldverschlüsselung und Schwärzung

**Files:**
- Create: `src/shared/iban.js`, `src/shared/girocode.js`, `src/utils/feldVerschluesselung.js`
- Modify: `src/services/fehlerProtokoll.js` (Liste `SCHWAERZEN`), `public/js/teilnehmer.js` (lokale `baueGiroCodePayload` durch Import aus `/js/shared/girocode.js` ersetzen; Muster des bestehenden Imports von `/js/shared/zahlweg.js`)
- Test: `tests/unit/iban.test.js`, `tests/unit/feldVerschluesselung.test.js`, `tests/unit/fehlerProtokoll.test.js` (erweitern)

**Interfaces:**
- Produces (`src/shared/iban.js`, framework-frei):
  - `normalisiereIban(text: string): string` — Großbuchstaben, ohne Leer-/Trennzeichen
  - `pruefeIban(text: string): { ok: boolean, iban: string|null, fehler: string|null }` — Länderlänge (mindestens DE 22, AT 20, CH 21, NL 18, BE 16, FR 27, LU 20, IT 27, ES 24, PL 28, DK 18, LI 21; unbekanntes Land: Länge 15–34) und Modulo-97 = 1
  - `maskiereIban(iban: string): string` — erste 4 Zeichen, Sternchen-Gruppen, letzte 2: `DE89 **** **** **** **** 00`
  - `formatiereIban(iban: string): string` — Vierergruppen
  - `IBAN_MUSTER: RegExp` (global) — findet IBANs mit und ohne Vierer-Leerzeichen in Freitext
- Produces (`src/shared/girocode.js`): `baueGiroCodePayload({ name, iban, betrag, verwendungszweck }): string` (Werte siehe Global Constraints; `betrag` als Euro-Zahl).
- Produces (`src/utils/feldVerschluesselung.js`):
  - `schluesselVorhanden(env = process.env): boolean`
  - `verschluesseleFeld(klartext: string, env = process.env): string` — Format `z1:<kid>:<iv>:<tag>:<daten>` (base64-Teile, `kid` = erste 8 Hex-Zeichen von SHA-256 des Schlüssels), Schlüssel = SHA-256(`hajime-zahlungsdaten:` + `ZAHLUNGSDATEN_SCHLUESSEL`)
  - `entschluesseleFeld(text: string, env = process.env): string` — wirft `FachFehler(503, …)` bei fehlendem Schlüssel, `FachFehler(500, 'Zahlungsdaten konnten nicht entschlüsselt werden.')` bei falschem Schlüssel/Manipulation (ohne Inhalt in der Meldung)
  - `SCHLUESSEL_MINDESTLAENGE = 32`
- [ ] **Step 1: Failing tests:** `pruefeIban('DE89 3704 0044 0532 0130 00').ok === true`, `iban === 'DE89370400440532013000'`; `'DE89370400440532013001'` → `ok: false`; `'DE8937040044'` → Fehler Länge; `maskiereIban('DE89370400440532013000') === 'DE89 **** **** **** **** 00'`; `baueGiroCodePayload({name:'JC A', iban:'DE89 3704 0044 0532 0130 00', betrag: 24, verwendungszweck:'x'.repeat(200)})` hat 11 Zeilen, Zeile 7 `DE89370400440532013000`, Zeile 8 `EUR24.00`, Zeile 11 Länge 140. Verschlüsselung: Rundreise; zweimal verschlüsseln ergibt verschiedene Texte; Text beginnt mit `z1:`; anderer Schlüssel → `FachFehler` 500; ohne Variable → 503; Schlüssel < 32 Zeichen → `schluesselVorhanden` false. Schwärzung: `schwaerze('IBAN DE89 3704 0044 0532 0130 00 ok')` und ohne Leerzeichen ergibt `***IBAN***`, `'Rechnung JCK-00001'` bleibt unverändert.
- [ ] **Step 2:** `node --test tests/unit/iban.test.js tests/unit/feldVerschluesselung.test.js tests/unit/fehlerProtokoll.test.js` → FAIL.
- [ ] **Step 3: Implement** die drei Module; in `SCHWAERZEN` einen Eintrag mit `IBAN_MUSTER` ergänzen (Import aus `../shared/iban.js`); `teilnehmer.js` nutzt die geteilte Funktion.
- [ ] **Step 4:** Tests → PASS; `npx playwright test tests/e2e/startgeld-kasse.spec.js` bleibt grün.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: IBAN-Prüfung, Girocode, Feldverschlüsselung, IBAN-Schwärzung"`

### Task 2: Reine Abrechnungslogik

**Files:**
- Create: `src/shared/abrechnung.js`
- Test: `tests/unit/abrechnungLogik.test.js`

**Interfaces:**
- Produces:
  - `STAMMDATEN_FELDER = ['anschrift', 'rechnung_email', 'absender_name', 'ust_hinweis', 'rechnungs_praefix']`
  - `fehlendeStammdaten(stammdaten: object|null, turnier: {iban?, kontoinhaber?}): string[]` — deutsche Bezeichnungen in fester Reihenfolge: „Anschrift“, „Rechnungs-E-Mail“, „Absendername“, „Steuernummer oder USt-IdNr.“ (fehlt, wenn beide leer), „Umsatzsteuer-Hinweis“, „Rechnungsnummern-Präfix“, „Kontoinhaber und IBAN“ (fehlt nur, wenn weder Turnierfelder beide gefüllt noch `stammdaten.iban_vorhanden`)
  - `pruefePraefix(text): string|null` — Fehlertext oder null; erlaubt `[A-Za-z0-9-]{1,12}`
  - `formatiereRechnungsnummer(praefix: string, nummer: number): string` — `JCK-` + `00001`
  - `kaempferSchluessel(t): string` (E8)
  - `zaehleKaempferJeVerein(teilnehmer: object[], { basis: 'gemeldet'|'teilnahme_waage', ausrichterName: string|null }): Map<string, { vereinName, kaempfer: {name: string, judopass_id: string|null}[], anzahl: number, bezahltAnzahl: number }>` — E8; `name` = „Nachname, Vorname“; `bezahltAnzahl` zählt `startgeld_bezahlt`; Kämpfer sortiert nach Name
  - `baueVerwendungszweck(vorlage: string|null, { turnierName, vereinName, rechnungsnummer }): string` (Global Constraints; leere Vorlage → `Startgeld <Turniername> <Verein> <Rechnungsnummer>`)
  - `addiereTage(isoDatum: string, tage: number): string` (`YYYY-MM-DD`, kalendarisch, ohne Zeitzonenfehler)
  - `heuteBerlin(jetzt: Date = new Date()): string`
  - `rechnungsAnzeigeStatus(rechnung: {status, zahlungsziel_datum}, heute: string): 'offen'|'versandt'|'ueberfaellig'|'bezahlt'|'zurueckgebucht'`
  - `rechnungsArt({ zahlweg, anzahl, bezahltAnzahl }): 'rechnung'|'quittung'` (E9)
- [ ] **Step 1: Failing tests:** Zählung mit „JC A“: Kämpfer X (Pass `P1`) doppelt (Einzel- und Mannschaftszeile) zählt 1; zurückgezogener Kämpfer zählt nicht; Ausrichter-Verein fehlt in der Map; bei `teilnahme_waage` zählt ein ungewogener nicht, ein gewogener mit Status `disqualifiziert` schon; ohne Pass-ID zählen „Max Muster 2012“ und „max muster 2012 “ als einer. `fehlendeStammdaten(null, {})` liefert alle 7 Einträge; mit Steuernummer, ohne USt-Id fehlt „Steuernummer oder USt-IdNr.“ nicht; Turnierfelder IBAN+Kontoinhaber gefüllt → „Kontoinhaber und IBAN“ fehlt nicht. `formatiereRechnungsnummer('JCK-', 7) === 'JCK-00007'`; `pruefePraefix('JC K')` liefert Fehler. `baueVerwendungszweck('Startgeld <Turniername> <Verein>', {…, rechnungsnummer:'JCK-00001'})` endet auf ` JCK-00001`; Ergebnis nie > 140. `addiereTage('2026-12-28', 14) === '2027-01-11'`. `rechnungsAnzeigeStatus({status:'versandt', zahlungsziel_datum:'2026-11-01'}, '2026-11-02') === 'ueberfaellig'`, am `'2026-11-01'` `'versandt'`. `rechnungsArt({zahlweg:'bar', anzahl:3, bezahltAnzahl:3}) === 'quittung'`, mit 2 → `'rechnung'`, Überweisung immer `'rechnung'`.
- [ ] **Step 2:** `node --test tests/unit/abrechnungLogik.test.js` → FAIL.
- [ ] **Step 3: Implement** `src/shared/abrechnung.js` (kein knex/DOM; `heuteBerlin` über `Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' })`).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: reine Logik für Zählung, Nummern und Status"`

### Task 3: Migration und Stammdaten-Service/API

**Files:**
- Create: `migrations/20261102100000_startgeld_rechnungen.js` (Muster `20261101100000_startgeld_zahlweg.js`, `config = { transaction: false }`), `src/services/abrechnungStammdaten.js`, `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`
- Modify: `src/app.js` (neben dem Mount von `/api/zahlweg`: `app.use('/api/abrechnung', requireWriteAuth, getAbrechnungRoutes(knex));`), `src/services/vereinsVerwaltung.js` (`BESONDERS_BEHANDELT` um `'vereins_abrechnung.verein_id'` erweitern; in `fuehreVereineZusammen`: hat das Ziel Stammdaten, werden die der Quelle gelöscht, sonst auf das Ziel umgehängt), `src/middleware/auth.js`
- Test: `tests/unit/abrechnungStammdaten.test.js` (Cloud-Modus, Muster `tests/unit/zahlwegRoutes.test.js`), `tests/unit/superAdminVerwaltung.test.js` (Zusammenführen-Fall ergänzen)

**Interfaces:**
- Schema (alles in einer Migration, `down` baut vollständig zurück):
  - `vereins_abrechnung(verein_id integer PK → vereine ON DELETE CASCADE, anschrift text, rechnung_email string, absender_name string, steuernummer string, ust_id string, ust_hinweis text, rechnungs_praefix string(12), naechste_rechnungsnummer integer not null default 1, kontoinhaber string, iban_verschluesselt text, iban_maske string, geaendert_von string, created_at, updated_at)`
  - `turniere`: `zahlungsziel_tage integer not null default 14`, `rechnung_hinweis text`, `zurueckgespielt_am timestamptz null`, `rueckspielen_freigegeben boolean not null default false`
  - `turnier_barzahlungen(id, uid uuid not null unique, turnier_id → turniere CASCADE, verein_name string not null, anzahl integer not null, betrag_cent integer not null, kassiert_am timestamptz not null default now())`
  - `rechnungen(id, turnier_id → turniere ON DELETE SET NULL, aussteller_verein_id → vereine ON DELETE SET NULL, verein_name string not null, zahlweg string not null, art string not null, nummer string not null, rechnungsdatum date not null, leistungsdatum date, zahlungsziel_datum date null, anzahl integer not null, einzelpreis_cent integer not null, betrag_cent integer not null, bar_erhalten_cent integer not null default 0, positionen jsonb not null, empfaenger jsonb not null, aussteller jsonb not null, turnier_bezeichnung string, verwendungszweck string(140), hinweis text, pdf bytea, status string not null default 'offen', versandt_am timestamptz, versand_fehler text, bezahlt_am timestamptz, bezahlt_von string, erstellt_von string, created_at, updated_at, unique(aussteller_verein_id, nummer))` plus Partial-Unique-Index `rechnungen_turnier_verein_aktiv` auf `(turnier_id, verein_name) WHERE status <> 'zurueckgebucht'` (per `knex.raw`)
- Produces (`src/services/abrechnungStammdaten.js`):
  - `ladeStammdaten(knex, vereinId): Promise<Stammdaten|null>` — alle Felder außer `iban_verschluesselt`, dazu `iban_vorhanden: boolean`, `iban_maske`
  - `speichereStammdaten(knex, vereinId, eingabe, benutzerId): Promise<Stammdaten>` — Felder aus `STAMMDATEN_FELDER` + `steuernummer`, `ust_id`, `kontoinhaber`; `iban` nur wenn nicht leer (dann `pruefeIban`, verschlüsseln, Maske), `iban_loeschen: true` löscht IBAN und Maske; `naechste_rechnungsnummer` ist nicht änderbar; Präfix-Änderung erlaubt (alte Rechnungen behalten ihre Nummer); E-Mail-Prüfung mit `istGueltigeEmail`; Fehler `FachFehler(400)`
  - `ermittleZahlungsempfaenger(knex, turnier): Promise<{ kontoinhaber, iban, quelle: 'turnier'|'verein' } | null>` (E3; entschlüsselt die Vereins-IBAN)
  - `pruefeStammdatenFuerTurnier(knex, turnier): Promise<{ vollstaendig: boolean, fehlt: string[] }>` (über `fehlendeStammdaten`)
- Produces (`src/middleware/auth.js`): `requireTurnierAdmin(knex)` — wie `requireTournamentEditAccess`, aber Rolle `admin` im ausrichtenden Verein oder `super_admin_aktiv`; Einzelbenutzerbetrieb → 409 mit der Meldung aus den Global Constraints; setzt `req.tournament`.
- Produces (API, Controller `erzeugeAbrechnungController(knex, { sende })`):
  - `GET /api/abrechnung/stammdaten/:vereinId` → `{ stammdaten, fehlt }` (nur `darfVereinVerwalten`, sonst 403)
  - `PUT /api/abrechnung/stammdaten/:vereinId` → `{ success: true, stammdaten }`
  - `GET /api/abrechnung/stammdaten-pruefung/:turnierId` → `{ vollstaendig, fehlt, vereinId, darfPflegen }` für jedes freigegebene Ausrichter-Mitglied ab Rolle `benutzer` (über `requireTournamentEditAccess`), ohne Feldinhalte
- [ ] **Step 1: Failing tests:** Admin von „JC Ausrichter“ `PUT` mit allen Feldern und IBAN `DE89 3704 0044 0532 0130 00` → 200, Antwort ohne `iban_verschluesselt`, `iban_maske === 'DE89 **** **** **** **** 00'`; Datenbank-Spalte beginnt mit `z1:`; `GET` als Benutzer (Rolle `benutzer`) → 403, als Super-Admin im Modus → 200; ungültige IBAN → 400; `PUT` ohne `iban` behält die alte; `iban_loeschen` entfernt sie; ohne `ZAHLUNGSDATEN_SCHLUESSEL` → `PUT` mit IBAN 503, ohne IBAN 200; `stammdaten-pruefung` als Benutzer des Ausrichters liefert `fehlt` ohne Feldwerte, als Mitglied eines Fremdvereins 403; im Einzelbenutzerbetrieb (eigener Testfall mit `BETRIEBSMODUS=server`-Kontext über `requireTurnierAdmin` direkt) 409. Zusammenführen: Quelle und Ziel mit Stammdaten → genau eine Zeile (die des Ziels), keine Fehlermeldung; nur Quelle mit Stammdaten → Zeile hängt am Ziel.
- [ ] **Step 2:** `node --test tests/unit/abrechnungStammdaten.test.js tests/unit/superAdminVerwaltung.test.js` → FAIL.
- [ ] **Step 3: Implement** Migration, Service, Middleware, Controller/Routen (Fehlerabbildung wie `antworteFehler` in `zahlwegController.js`), Zusammenführen.
- [ ] **Step 4:** `npx knex migrate:latest --knexfile knexfile.cjs --env online` (lokal, `npm run pg:start`), `migrate:rollback` und erneut `latest` laufen; Tests → PASS.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: Stammdaten des Ausrichters mit verschlüsselter IBAN"`

### Task 4: Stammdaten-Seite, Startgeld-Block und Turnierfelder

**Files:**
- Create: `public/verein-abrechnung.html`, `public/js/vereinAbrechnung.js`
- Modify: `public/profil.html` (Link „Abrechnungsdaten“ je Verein mit Rolle `admin`; Super-Admin im Modus sieht ihn bei allen Vereinen der Liste), `public/turnier.html` + `public/js/turnier.js` (Startgeld-Block: Felder `zahlungsziel_tage`, `rechnung_hinweis`; Kasten „Für Rechnungen fehlt noch: …“ aus `stammdaten-pruefung` mit Link auf `verein-abrechnung.html?vereinId=` nur bei `darfPflegen`, sonst „Bitte einen Admin Ihres Vereins …“; nur in der Cloud), `src/controllers/turnierController.js` (`TURNIER_SPALTEN_OHNE_PDF`, `createTurnier`, `updateTurnier`, `importiereTurnierDaten`, `dupliziereTurnier`: die zwei neuen Felder; `validiereZahlungsdaten` nach E3 — neue Signatur `async validiereZahlungsdaten(knex, { startgeld, iban, kontoinhaber, verwendungszweck, vereinId })`, Meldung bei fehlendem Konto unverändert „Wenn ein Startgeld verlangt wird, müssen IBAN, Kontoinhaber und Verwendungszweck ausgefüllt sein.“ am Hallen-Server bzw. in der Cloud „Wenn ein Startgeld verlangt wird, braucht es IBAN und Kontoinhaber im Turnier oder in den Abrechnungsdaten des Vereins.“), `src/controllers/zahlwegController.js` (`lese` liefert zusätzlich `empfaenger: { kontoinhaber, iban, verwendungszweck } | null` nur wenn der eigene Zahlweg `ueberweisung` ist, über `ermittleZahlungsempfaenger`), `public/js/teilnehmer.js` (Girocode-Knopf nimmt `empfaenger`, wenn die Turnierfelder leer sind)
- Test: `tests/unit/turnierZahlungsfelder.test.js` (Controller-Funktionen im Cloud-Modus), `tests/unit/zahlwegRoutes.test.js` (erweitern)

**Interfaces:**
- Consumes: Task 3 (`GET/PUT /api/abrechnung/stammdaten/:vereinId`, `stammdaten-pruefung`, `ermittleZahlungsempfaenger`, `ladeStammdaten`).
- Produces: Turnier-API liest/schreibt `zahlungsziel_tage` (400 „Das Zahlungsziel muss zwischen 1 und 90 Tagen liegen.“) und `rechnung_hinweis` (400 über 1000 Zeichen); Export/Import/Duplizieren tragen beide.
- [ ] **Step 1: Failing tests:** Cloud: Turnier mit Startgeld 8, ohne Turnier-IBAN, Verein mit Stammdaten-IBAN → Anlegen 201; ohne Stammdaten → 400 mit der Cloud-Meldung; Turnier ohne Verwendungszweck → 201. Einzelbenutzerbetrieb: alte Pflicht unverändert. `zahlungsziel_tage: 0` → 400, `30` gespeichert, ohne Angabe 14. `GET /api/zahlweg/:id` liefert `empfaenger` mit der Vereins-IBAN für einen Überweisungs-Verein, `null` für Bar.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement** Server-Teil.
- [ ] **Step 4:** Tests → PASS; `npx playwright test tests/e2e/startgeld-kasse.spec.js tests/e2e/mehrere-turniere.spec.js tests/e2e/teilnehmer-ohne-startgeld.spec.js` → PASS.
- [ ] **Step 5: Implement** Seite `verein-abrechnung.html` (Felder der Stammdaten, IBAN-Feld leer mit Platzhalter = Maske, Knopf „IBAN entfernen“, Anzeige „Nächste Rechnungsnummer: JCK-00001“ schreibgeschützt; Seite mit `menu.js`), Profil-Link, Startgeld-Block. Manueller Check im Cloud-Modus (`BETRIEBSMODUS=cloud`, lokales PostgreSQL, `ZAHLUNGSDATEN_SCHLUESSEL` gesetzt): Admin pflegt Stammdaten, Turnierformular zeigt danach keinen Kasten mehr; ein Benutzer sieht den Hinweis ohne Link.
- [ ] **Step 6: Commit** `git commit -m "Abrechnung: Stammdaten-Seite, Startgeld-Block, Zahlungsziel und Hinweistext"`

### Task 5: Hallen-Server: Rechnungsdaten vor Ort, Kassenjournal, vollständige Exportdatei

**Files:**
- Modify: `src/services/zahlwege.js` (`kassiereBar` schreibt eine Zeile in `turnier_barzahlungen`), `src/services/zahlwegTransfer.js`, `src/controllers/zahlwegController.js`, `src/routes/zahlwegRoutes.js`, `src/controllers/turnierController.js` (`baueTurnierExport`, `importiereTurnierDaten`), `public/js/teilnehmer.js` + `public/teilnehmer.html` (Kassendialog: Knopf „Rechnungsdaten erfassen“ bei Einträgen `ohneZahlweg`; nach dem Anlegen eines Kämpfers eines Vereins ohne Zahlweg bei Startgeld > 0 am Hallen-Server Frage „Neuer Verein: Rechnungsdaten jetzt erfassen?“ mit „Später an der Kasse“), `public/js/zahlwegDialog.js` (`window.ZahlwegDialog.erfasseVorOrt(turnierId, vereinName): Promise<'gespeichert'|'abgebrochen'>`)
- Test: `tests/unit/zahlwegeService.test.js`, `tests/unit/zahlwegTransfer.test.js` (erweitern), `tests/e2e/startgeld-kasse.spec.js` (Kassen-Teil erweitern)

**Interfaces:**
- Consumes: `pruefeZahlwegEingabe`, `ladeKasse`, `synchronisiereGesichert` (Stufe 1).
- Produces:
  - `erfasseVorOrt(knex, { turnier, vereinName, eingabe }): Promise<Zeile>` in `zahlwege.js` — nur wenn der Verein auf der Kassenliste als `ohneZahlweg` steht (sonst `FachFehler(400, 'Für diesen Verein gibt es schon einen Zahlweg.')`), Zahlweg immer `bar`, `geaendert_von = null`; keine Anmeldeschluss-Prüfung
  - `POST /api/zahlweg/:turnierId/vor-ort` Body `{ vereinName, rechnung_email, rechnung_ansprechperson, rechnung_anschrift }` → `{ success: true, zahlweg }`, über `requireTournamentEditAccess` (Hallen-Server: jeder; Cloud: Ausrichter-Mitglied)
  - `kassiereBar` liefert weiter die Anzahl und legt bei Anzahl > 0 `{ uid: crypto.randomUUID(), turnier_id, verein_name, anzahl, betrag_cent: anzahl × startgeld × 100 }` an
  - `zahlwegTransfer.js`: `pruefeTransferZeile(z): object|null` (die bisherige Zeilenprüfung aus `ersetzeZahlwege` herausgelöst), `exportiereBarzahlungen(knex, turnierId): Promise<Array<{uid, verein_name, anzahl, betrag_cent, kassiert_am}>>`, `uebernehmeBarzahlungen(trx, turnierId, liste): Promise<number>` (ungültige Zeilen verwerfen, `onConflict('uid').ignore()`)
  - Exportdatei: neue Felder `barzahlungen` und `anzahl: { kampfflaechen, pools, teilnehmer, kaempfe, mannschaften, mannschaft_mitglieder }` (Längen der Listen); `importiereTurnierDaten` übernimmt `barzahlungen`
- [ ] **Step 1: Failing tests:** `erfasseVorOrt` für „JC Neu“ (ohne Zeile) legt eine Bar-Zeile an, zweiter Aufruf 400, Aufruf für einen Überweisungs-Verein 400, für den Ausrichter 400; `kassiereBar` für „JC B“ mit 3 offenen Kämpfern bei Startgeld 8 legt eine Journalzeile mit `betrag_cent 2400` an, ein zweiter Aufruf (0 offen) keine; Export enthält `barzahlungen` und `anzahl.teilnehmer` = Länge von `teilnehmer`; Import übernimmt die Barzahlungen, doppelter Import derselben `uid` legt keine zweite Zeile an. E2E: Kasse am Offline-Server, Verein ohne Zahlweg → „Rechnungsdaten erfassen“ → Eintrag zeigt danach Zahlweg „Bar“.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `node --test tests/unit/` und `npx playwright test tests/e2e/startgeld-kasse.spec.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: Rechnungsdaten vor Ort, Kassenjournal, vollständige Exportdatei"`

### Task 6: Zurückspielen in der Cloud (Service, Schutz der Zahlungsdaten, Admin + 2FA)

**Files:**
- Create: `src/services/rueckspielen.js`, `src/utils/sensibleAktion.js`
- Modify: `src/controllers/turnierController.js` (`importTurnierErgebnisse` wird ein dünner Handler um `spieleTurnierZurueck`), `src/controllers/authController.js` (`baueAnmeldeAntwort(knex, user, { zweiFaktorAm = null } = {})` schreibt bei gesetztem Wert den Claim `zf` (Unix-Sekunden) ins JWT; `zweiFaktorPruefen` und `zweiFaktorEinrichtungBestaetigen` übergeben `Date.now()`), `public/js/turnier.js` (Upload-Knopf: bei 403 mit `code: 'zwei_faktor'` den Code abfragen und mit Header `X-2FA-Code` wiederholen; Hinweistext „ersetzt Teilnehmer, Pools, Matten und Kämpfe; Zahlungsdaten und Rechnungen bleiben unverändert“)
- Test: `tests/unit/rueckspielen.test.js` (Cloud-Modus, echte Route `/api/turniere/:id/import-ergebnisse` über `getTurnierRoutes`), `tests/unit/sensibleAktion.test.js`

**Interfaces:**
- Consumes: `importWettkampfdaten`, `ermittleEffektivenStatus`, `turnierHatEchteKaempfe`, `synchronisiereGesichert`, `pruefeTransferZeile`/`uebernehmeBarzahlungen` (Task 5), `pruefeCodeFuerAktion`/`zweiFaktorPflicht` (`zweiFaktor.js`).
- Produces:
  - `pruefeSensibleAktion(knex, req, { frischeAnmeldungGenuegt = false } = {}): Promise<{ ok: true } | { ok: false, status: 403, code: 'zwei_faktor', error: string }>` — nur für `super_admin_aktiv`; ohne `zweiFaktorPflicht()` immer ok; mit `frischeAnmeldungGenuegt` reicht `req.user.zf` ≤ 600 s alt; sonst `pruefeCodeFuerAktion(knex, req.user.id, req.get('x-2fa-code'))`
  - `spieleTurnierZurueck(knex, { turnierId: number, daten: object, benutzer }): Promise<{ turnierId, imported: {kampfflaechen, pools, teilnehmer, kaempfe}, neueVereine: number, barzahlungen: number }>` — Prüfungen in dieser Reihenfolge, jede als `FachFehler`: 404 Turnier; 403 Rolle (E6); 400 `turnier.id` fehlt; 400 fremdes Turnier (`urspruengliche_id ?? id` ≠ `turnierId`, Meldung wie bisher); 400 „Die Datei ist unvollständig.“, wenn `anzahl` vorhanden und eine Listenlänge abweicht oder `teilnehmer`/`pools`/`kaempfe`/`kampfflaechen` keine Arrays sind; 403 Status: erlaubt `anmeldung_geschlossen`, `in_durchfuehrung` sowie `abgeschlossen` nur mit gesetztem `zurueckgespielt_am`; 409 „Für dieses Turnier wurden schon Rechnungen versandt. Erneutes Zurückspielen muss ein Admin auf der Abrechnungsseite freigeben.“ (E7). In einer Transaktion: Wettkampfdaten löschen/einfügen wie bisher; `uebernehmeNeueZahlwege(trx, turnierId, daten.zahlwege)` (nur Vereinsnamen ohne bestehende Zeile, nicht Ausrichter, Zahlweg fest `bar`, Zeile über `pruefeTransferZeile`); `uebernehmeBarzahlungen`; `turniere`: `status = 'abgeschlossen'`, `zurueckgespielt_am = now()`, `rueckspielen_freigegeben = false`. Danach `synchronisiereGesichert(knex, turnierId, { statusAbleiten: false })`. Unberührt: `turnier_zahlwege` bestehender Vereine, `rechnungen`, Helferplan, Orga, Urkunden-Vorlagen, Live-Token, alle Turnier-Stammfelder.
  - `uebernehmeNeueZahlwege(trx, turnierId, zahlwege): Promise<number>` (exportiert aus `rueckspielen.js`)
  - `importTurnierErgebnisse` ruft vor dem Service `pruefeSensibleAktion(…, { frischeAnmeldungGenuegt: true })` und bildet `FachFehler` als `{ success: false, error, code }` ab
- [ ] **Step 1: Failing tests** (Cloud-Turnier mit Startgeld, Zahlweg-Zeilen „JC A“ Überweisung und „JC B“ Bar, Hallen-Datei aus `baueTurnierExport` eines importierten Turniers mit `urspruengliche_id`): Admin spielt zurück → 200, Teilnehmer ersetzt, Status `abgeschlossen`, `zurueckgespielt_am` gesetzt; Datei ändert „JC A“ auf Bar und bringt „JC Neu“ (Überweisung) mit → „JC A“ bleibt Überweisung mit Cloud-Rechnungsdaten, „JC Neu“ steht als Bar da; `startgeld_bezahlt` der Bar-Kämpfer kommt mit; Barzahlungen übernommen; Rolle `benutzer` → 403; Datei eines anderen Turniers → 400; `anzahl.teilnehmer` falsch → 400 und nichts gelöscht; zweites Rückspielen ohne Rechnungen → 200; nach einer Rechnung mit `versandt_am` → 409, Teilnehmerzahl unverändert; mit `rueckspielen_freigegeben = true` → 200 und Flag wieder false. Super-Admin im Modus mit `SUPER_ADMIN_2FA` aktiv: Token ohne `zf` und ohne Header → 403 `code: 'zwei_faktor'`; Token mit `zf` = jetzt → 200; mit `zf` vor 11 Minuten → 403. `sensibleAktion.test.js`: Nicht-Super-Admin immer ok; `frischeAnmeldungGenuegt: false` ignoriert `zf`.
- [ ] **Step 2:** `node --test tests/unit/rueckspielen.test.js tests/unit/sensibleAktion.test.js` → FAIL.
- [ ] **Step 3: Implement.** Die bestehenden Kommentare zu Mannschaften in `importTurnierErgebnisse` wandern mit in den Service.
- [ ] **Step 4:** Tests → PASS; `node --test tests/unit/` (u. a. `zahlwegTransfer.test.js`, `zweiFaktor.test.js`) → PASS.
- [ ] **Step 5:** `AKTIONEN` in `aktionsProtokoll.js`: `'POST /api/turniere/:id/import-ergebnisse': ['turnier.zurueckspielen', 'Turnier in die Cloud zurückgespielt']`.
- [ ] **Step 6: Commit** `git commit -m "Abrechnung: Zurückspielen in die Cloud schützt Zahlungsdaten und Rechnungen"`

### Task 7: Direktweg vom Hallen-Server („Turnier in die Cloud zurückspielen“)

**Files:**
- Create: `public/js/rueckspielDialog.js`
- Modify: `src/services/cloudZugriff.js`, `src/routes/cloudRoutes.js`, `public/turniere.html` (Knopf „In die Cloud zurückspielen“ an der Karte des lokalen Turniers, nur wenn `urspruengliche_id` gesetzt und `/api/cloud/status` `verfuegbar` meldet), `tests/helpers/fake-cloud.mjs` (2FA-Login und `POST /api/turniere/:id/import-ergebnisse` mitschreiben, Abfrage `GET /test/rueckspiel`)
- Test: `tests/unit/cloudZugriff.test.js` (erweitern), `tests/e2e/turnier-zurueckspielen.spec.js` (Muster `tests/e2e/turnier-aus-cloud-holen.spec.js`)

**Interfaces:**
- Consumes: `baueTurnierExport` (enthält ab Task 5 `anzahl`, `barzahlungen`, `zahlwege`), Cloud-Endpunkt aus Task 6.
- Produces:
  - `cloud.meldeAn(email, password, { code = null } = {})`: antwortet die Cloud mit `zweiFaktor: 'pruefen'`, folgt mit Code `POST /api/auth/2fa/pruefen { zwischenToken, code }`; ohne Code `FachFehler(422, 'Bitte den Code der Authenticator-App eingeben.', { code: 'zwei_faktor' })`; bei `zweiFaktor: 'einrichtung'` `FachFehler(409, 'Bitte die Zwei-Faktor-Anmeldung zuerst in der Cloud einrichten.')`
  - `cloud.spieleZurueck(token, cloudTurnierId, daten, { code = null } = {}): Promise<object>` — `POST /api/turniere/:id/import-ergebnisse` mit `{ contentBase64 }`, optional Header `X-2FA-Code`, Zeitlimit `EXPORT_TIMEOUT_MS`
  - `POST /api/cloud/turniere` akzeptiert zusätzlich `code` und reicht bei 2FA-Bedarf `{ success: false, zweiFaktor: true, error }` mit 422 durch
  - `POST /api/cloud/turniere/:cloudId/zurueckspielen` Body `{ token }` → sucht das lokale Turnier mit `urspruengliche_id = cloudId` (jüngstes; sonst 404 „Zu diesem Cloud-Turnier gibt es hier kein Turnier.“), baut den Export, sendet ihn, antwortet `{ success: true, …Antwort der Cloud }`; Cluster-Secondary → 409 (wie `/status` über `holeCluster().darfSchreiben()`)
  - `window.RueckspielDialog.oeffne(lokalesTurnier)` — Anmeldung (E-Mail, Passwort, Feld „Code (nur Super-Admins)“ erscheint nach 422 `zweiFaktor`), Bestätigung mit den Zählern, Ergebnisanzeige; Reserve-Hinweis: „Ohne Verbindung: Turnier exportieren und in der Cloud unter ‚Ergebnisse hochladen‘ einspielen“
- [ ] **Step 1: Failing tests:** Unit (`fetchFn`-Attrappe): Login mit `zweiFaktor:'pruefen'` ohne Code → 422 `code 'zwei_faktor'`; mit Code ruft `/api/auth/2fa/pruefen` und liefert das Token; `spieleZurueck` sendet Base64 der JSON-Datei und den Header nur, wenn `code` gesetzt ist. E2E (Offline-Server + Fake-Cloud Port 3190): Turnier holen, einen Kämpfer anlegen, „In die Cloud zurückspielen“ → Fake-Cloud hat eine Datei mit `turnier.urspruengliche_id` = Cloud-ID, `anzahl.teilnehmer` = Zahl der lokalen Teilnehmer und ohne `live_token`; Meldung „zurückgespielt“ sichtbar.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `node --test tests/unit/cloudZugriff.test.js` und `npx playwright test tests/e2e/turnier-zurueckspielen.spec.js tests/e2e/turnier-aus-cloud-holen.spec.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: Turnier vom Hallen-Server in die Cloud zurückspielen"`

### Task 8: Abrechnungsübersicht und Auflösen von „Nicht zugeordnet“

**Files:**
- Create: `src/services/abrechnung.js`
- Modify: `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`
- Test: `tests/unit/abrechnungUebersicht.test.js` (Cloud-Modus, Routen)

**Interfaces:**
- Consumes: `zaehleKaempferJeVerein`, `rechnungsAnzeigeStatus`, `heuteBerlin` (Task 2), `pruefeStammdatenFuerTurnier` (Task 3), `requireTurnierAdmin` (Task 3), `erfasseVorOrt` (Task 5).
- Produces:
  - `ermittleAbrechnungsBereitschaft(knex, turnier): Promise<{ bereit: boolean, grund: string|null }>` (E5; Gründe: „Das Turnier wurde noch nicht vom Hallen-Server zurückgespielt.“, „Für dieses Turnier wird kein Startgeld erhoben.“)
  - `ladeAbrechnung(knex, turnier): Promise<{ bereit, grund, basis, startgeldCent, stammdaten: {vollstaendig, fehlt}, vereine: VereinsZeile[], nichtZugeordnet: Array<{ vereinName, anzahl }>, summeCent }>`; `VereinsZeile = { vereinName, zahlweg, anzahl, bezahltAnzahl, betragCent, rechnungEmail, rechnung: { id, nummer, art, status, anzeigeStatus, versandt_am, bezahlt_am, versand_fehler } | null }` — Vereine mit Zahlweg-Zeile; ohne Zeile (und nicht Ausrichter) → `nichtZugeordnet`; Vereine mit Anzahl 0 erscheinen mit Betrag 0 und bekommen keine Rechnung
  - `ordneVereinZu(knex, turnierId, { vonVereinName, zuVereinName }): Promise<number>` — setzt `turnier_teilnehmer.verein` des Turniers von → zu (Ziel muss eine Zahlweg-Zeile haben; Quelle darf keine haben), danach `synchronisiereGesichert(…, { statusAbleiten: false })`; Anzahl geänderter Kämpfer
  - Routen (alle `requireTurnierAdmin`): `GET /api/abrechnung/:turnierId` → `ladeAbrechnung`; `POST /api/abrechnung/:turnierId/zuordnen { vonVereinName, zuVereinName }` → `{ success, anzahl }`; `POST /api/abrechnung/:turnierId/rechnungsdaten { vereinName, rechnung_email, rechnung_ansprechperson, rechnung_anschrift }` → `erfasseVorOrt` (neuer Verein, Bar); `POST /api/abrechnung/:turnierId/rueckspielen-freigeben` → setzt `rueckspielen_freigegeben = true` (400, wenn keine versandte Rechnung existiert)
- [ ] **Step 1: Failing tests:** nicht zurückgespielt → `bereit: false` mit Grund; nach `zurueckgespielt_am` → Vereine „JC A“ (Überweisung, 2 Kämpfer, 1600 Cent), „JC B“ (Bar, 3, bezahlt 3), `nichtZugeordnet` = „JC Köln e.V“ (1); Basis `teilnahme_waage` zählt nur Gewogene; Cloud-Live-Turnier mit `beendet_am` und ohne `auf_hallen_server_geholt_am` → bereit; `zuordnen` von „JC Köln e.V“ zu „JC Köln e.V.“ verschiebt den Kämpfer, danach leer; `zuordnen` in einen Verein ohne Zeile → 400; Rolle `benutzer` des Ausrichters → 403; Super-Admin im Modus → 200; `rueckspielen-freigeben` ohne versandte Rechnung → 400.
- [ ] **Step 2:** `node --test tests/unit/abrechnungUebersicht.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** `AKTIONEN` ergänzen: `POST /api/abrechnung/:id/zuordnen` → `['abrechnung.zuordnen', 'Kämpfer einem meldenden Verein zugeordnet']`, `…/rechnungsdaten` → `['abrechnung.rechnungsdaten', 'Rechnungsdaten eines Vereins erfasst']`, `…/rueckspielen-freigeben` → `['abrechnung.rueckspielfreigabe', 'Erneutes Zurückspielen freigegeben']`, `PUT /api/abrechnung/stammdaten/:id` → `['abrechnung.stammdaten', 'Abrechnungsdaten des Vereins geändert']`; `RESSOURCEN.abrechnung = 'Abrechnung'`.
- [ ] **Step 6: Commit** `git commit -m "Abrechnung: Übersicht je Verein und Auflösen nicht zugeordneter Kämpfer"`

### Task 9: Rechnungs-PDF

**Files:**
- Create: `src/services/pdfQr.js` (die Funktion `zeichneQr` aus `helferAusweis.js` hierher verschieben und exportieren; `helferAusweis.js` importiert sie), `src/services/rechnungPdf.js`
- Test: `tests/unit/rechnungPdf.test.js`, `tests/unit/helferAusweis.test.js` (muss grün bleiben)

**Interfaces:**
- Produces:
  - `zeichneQr(seite, inhalt: string, x: number, y: number, groesse: number): void` (`pdfQr.js`, Fehlerkorrektur `M`)
  - `baueRechnungsZeilen(daten: RechnungsDaten): { kopf: string[], empfaenger: string[], positionen: Array<{ text: string, betrag: string }>, summen: Array<{ text: string, betrag: string }>, zahlung: string[], fuss: string[] }` — reine Funktion, deutsche Beträge `24,00 €`, Datum `TT.MM.JJJJ`
  - `erzeugeRechnungPdf(daten: RechnungsDaten): Promise<Uint8Array>` — A4, NotoSans, Titel-Metadatum `Rechnung <Nummer>` bzw. `Quittung <Nummer>`, Folgeseiten bei langen Kämpferlisten, Girocode (40 mm) bei offenem Betrag und vorhandener `zahlung.iban`
  - `RechnungsDaten = { art, nummer, rechnungsdatum, leistungsdatum, zahlungszielDatum|null, turnierBezeichnung, aussteller: { name, anschrift, rechnung_email, steuernummer, ust_id, ust_hinweis }, empfaenger: { name, ansprechperson, anschrift }, kaempfer: string[], anzahl, einzelpreisCent, betragCent, barErhaltenCent, zahlweg, zahlung: { kontoinhaber, iban, verwendungszweck } | null, hinweis|null }`
- Inhalt (Pflichtangaben, Spec Festlegung 9): Aussteller mit Anschrift, Steuernummer oder USt-IdNr., Empfänger, Rechnungsnummer, Rechnungsdatum, Leistungszeitpunkt (Turnierdatum), Leistung „Startgeld <Turnier>: <Anzahl> Kämpfer à <Preis>“, Kämpferliste, Gesamtbetrag, Umsatzsteuer-Hinweistext, Hinweistext. Überweisung: Kontoinhaber, IBAN (formatiert), Verwendungszweck, „zahlbar bis <Datum>“. Bar und alles bezahlt: „Betrag bar erhalten am <Datum>.“ Bar teilweise: Zeilen „bar erhalten“ und „offen“ plus Überweisungsangaben über den Rest.
- [ ] **Step 1: Failing tests:** `baueRechnungsZeilen` für Überweisung (3 × 8 €) enthält `24,00 €`, die formatierte IBAN, den Verwendungszweck und `zahlbar bis 15.11.2026`; Quittung enthält „bar erhalten“ und keine IBAN; Bar teilweise (3 Kämpfer, 1 bezahlt) zeigt `offen 16,00 €`; `erzeugeRechnungPdf` mit 120 Kämpfern hat ≥ 2 Seiten (`PDFDocument.load(bytes).getPageCount()`), Titel `Rechnung JCK-00001`; Text mit einem Zeichen außerhalb der Schrift (z. B. `\u{1F600}`) wirft nicht.
- [ ] **Step 2:** `node --test tests/unit/rechnungPdf.test.js` → FAIL.
- [ ] **Step 3: Implement** (Zeichenbereinigung über `bereinigeText` aus `helferAusweis.js`).
- [ ] **Step 4:** `node --test tests/unit/rechnungPdf.test.js tests/unit/helferAusweis.test.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: Rechnungs-PDF mit Girocode"`

### Task 10: Rechnungslauf, Mailversand und Zahlstatus

**Files:**
- Create: `src/services/rechnungslauf.js`
- Modify: `src/utils/mailer.js`, `src/controllers/abrechnungController.js`, `src/routes/abrechnungRoutes.js`, `src/services/aktionsProtokoll.js`
- Test: `tests/unit/rechnungslauf.test.js` (Cloud-Modus, `setzeTestVersand`), `tests/unit/mailer.test.js` (neu)

**Interfaces:**
- Consumes: Tasks 2, 3, 8, 9 (`ladeAbrechnung`, `ermittleZahlungsempfaenger`, `formatiereRechnungsnummer`, `baueVerwendungszweck`, `addiereTage`, `heuteBerlin`, `rechnungsArt`, `erzeugeRechnungPdf`).
- Produces:
  - `sendeMail({ to, subject, text, replyTo = null, absenderName = null, anhaenge = [] }): Promise<{ versendet: boolean, grund: 'kein_smtp'|'fehler'|null }>` — `anhaenge` = `[{ dateiname, inhalt: Buffer|Uint8Array, typ }]` → nodemailer `attachments`; `absenderName` ersetzt den Anzeigenamen in `SMTP_FROM` (Adresse bleibt); `setzeTestVersand` erhält das ganze Objekt; Rückgabe des Testversands: `{ versendet: true }`, wenn die Funktion nichts zurückgibt
  - `erstelleRechnungen(knex, { turnier, benutzerId, sende = sendeMail }): Promise<{ erstellt: number, versendet: number, fehler: Array<{ vereinName, grund }> }>` — Vorbedingungen (je `FachFehler(409)`): bereit, Stammdaten vollständig, `nichtZugeordnet` leer, Zahlungsempfänger lesbar (bei Bar-Quittungen nicht nötig). Je Verein mit Anzahl > 0 und ohne aktive Rechnung: Transaktion mit `pg_advisory_xact_lock(turnierId)` + `SELECT … FROM vereins_abrechnung … FOR UPDATE` → Nummer, Insert (Momentaufnahmen, `zahlungsziel_datum = addiereTage(rechnungsdatum, turnier.zahlungsziel_tage)` außer bei Quittung, Quittung mit `status 'bezahlt'` und `bezahlt_am` = jüngstes `kassiert_am` des Vereins oder jetzt), PDF erzeugen und speichern, Zähler +1; nach dem Commit Mail (Betreff `Rechnung <Nummer> – <Turnier>` bzw. `Quittung …`, Anhang `<Nummer>.pdf`, `replyTo` = Rechnungs-E-Mail des Ausrichters, `absenderName`) → `versandt_am`, `status` `versandt` (Quittung bleibt `bezahlt`) bzw. `versand_fehler`
  - `sendeRechnungErneut(knex, rechnungId, { sende }): Promise<{ versendet: boolean }>`
  - `setzeBezahlt(knex, rechnungId, { bezahlt: boolean, benutzerId }): Promise<Rechnung>` — `bezahlt` → `status 'bezahlt'`, `bezahlt_am`, `bezahlt_von`; zurück → `versandt` (bzw. `offen` ohne `versandt_am`)
  - Routen (`requireTurnierAdmin`; Rechnungs-ID muss zum Turnier gehören, sonst 404): `POST /api/abrechnung/:turnierId/rechnungen` → Ergebnis von `erstelleRechnungen`; `POST …/rechnungen/:rechnungId/senden`; `POST …/rechnungen/:rechnungId/bezahlt { bezahlt }`; `GET …/rechnungen/:rechnungId/pdf` (application/pdf, `Content-Disposition: attachment; filename="<Nummer>.pdf"`)
  - `AKTIONEN`: `…/rechnungen` → `['abrechnung.rechnungslauf', 'Rechnungen erstellt und versendet']`, `…/senden` → `['abrechnung.senden', 'Rechnung erneut versendet']`, `…/bezahlt` → `['abrechnung.bezahlt', 'Zahlstatus einer Rechnung geändert']`
- [ ] **Step 1: Failing tests:** Lauf mit „JC A“ (Überweisung), „JC B“ (Bar, alles bezahlt), „JC C“ (Überweisung, 0 Kämpfer bei Basis Waage): 2 Rechnungen, Nummern `JCK-00001`/`JCK-00002`, Zähler danach 3; „JC B“ ist `quittung`/`bezahlt`; Testversand bekommt 2 Mails mit PDF-Anhang an die Rechnungs-E-Mails, Reply-To des Ausrichters; zweiter Lauf erstellt nichts; Testversand wirft bei „JC A“ → Rechnung `offen` mit `versand_fehler`, `senden` setzt danach `versandt`; zwei parallele Läufe (`Promise.all`) → insgesamt 2 Rechnungen, keine doppelte Nummer; `nichtZugeordnet` nicht leer → 409; Stammdaten unvollständig → 409; `bezahlt` setzt Status, Anzeige `ueberfaellig` bei versandt + Zahlungsziel gestern; `aktionsprotokoll.details` und alle Konsolenausgaben des Tests enthalten keine IBAN (Konsole per Spy auf `console.*` prüfen). `mailer.test.js`: ohne SMTP liefert `sendeMail` `{ versendet: false, grund: 'kein_smtp' }`; Testversand bekommt `anhaenge`.
- [ ] **Step 2:** `node --test tests/unit/rechnungslauf.test.js tests/unit/mailer.test.js` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Tests → PASS; `node --test tests/unit/` → PASS (bestehende Mailer-Aufrufer unverändert).
- [ ] **Step 5: Commit** `git commit -m "Abrechnung: Rechnungslauf mit lückenlosen Nummern, Mailversand und Zahlstatus"`

### Task 11: Abrechnungsseite

**Files:**
- Create: `public/abrechnung.html`, `public/js/abrechnung.js`
- Modify: `public/turnier.html` + `public/js/turnier.js` (Knopf „Abrechnung“ nur Cloud, Startgeld > 0, Rolle Admin des Ausrichters bzw. Super-Admin), `public/js/menu.js` (`MENUE_AKTIVE_SEITEN`: `abrechnung.html` hebt „Turniere“ hervor)
- Test: manueller Browsercheck (die E2E-Suite läuft im Einzelbenutzerbetrieb, die Fachlogik ist in Tasks 8 und 10 getestet)

**Interfaces:**
- Consumes: alle `/api/abrechnung/:turnierId…`-Routen aus Tasks 8 und 10, `rechnungsAnzeigeStatus` über `/js/shared/abrechnung.js`.
- Produces: Seite `abrechnung.html?turnierId=` — oben Bereitschaft (Grund bei `bereit: false`), fehlende Stammdaten mit Link, Kennzahlen (Summe, versandt, bezahlt, überfällig); Tabelle je Verein (Verein, Zahlweg, Anzahl, Betrag, Status-Chip, Aktionen PDF / Erneut senden / Bezahlt-Haken); Abschnitt „Nicht zugeordnet“ mit „Zu Verein … zuordnen“ (Auswahl der Vereine mit Zahlweg) und „Rechnungsdaten erfassen“ (Dialog aus `zahlwegDialog.js`, Ziel `/api/abrechnung/:turnierId/rechnungsdaten`); Knopf „Rechnungen erstellen“ (gesperrt mit Begründung, solange Vorbedingungen fehlen; Bestätigungsdialog mit Anzahl und Summe; Ergebnis mit Fehlern je Verein); Knopf „Erneutes Zurückspielen freigeben“ nur bei versandten Rechnungen.
- [ ] **Step 1: Implement** Seite und Knopf.
- [ ] **Step 2: Manueller Check** im Cloud-Modus (`BETRIEBSMODUS=cloud`, lokales PostgreSQL, `ZAHLUNGSDATEN_SCHLUESSEL`, ohne `SMTP_HOST` → Mails nur geloggt): Turnier mit drei Vereinen, `zurueckgespielt_am` per SQL setzen, einen Verein ohne Zeile anlegen; Seite zeigt „Nicht zugeordnet“, Knopf gesperrt; nach Zuordnung „Rechnungen erstellen“ → Rechnungen mit Status `offen` (kein SMTP), PDF öffnet sich mit Girocode, „Bezahlt“ setzt den Chip. Ansicht in Handybreite ohne waagerechtes Scrollen.
- [ ] **Step 3: Commit** `git commit -m "Abrechnung: Seite je Turnier"`

### Task 12: Datenschutz, Betrieb, Dokumentation und Gesamtlauf

**Files:**
- Modify: `src/services/rechtstexte.js` (`rendereDatenschutz`: Abschnitt „Startgeld-Abrechnung“: Rechnungsdaten der meldenden Vereine, Bankverbindung des Ausrichters verschlüsselt, Rechnungen 8 Jahre, Versand per E-Mail), `tests/unit/rechtliches.test.js` (prüft den Abschnitt), `docs/datenschutz/verarbeitungsverzeichnis.md` (Teil B: Verarbeitung „Startgeld-Abrechnung“ mit Datenkategorien, Empfängern, Fristen; Änderungsprotokoll), `docs/datenschutz/toms-und-loeschkonzept.md` (Vertraulichkeit: Feldverschlüsselung `ZAHLUNGSDATEN_SCHLUESSEL`, IBAN-Schwärzung; Löschkonzept: Rechnungen 8 Jahre ab Ende des Kalenderjahres, manuelle Löschung, Barzahlungs-Journal mit dem Turnier; bekannte Lücke: keine automatische Löschung der Rechnungen), `docs/datenschutz/README.md` (Checkliste), `docs/betrieb.md` (Variable `ZAHLUNGSDATEN_SCHLUESSEL`: Pflicht für IBAN-Funktionen, getrennt von den Sicherungen verwahren — ohne ihn sind gesicherte IBANs unbrauchbar; SMTP für Rechnungen), `CLAUDE.md` (Domänenmodell: `vereins_abrechnung`, `rechnungen`, `turnier_barzahlungen`, neue Turnierfelder; Architektur: Abschnitt „Startgeld-Rechnungen (Stufe 2)“ mit Spec/Plan, Entscheidungen E1–E14 in Kurzform, Tests)

- [ ] **Step 1:** Texte und Test ergänzen; `node --test tests/unit/rechtliches.test.js` → PASS.
- [ ] **Step 2:** `npm run ci:lokal` → grün (Unit + E2E); Fehler beheben, nicht überspringen.
- [ ] **Step 3: Commit** `git commit -m "Abrechnung: Datenschutz, Betrieb und Dokumentation"`

---

## Selbstprüfung (Spec-Abdeckung Stufe 2)
- Stammdaten (Anschrift, E-Mail/Absender, Steuernummer/USt-Id, USt-Hinweis, Präfix mit lückenlosem Zähler, Kontoinhaber + IBAN verschlüsselt/maskiert), nur Admin, erst bei Bedarf mit Nennung des Fehlenden → Tasks 2–4. Turnier-IBAN mit Vorrang → Task 3/4 (E3).
- Turnierfelder Zahlungsziel, Hinweistext → Task 4.
- Zurückspielen direkt (Cloud-Login, 2FA für Super-Admins) und per Datei, selektives Ersetzen, Barzahlungen und neue Vereine, Prüfungen (gleiches Turnier, Admin, vollständige Datei, Sperre nach Versand mit Freigabe) → Tasks 5–7, 8 (Freigabe).
- Abrechnungsseite erst nach dem Zurückspielen, je Verein Zahlweg/Anzahl nach Basis/Betrag/Status, „Nicht zugeordnet“ → Tasks 8, 11.
- Rechnungen: PDF, Mail, Überweisung mit IBAN/Verwendungszweck/Zahlungsziel/Girocode, Bar als Quittung oder offene Rechnung, lückenlose Nummern, Status mit „bezahlt“ von Hand und „überfällig“ → Tasks 9, 10.
- Protokoll ohne sensible Inhalte, IBAN-Schwärzung, Datensicherung (erfasst alle Tabellen automatisch, IBAN nur als Chiffretext), Datenschutz-Doku → Tasks 1, 6, 8, 10, 12.
- Nicht in Stufe 2: Lastschrift, Mandat, SEPA-Datei, Rücklastschrift (Stufe 3); Gutschriften, Bankdatei-Import, Zahlungserinnerung (Stufe 4).
