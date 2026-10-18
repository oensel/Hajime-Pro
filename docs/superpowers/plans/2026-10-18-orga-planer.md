# Orga-Planer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkliste für Planung, Vorbereitung und Durchführung eines Turniers mit Unteraufgaben, automatischer Erledigung aus dem Helferplan, Delegation per Mail/Einladung und Erinnerung 3 Tage vor Fälligkeit.

**Architecture:** Reine Logik (Status, Fristen, Vorlage) in `src/shared/`, Datenzugriff in `src/services/orga*.js` mit Knex-DI, Routen als Factories (`getOrgaRoutes(knex)`), Seiten als statisches HTML + Vanilla-JS. Helferplan bekommt `tag_versatz` und die Standarddienste Ersthelfer/Aufbau.

**Tech Stack:** Node ES-Module, Express, Knex/PostgreSQL, `node:test` (Unit), Playwright (E2E), `sendeMail` aus `src/utils/mailer.js`.

**Spec:** `docs/specs/2026-10-18-orga-planer-design.md`

## Global Constraints

- Sentence case, deutsche Oberfläche, Sie-Form in Mails (wie `src/services/registrierung.js`).
- Eingeladene bekommen Rolle `helfer`, nie mehr; Konto entsteht bestätigt und freigegeben.
- Einladungstoken: nur SHA-256 in der DB, 14 Tage, einmal verwendbar.
- Erinnerung: 0 bis 3 Tage vor `faellig_am` (Europe/Berlin), eine Mail je Fälligkeit (`erinnert_fuer`), nicht bei Überfälligkeit.
- `mitbringen`-Einträge zählen nicht für die Erledigung der Elternaufgabe.
- Kein Phasenschalter im Menü, kein Sammelpunkt „Verwaltung“; Helfer und Urkunden-Designer wandern ins Orga-Untermenü.
- Migration `20261018130000_orga_planer.js` mit `export const config = { transaction: false };` wie die Nachbarn.
- Kein Commit ohne Nachfrage des Nutzers (CLAUDE.md-Praxis des Repos); Commit-Schritte hier gelten nur bei ausdrücklicher Freigabe.

## Review Focus

- Turnierdatum/Anmeldeschluss ändert sich nachträglich: nur Aufgaben ohne `faellig_manuell` ziehen nach (Test in Task 3).
- Aufgabe ohne Unteraufgaben und ohne Automatik wird nie „von selbst“ grün (Task 1).
- Helferplan ohne Slots: automatische Aufgabe bleibt offen statt grün (Task 1).
- Einladung zweimal eingelöst / abgelaufen: zweites Mal 400, kein zweites Konto (Task 4).
- E-Mail-Adresse existiert schon als Konto in anderem Verein: wird `helfer` hinzugefügt, kein Duplikat (Task 4).
- Erinnerungsmail schlägt fehl: `erinnert_fuer` bleibt leer, nächster Lauf versucht es erneut (Task 5).
- Helfer versucht fremde Aufgabe abzuhaken: 403 (Task 6).

---

### Task 1: Reine Module (Status, Frist, Vorlage) und Migration

**Files:**
- Create: `src/shared/orgaStatus.js`, `src/shared/orgaFrist.js`, `src/shared/orgaVorlage.js`
- Create: `migrations/20261018130000_orga_planer.js`
- Test: `tests/unit/orgaStatus.test.js`, `tests/unit/orgaFrist.test.js`, `tests/unit/orgaVorlage.test.js`

**Interfaces:**
- Produces: `berechneStatus(aufgabe, kinder, zaehlung) -> { status: 'offen'|'angefangen'|'erledigt', erledigt: number, gesamt: number, quelle: 'manuell'|'unteraufgaben'|'helferplan'|'offen' }` mit `zaehlung = { [auto_ref | 'gesamt']: { belegt, bedarf, slots } }`.
- Produces: `berechneFaelligkeit({ frist_anker, frist_tage }, { turnierdatum, anmeldeschluss }) -> 'YYYY-MM-DD'|null`.
- Produces: `ORGA_VORLAGE: Array<{ vorlage_key, phase, titel, art, frist_anker, frist_tage, auto_art?, auto_ref?, link?, menge?, posten?: Array<{titel, menge?}>, mitbringliste?: true }>`.

- [ ] **Step 1: Failing tests.** `orgaStatus.test.js`: `eltern mit allen Kindern erledigt ist erledigt`; `mitbringen-Kinder zählen nicht`; `Aufgabe ohne Kinder, Automatik und Haken bleibt offen`; `helferplan_taetigkeit grün bei belegt>=bedarf und slots>0`; `slots===0 bleibt offen`; `manueller Haken (erledigt_am) überstimmt Automatik`; `teilweise erledigte Kinder -> angefangen mit 3/9`. `orgaFrist.test.js`: `-56 Tage vor 2027-03-14 ist 2027-01-17`; `Anker anmeldeschluss, fehlend -> Rückfall auf Turniertag`; `ohne Datum null`. `orgaVorlage.test.js`: alle `vorlage_key` eindeutig; jede der fünf Phasen vorhanden; `grundlage` beginnt mit „Hallenzeiten reservieren“ (−240); kein Titel enthält „Mattenwagen“; „Technik bereitstellen“ hat Posten „Mikrofon“, „Lautsprecher“, „Notebooks Matte“, „Mehrfachsteckdosen“, „Verlängerungskabel“, „Urkundenpapier“; Catering hat `mitbringliste`.
- [ ] **Step 2:** `node --test tests/unit/orgaStatus.test.js tests/unit/orgaFrist.test.js tests/unit/orgaVorlage.test.js` → FAIL (Module fehlen).
- [ ] **Step 3: Implementieren** der drei Module (Datumsrechnung mit lokalen Feldern wie `datumAlsText` in `helferPlan.js`, kein `toISOString`). Vorlage nach Spec Abschnitt „Phasen und Vorlage“ inkl. der als Annahme markierten Zusatzposten.
- [ ] **Step 4: Migration.** `orga_aufgaben` und `orga_einladungen` exakt nach Spec „Datenmodell“; `helfer_taetigkeiten.tag_versatz smallint notNullable default 0`; Indizes auf `orga_aufgaben(turnier_id)`, `(eltern_id)`, `(benutzer_id)`, `(email_frei)`; `down` löscht alles wieder.
- [ ] **Step 5:** Unit-Tests erneut ausführen → PASS; `npx knex migrate:latest --knexfile knexfile.cjs --env online` gegen lokales PG (`npm run pg:start`) läuft ohne Fehler.

### Task 2: Helferplan: Ersthelfer, Aufbau, Tag-Versatz

**Files:**
- Modify: `src/services/helferPlan.js` (`synchronisiereStandardTaetigkeiten`, `traegeEin` Überlappung, `ladePlan`, `ladeOffeneSlots`), `src/shared/helferZeit.js` (falls `ueberlappt` erweitert wird), `src/routes/helferPlanRoutes.js` (Verschieben Vortag/Turniertag), `public/js/helferPlan.js`, `src/shared/helferZeitstrahl.js` (Streifen „Vortag“)
- Test: `tests/unit/helferZeit.test.js`, bestehende Helferplan-Tests erweitern, `tests/e2e/helfer-plan*.spec.js` (nur ergänzen)

**Interfaces:**
- Consumes: Migration aus Task 1.
- Produces: Arten `ersthelfer` und `aufbau` in `helfer_taetigkeiten.art`; `aendereTaetigkeit(knex, id, { …, tag_versatz })` akzeptiert `0|-1`; `ladePlan` liefert `tag_versatz` je Tätigkeit; `ART_REIHENFOLGE` erweitert.

- [ ] **Step 1: Failing tests:** `ueberlappt` bzw. Eintragsprüfung rechnet `tag_versatz*1440+min` (Vortag 17:00–19:00 überlappt nicht mit Turniertag 17:00–19:00); `synchronisiereStandardTaetigkeiten` legt „Ersthelfer/Sanitäter“ (Bedarf 1, Schichten über Turnierzeit) sowie „Mattenaufbau“ (Bedarf 4) und „Tribünenaufbau“ (Bedarf 2) mit `tag_versatz=-1`, Slot 17:00–19:00 an, idempotent; Aufbau-Tätigkeiten sind nicht löschbar/umbenennbar wie `matte`, `tag_versatz` änderbar.
- [ ] **Step 2:** Tests ausführen → FAIL.
- [ ] **Step 3: Implementieren** (Vorbild die Matten-/Waagenzweige in `synchronisiereStandardTaetigkeiten`; Fristprüfung bleibt Turniertag 08:00). `helferPlan.js` Kommentarkopf mit den neuen Arten ergänzen.
- [ ] **Step 4:** UI: eigener Streifen „Vortag“ im Zeitstrahl, Knopf „auf Vortag/Turniertag legen“ je Aufbau-/freier Tätigkeit.
- [ ] **Step 5:** `npm run test:unit` und `npx playwright test tests/e2e/helfer-plan*.spec.js` → PASS.

### Task 3: Service `orgaPlan` (CRUD, Vorlage, Neuberechnung, Laden mit Status)

**Files:**
- Create: `src/services/orgaPlan.js`
- Modify: `src/controllers/turnierController.js` (nach Turnier-Anlegen `legeAusVorlageAn`; bei Änderung von `datum`/Anmeldeschluss `berechneFaelligkeitenNeu`)
- Test: `tests/unit/orgaPlan.test.js` (eingebettetes PG über `tests/helpers/testPostgres.js`)

**Interfaces:**
- Produces: `legeAusVorlageAn(knex, turnierId) -> { angelegt }` (idempotent über `vorlage_key`); `ladeOrga(knex, turnierId, { benutzerId? }) -> { phasen: [...], kennzahlen: { erledigt, gesamt, ueberfaellig, ohneZustaendigen } }` (Aufgaben mit `kinder`, `status` aus `berechneStatus`, Helferplan-Zählung per einer Abfrage über `helfer_slots`/`helfer_einsaetze`); `legeAufgabeAn`, `aendereAufgabe` (inkl. `faellig_am` ⇒ `faellig_manuell=true`), `loescheAufgabe`, `setzeErledigt(knex, id, { erledigt, benutzerId })`, `berechneFaelligkeitenNeu(knex, turnierId)`.
- Fehler als `FachFehler` wie in `helferPlan.js`.

- [ ] **Step 1: Failing tests:** Vorlage anlegen ergibt Aufgaben aller Phasen, zweiter Aufruf legt nichts doppelt an; Datumsänderung verschiebt nur Aufgaben ohne `faellig_manuell`; Posten erledigt ⇒ Elternaufgabe `erledigt`; `Kampfrichter besetzt` wird erledigt, wenn alle Kampfrichter-Slots voll sind (Slots/Einsätze direkt per Knex anlegen); Mitbringeintrag ändert den Status der Eltern nicht; Löschen einer Hauptaufgabe löscht Kinder.
- [ ] **Step 2:** `node --test tests/unit/orgaPlan.test.js` → FAIL.
- [ ] **Step 3: Implementieren.** Transaktionen und Sperre `forUpdate` auf dem Turnier wie in `synchronisiereStandardTaetigkeiten`.
- [ ] **Step 4:** Test → PASS.

### Task 4: Zuweisen, Mails, Einladungen

**Files:**
- Create: `src/services/orgaZuweisung.js`, `src/services/orgaEinladung.js`
- Test: `tests/unit/orgaZuweisung.test.js`

**Interfaces:**
- Consumes: `sendeMail`, `findeKontoPerEmail`, `normalisiereEmail` (`registrierung.js`), `hatHelferZugriffAufVerein`.
- Produces: `weiseZu(knex, aufgabeId, { benutzerId } | { name, email? }, { basisUrl, sende? }) -> { modus: 'konto'|'frei'|'einladung' }`; `loeseEinladungEin(knex, token, { password, vorname, nachname }) -> { ok: true, benutzerId, vereinId } | { ok:false, status:400, error }`; `sendeEinladungNeu(knex, aufgabeId, basisUrl, { sende })`; `pruefeEinladung(knex, token) -> { email, vereinName } | null`.

- [ ] **Step 1: Failing tests:** Konto ⇒ Mail mit Link `/helfer.html#aufgaben`; freier Name ohne E-Mail ⇒ keine Mail; freier Name + E-Mail ohne Konto ⇒ Einladungsmail mit `/einladung.html?token=`; Einlösen ⇒ Konto mit `email_bestaetigt_am`, `benutzer_vereine.freigegeben=1`, `rolle='helfer'`, alle offenen Aufgaben dieser Adresse im Verein zeigen auf das neue Konto, Token verbraucht; zweites Einlösen und abgelaufener Token ⇒ `ok:false`; Adresse mit bestehendem Konto in anderem Verein ⇒ Mitgliedschaft `helfer` freigegeben, kein zweites Konto; Passwort < 8 Zeichen ⇒ 400; fehlendes `basisUrl` ⇒ 503-Fehler wie `basisUrl.js`.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implementieren** (Token wie `einmalToken.js`, aber in `orga_einladungen`; Einlösen atomar per `update … whereNull('benutzt_am') returning`).
- [ ] **Step 4:** Tests → PASS.

### Task 5: Erinnerungsjob

**Files:**
- Create: `src/services/orgaErinnerung.js`
- Modify: `src/app.js` (Start per `setInterval` stündlich, nur `bm.istCloud || HELFER_APP_AKTIV==='true'`, `unref()`)
- Test: `tests/unit/orgaErinnerung.test.js`

**Interfaces:**
- Produces: `sendeFaelligeErinnerungen(knex, { jetzt = new Date(), sende = sendeMail, basisUrl }) -> { gesendet: number }`.

- [ ] **Step 1: Failing tests:** Fälligkeit in 3 Tagen ⇒ Mail und `erinnert_fuer=faellig_am`; zweiter Lauf ⇒ keine Mail; Fälligkeit in 4 Tagen ⇒ keine; überfällig ⇒ keine; erledigte oder unzugewiesene ⇒ keine; geänderte Fälligkeit ⇒ erneut; `sende` wirft ⇒ `erinnert_fuer` bleibt null.
- [ ] **Step 2:** FAIL → **Step 3:** implementieren (Tag-Differenz in Europe/Berlin wie `heuteBerlin`) → **Step 4:** PASS.

### Task 6: Routen und Transfer

**Files:**
- Create: `src/routes/orgaRoutes.js` (`getOrgaRoutes(knex)` unter `/api/orga`), `src/routes/orgaHelferRoutes.js` (unter `/api/helfer/orga`: `GET /meine`, `POST /aufgaben/:id/erledigt`, Mitbringliste `POST/PUT/DELETE /mitbringliste`), `src/routes/einladungRoutes.js` (`GET /api/einladung/:token`, `POST /api/einladung/:token`, ratenbegrenzt wie `authRatenbegrenzung.js`), `src/services/orgaTransfer.js`
- Modify: `src/app.js` (Mount; `requireWriteAuth`/`requireRolle(knex,'benutzer')` wie `helferPlanRoutes`), `src/services/helferTransfer.js`-Aufrufstelle des Turnier-Exports/-Imports
- Test: `tests/unit/orgaTransfer.test.js`, `tests/e2e/orga-api.spec.js`

**Interfaces:**
- Consumes: Funktionen aus Task 3–5.
- Produces: `exportiereOrga(knex, turnierId)` / `ersetzeOrga(knex, turnierId, daten)` (Eltern über temporäre Schlüssel, Zuständige nur als `name_frei`/`email_frei`, `erinnert_fuer` verworfen).

- [ ] **Step 1: Failing tests (E2E-API):** Helfer-Rolle darf eigene Aufgabe abhaken, fremde ⇒ 403; Mitbringliste: Helfer kann eigenen Eintrag anlegen/löschen, fremden nicht; Orga-Routen ohne Rolle `benutzer` ⇒ 403; Einladung `GET` liefert nur E-Mail und Vereinsname; Export/Import-Roundtrip erhält Hierarchie und Status.
- [ ] **Step 2:** FAIL → **Step 3:** implementieren und in `app.js` mounten (Helfer-/Einladungsrouten nur Cloud bzw. `HELFER_APP_AKTIV`; `/api/orga` immer) → **Step 4:** `npx playwright test tests/e2e/orga-api.spec.js` PASS.

### Task 7: Seiten `orga.html` und `orga-aufgabe.html`

**Files:**
- Create: `public/orga.html`, `public/js/orga.js`, `public/orga-aufgabe.html`, `public/js/orgaAufgabe.js`, `public/css/orga.css`
- Modify: `src/shared/menueRechte.js` (Seiten den Rollen zuordnen)
- Test: `tests/e2e/orga-planer.spec.js`

**Interfaces:**
- Consumes: `/api/orga` (Task 6); Muster der Seiten `helfer-plan.html` und `helfer.css`; Entwurf aus dem Gespräch (Kennzahlen, Phasenblöcke, Grundlage abgesetzt, Statuspunkt, Zuständiger-Chip mit Dialog, Link-Schlüssel ⇒ URL-Tabelle).

- [ ] **Step 1: Failing E2E:** Turnier anlegen ⇒ Seite zeigt die Vorlage in fünf Phasen; Aufgabe abhaken ⇒ Zähler steigt; „Technik bereitstellen“ öffnen, alle Posten abhaken, zurück ⇒ Aufgabe grün; Zuweisen an freien Namen ⇒ Chip; Filter „Nur meine Aufgaben“; Fälligkeit überfällig rot; „Nach Person“.
- [ ] **Step 2:** FAIL → **Step 3:** Seiten umsetzen, Sentence case, Dark-Mode-Variablen aus vorhandenem CSS → **Step 4:** PASS.

### Task 8: Helfer-App und Einladungsseite

**Files:**
- Create: `public/einladung.html`, `public/js/einladung.js`
- Modify: `public/helfer.html`, `public/js/helfer.js` (Abschnitt „Meine Aufgaben“: Überfällig / Diese Woche / Später, Haken), `public/css/helfer.css`
- Test: `tests/e2e/orga-einladung.spec.js` (Fake-Mail über `setzeTestVersand` aus `mailer.js`)

- [ ] **Step 1: Failing E2E:** Aufgabe an Name+E-Mail ⇒ Test-Mail enthält Link ⇒ Seite zeigt E-Mail vorbelegt ⇒ Registrieren ⇒ Weiterleitung auf `helfer.html`, Aufgabe unter „Meine Aufgaben“, Haken setzt `erledigt`; abgelaufener/verbrauchter Link zeigt Hinweis.
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS (`HELFER_APP_AKTIV=true` in der Test-Umgebung prüfen).

### Task 9: Menü

**Files:**
- Modify: `public/js/menu.js` (Zeilen ~243–262 und 1127-ff.), zugehöriges CSS
- Test: `tests/e2e/menue-orga.spec.js`

- [ ] **Step 1: Failing E2E:** Hauptleiste enthält „Orga“ mit aufklappbarem Untermenü (Übersicht, Meine Aufgaben, Helfer, Technik, Catering, Medaillen und Pokale, Urkunden-Designer); „Helfer“ und „Urkunden-Designer“ stehen nicht mehr in der Hauptleiste; Zustand offen/zu bleibt nach Neuladen (try/catch um `localStorage`); aktiver Punkt wird markiert, auch auf `helfer-plan.html` und `urkunden-designer.html`; Zähler „Meine Aufgaben“ und `erledigt/gesamt`; Untermenüpunkte für Technik/Catering/Medaillen verweisen auf die Aufgaben per `vorlage_key`; Systempunkte unten unverändert.
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen; `eingeschraenkteSeiten` um `orga.html`, `orga-aufgabe.html` erweitern → **Step 4:** PASS; bestehende Menü-abhängige E2E-Specs laufen (`npx playwright test` für Specs, die `nav-helfer`/`nav-urkunden-designer` nutzen: Selektoren nachziehen).

### Task 10: Dokumentation und Gesamtlauf

**Files:**
- Modify: `CLAUDE.md` (Abschnitt Domänenmodell + Architektur „Orga-Planer“, kurz, mit Verweis auf die Spec), `docs/betrieb.md` (Erinnerungsjob, SMTP-Hinweis)

- [ ] **Step 1:** Dokumentation ergänzen.
- [ ] **Step 2:** `npm run test:unit` und `npm run test:e2e` → alles PASS (Fehlschläge nennen, nicht beschönigen).
- [ ] **Step 3:** Manuell in der Browser-Vorschau Seiten und Menü prüfen (hell/dunkel, Telefonbreite für `helfer.html`).
