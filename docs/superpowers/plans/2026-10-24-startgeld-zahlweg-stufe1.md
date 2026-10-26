# Startgeld-Zahlweg (Stufe 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Verein, der bei einem fremden Turnier mit Startgeld anmeldet, wählt einmal je Turnier einen Zahlweg (Überweisung oder Bar) samt Rechnungsadresse; Kämpfer von Vereinen mit Zahlweg Überweisung gelten für die Kampfbereitschaft als „bezahlt“, Bar-Vereine kassiert die Waage über eine Kassenliste.

**Architecture:** Neue Tabelle `turnier_zahlwege` (ein Eintrag je Turnier und Vereinsname, Verknüpfung zum Teilnehmer über `turnier_teilnehmer.verein` = `verein_name`). Der abgeleitete Zahlstatus ist eine eigene Spalte `turnier_teilnehmer.startgeld_zahlweg_gesichert`, die ein Service bei jeder Änderung neu berechnet; das bestehende Flag `startgeld_bezahlt` bleibt unangetastet (Handmarkierung/Waage). Alle Startgeld-Prüfungen laufen künftig über die reine Funktion `startgeldErfuellt`.

**Tech Stack:** Node/Express, Knex (PostgreSQL), Vanilla-JS-Frontend, `node:test` und Playwright.

**Spec:** `docs/superpowers/specs/2026-10-24-startgeld-abrechnung-design.md` (dieser Plan deckt dort Stufe 1 ab; Lastschrift = Stufe 3, Rechnungen/Zurückspielen = Stufe 2, eigene Pläne).

## Abweichungen von der Spec (Ergebnis der Code-Sichtung)
- **Verknüpfung über den Vereinsnamen statt `meldender_verein_id`:** Fremdvereine dürfen nur mit dem Namen ihres aktiven Vereins anmelden (`legeTeilnehmerAn`, „verein !== userVereinName“ → 403); der Name ist daher schon der Schlüssel und ändert sich beim Cloud↔Hallen-Transfer nicht (Vereins-IDs schon). Eine ID-Spalte kommt erst in Stufe 2, falls nötig.
- **Bereits vorhanden und weiterverwendet:** `turniere.startgeld` (ganze Euro), `iban`/`kontoinhaber`/`verwendungszweck` (Pflicht bei Startgeld > 0, Validierung in `turnierController.js`), der Knopf „Startgeld bezahlen“ mit Girocode in `teilnehmer.js`, die Handmarkierung `startgeld_bezahlt` und `importTurnierErgebnisse`/`importWettkampfdaten` (Ergebnis-Reimport per Datei existiert bereits — für Stufe 2 relevant, dort neu zu bewerten).
- Der Ausrichter-Verein zahlt nichts: seine Kämpfer gelten automatisch als „gesichert“ (die Spec nennt das nur als Annahme).

## Global Constraints
- Zahlweg nur bei `turniere.startgeld > 0` und nur für Vereine, die nicht der Ausrichter sind.
- Zahlwege in Stufe 1: `ueberweisung`, `bar` (der Wert `lastschrift` ist als Konstante reserviert, wird aber nicht angeboten). Wero gibt es nicht.
- Pflichtangaben bei jedem Zahlweg (auch Bar): Rechnungs-E-Mail, Ansprechperson, Anschrift.
- Änderbar nur, solange das Turnier effektiv `veroeffentlicht` ist (Anmeldung offen, `ermittleEffektivenStatus`); danach 403.
- Schreiben darf jedes freigegebene Mitglied des Vereins ab Rolle `benutzer` (`rolleReicht`).
- Mitglieder sehen weder Zahlweg noch Betrag der anderen Kämpfer; die Zahlweg-API liefert nur die Zeile des eigenen Vereins.
- Bestehende Tests und das Verhalten kostenloser Turniere (`startgeld` = 0/leer) dürfen sich nicht ändern.
- Code im Stil der Umgebung: deutsche Bezeichner und Kommentare, Routen als Factory `getXRoutes(knex)`, Fehler als `FachFehler`.

## Review Focus
1. Startgeld leer/0: kein Zahlweg nötig, `PUT` antwortet 400, Kampfbereitschaft unverändert. (Test in Task 3 und 4)
2. Kämpfer, deren `verein` nicht exakt zu einer Zahlweg-Zeile passt (z. B. Gastgeber trägt „JC Köln e.V“ statt „JC Köln e.V.“ ein): nicht „gesichert“, erscheinen in der Kassenliste, nie stillschweigend bezahlt. (Task 2)
3. Wechsel Überweisung → Bar: `startgeld_zahlweg_gesichert` fällt zurück, von Hand gesetztes `startgeld_bezahlt` bleibt; ein bereits gewogener Kämpfer fällt aus „kampfbereit“ zurück auf „angemeldet“. (Task 2)
4. Zwei Mitglieder desselben Vereins speichern gleichzeitig: genau eine Zeile (Unique + Upsert), keine 500. (Task 2)
5. Rolle `helfer`, nicht freigegebene Mitgliedschaft, fremder Verein oder Ausrichter-Mitglied: 403 bzw. 400; Super-Admin im Super-Admin-Modus darf die Kasse lesen, aber keinen Zahlweg für einen Verein setzen, dem er nicht angehört. (Task 4)

---

## Datei-Übersicht
- Create `migrations/20261101100000_startgeld_zahlweg.js` — Tabelle, Spalten.
- Create `src/shared/zahlweg.js` — Konstanten, reine Prüf-/Ableitungsfunktionen (läuft auch im Browser über `/js/shared/`).
- Create `src/services/zahlwege.js` — Laden/Speichern/Synchronisieren/Kasse.
- Create `src/controllers/zahlwegController.js`, `src/routes/zahlwegRoutes.js` — API unter `/api/zahlweg`.
- Modify `src/app.js` (Mount), `src/controllers/teilnehmerController.js`, `src/controllers/poolController.js`, `src/controllers/turnierController.js` (Export/Import, Turnier-Felder), `src/sync/bruecke.js` (Feldliste), `src/models/teilnehmerModel.js`.
- Create `public/js/zahlwegDialog.js`; Modify `public/js/teilnehmer.js`, `public/teilnehmer.html`, `public/turnier.html`, `public/js/turnier.js`.
- Tests: `tests/unit/zahlweg.test.js`, `tests/unit/zahlwegeService.test.js`, `tests/unit/zahlwegRoutes.test.js`, `tests/e2e/startgeld-kasse.spec.js`.
- Modify `CLAUDE.md` (Abschnitt Domänenmodell + Architektur).

---

### Task 1: Migration und reine Zahlweg-Logik

**Files:**
- Create: `migrations/20261101100000_startgeld_zahlweg.js`, `src/shared/zahlweg.js`
- Test: `tests/unit/zahlweg.test.js`

**Interfaces:**
- Produces (`src/shared/zahlweg.js`):
  - `ZAHLWEGE = ['ueberweisung', 'bar', 'lastschrift']`, `ABRECHNUNGSBASEN = ['gemeldet', 'teilnahme_waage']`
  - `parseAngeboteneZahlwege(wert: string | null | undefined): string[]` — kommaseparierter Text, Standard `['ueberweisung','bar']`, unbekannte Werte entfernt
  - `startgeldVerlangt(turnier: {startgeld?: any}): boolean` — `parseFloat(startgeld) > 0`
  - `startgeldErfuellt(turnier, teilnehmer: {startgeld_bezahlt?, startgeld_zahlweg_gesichert?}): boolean` — wahr, wenn kein Startgeld verlangt oder eines der beiden Flags gesetzt
  - `istZahlwegGesichert(zeile: {zahlweg: string} | null): boolean` — in Stufe 1 nur `ueberweisung`
  - `pruefeZahlwegEingabe(eingabe, angeboten: string[]): { fehler: string | null, werte: {zahlweg, rechnung_email, rechnung_ansprechperson, rechnung_anschrift} | null }` — alle vier Felder Pflicht (getrimmt), E-Mail mit einfachem Muster, Zahlweg muss in `angeboten` stehen
- Schema: `turnier_zahlwege(id, turnier_id → turniere ON DELETE CASCADE, verein_id → vereine ON DELETE SET NULL, verein_name NOT NULL, zahlweg NOT NULL, rechnung_email, rechnung_ansprechperson, rechnung_anschrift (text), geaendert_von (string, benutzer.id), created_at, updated_at, UNIQUE(turnier_id, verein_name))`; `turnier_teilnehmer.startgeld_zahlweg_gesichert boolean default false`; `turniere.abrechnungsbasis string default 'gemeldet'`, `turniere.angebotene_zahlwege string default 'ueberweisung,bar'`.

- [ ] **Step 1: Failing test** `tests/unit/zahlweg.test.js` (`node:test`): `startgeldErfuellt({startgeld: 0}, {})` ist wahr; `({startgeld: 8}, {})` falsch; `({startgeld: 8}, {startgeld_zahlweg_gesichert: true})` wahr; `({startgeld: 8}, {startgeld_bezahlt: 1})` wahr; `istZahlwegGesichert({zahlweg:'ueberweisung'})` wahr, `'bar'` und `null` falsch; `parseAngeboteneZahlwege(null)` ergibt `['ueberweisung','bar']`, `'bar,wero'` ergibt `['bar']`; `pruefeZahlwegEingabe` meldet Fehler bei leerer E-Mail, ungültiger E-Mail, nicht angebotenem Zahlweg und liefert bei gültiger Eingabe getrimmte `werte`.
- [ ] **Step 2:** `node --test tests/unit/zahlweg.test.js` → FAIL (Modul fehlt).
- [ ] **Step 3: Implement** `src/shared/zahlweg.js` (framework-frei, kein knex/DOM).
- [ ] **Step 4:** Test erneut → PASS.
- [ ] **Step 5: Implement** die Migration (Muster: `migrations/20261031100000_nachrichten.js`, `up`/`down`); Rückbau entfernt Tabelle und Spalten.
- [ ] **Step 6:** `npx knex migrate:latest --knexfile knexfile.cjs --env online` gegen das lokale PostgreSQL (`npm run pg:start`) läuft ohne Fehler; `npx knex migrate:rollback` und erneut `latest` ebenfalls.
- [ ] **Step 7: Commit** `git add migrations src/shared/zahlweg.js tests/unit/zahlweg.test.js && git commit -m "Zahlweg: Tabelle und reine Logik"`

### Task 2: Service `zahlwege`

**Files:**
- Create: `src/services/zahlwege.js`
- Modify: `src/controllers/teilnehmerController.js` (`pruefeKampfbereitschaft` und `leiteStatusAusKampfbereitschaftAb` exportieren)
- Test: `tests/unit/zahlwegeService.test.js` (Muster: `tests/unit/einladungOhneVereinUndTeilen.test.js`, `starteTestPostgres`)

**Interfaces:**
- Consumes: Task 1 (`startgeldErfuellt`, `istZahlwegGesichert`, `pruefeZahlwegEingabe`, `parseAngeboteneZahlwege`); `ermittleEffektivenStatus`, `FachFehler` wie im `teilnehmerController`.
- Produces:
  - `ladeZahlwegFuerVerein(knex, turnierId: number, vereinName: string): Promise<Zeile | null>`
  - `ladeVorbelegung(knex, vereinName: string): Promise<{rechnung_email, rechnung_ansprechperson, rechnung_anschrift} | null>` — jüngste Zeile desselben Vereinsnamens über alle Turniere
  - `speichereZahlweg(knex, { turnier, vereinName, vereinId, benutzerId, eingabe }): Promise<Zeile>` — wirft `FachFehler` 400 (kein Startgeld / ungültige Eingabe / Zahlweg nicht angeboten), 403 (Anmeldung nicht mehr offen, Ausrichter-Verein); Upsert über `onConflict(['turnier_id','verein_name']).merge()`; ruft danach `synchronisiereGesichert`
  - `synchronisiereGesichert(knex, turnierId: number): Promise<number>` — setzt `startgeld_zahlweg_gesichert` für alle Teilnehmer des Turniers: wahr, wenn `verein` zu einer Zeile mit gesichertem Zahlweg gehört **oder** dem Namen des Ausrichter-Vereins (`vereine.name` zu `turniere.verein_id`) entspricht; bei geänderten, bereits gewogenen Kämpfern wird der Status per `leiteStatusAusKampfbereitschaftAb` neu abgeleitet (angemeldet ↔ kampfbereit); gibt die Zahl geänderter Zeilen zurück
  - `ladeKasse(knex, turnierId: number): Promise<Array<{ vereinName, zahlweg: 'bar'|'ohneZahlweg', anzahlKaempfer, anzahlOffen, rechnungEmail: string|null }>>` — Vereine mit Zahlweg Bar **oder** ohne Zeile (und nicht Ausrichter), `anzahlOffen` = Kämpfer ohne `startgeld_bezahlt`
  - `kassiereBar(knex, turnierId: number, vereinName: string): Promise<number>` — markiert alle noch offenen Kämpfer dieses Vereins als `startgeld_bezahlt = 1` (über denselben Pfad wie die Einzelmarkierung, inkl. Statusableitung und Sync-Abgleich) und liefert die Anzahl

- [ ] **Step 1: Failing tests** (je ein Testfall): Upsert zweimal → genau eine Zeile; Startgeld 0 → `speichereZahlweg` wirft 400; Turnier nach Anmeldeschluss → 403; `synchronisiereGesichert` setzt das Flag für „JC A“ (Überweisung) und für den Ausrichter, nicht für „JC B“ (Bar) und nicht für „JC Köln e.V“ ohne Zeile; Wechsel `ueberweisung → bar` setzt das Flag zurück, lässt `startgeld_bezahlt` stehen und stuft einen gewogenen, sonst kampfbereiten Kämpfer auf `angemeldet` zurück; `ladeKasse` listet „JC B“ (bar) und „JC Köln e.V“ (`ohneZahlweg`) mit richtigen Zählern, nicht „JC A“; `kassiereBar` setzt die Flags und den Status `kampfbereit` für einen gewogenen Kämpfer; zwei parallele `speichereZahlweg` desselben Vereins (`Promise.all`) werfen nicht.
- [ ] **Step 2:** `node --test tests/unit/zahlwegeService.test.js` → FAIL.
- [ ] **Step 3: Implement** `src/services/zahlwege.js`; die Neuberechnung als ein `UPDATE … SET … EXISTS(SELECT … )` je Turnier, die Statusableitung nur für Zeilen, deren Flag sich geändert hat. `kassiereBar` verwendet die Service-Funktion der Einzelmarkierung aus `aendereStatusFelder` (`teilnehmerController.js`, REST-Handler um Zeile 732); gibt es keine reine Service-Funktion, wird sie dort herausgelöst (`setzeStartgeldBezahlt(knex, teilnehmerId, wert)`) und der Handler ruft sie auf.
- [ ] **Step 4:** Test → PASS; zusätzlich `node --test tests/unit/` für bereits vorhandene Teilnehmer-Tests.
- [ ] **Step 5: Commit** `git commit -m "Zahlweg: Service mit Synchronisierung und Kasse"`

### Task 3: Startgeld-Prüfungen verwenden die neue Ableitung

**Files:**
- Modify: `src/controllers/teilnehmerController.js` (Zeilen um 118–119, 154–278 `legeTeilnehmerAn`, 545–548), `src/controllers/poolController.js:819-827`, `src/models/teilnehmerModel.js:36`, `src/sync/bruecke.js:28-30`, `public/js/teilnehmer.js:193,214,1408`
- Test: `tests/unit/zahlwegeService.test.js` (erweitern), `tests/e2e/teilnehmer-ohne-startgeld.spec.js` (muss weiter grün sein)

**Interfaces:**
- Consumes: `startgeldErfuellt(turnier, teilnehmer)` aus Task 1; `synchronisiereGesichert`, `ladeZahlwegFuerVerein` aus Task 2.
- Produces: `legeTeilnehmerAn` setzt `startgeld_zahlweg_gesichert` beim Anlegen (Zeile des Vereins gesichert, oder Verein = Ausrichter); Model liefert zusätzlich `startgeldZahlwegGesichert: boolean`.

- [ ] **Step 1: Failing tests:** (a) `legeTeilnehmerAn` für einen Kämpfer von „JC A“ (Überweisung) bei Turnier mit Startgeld 8, bereits gewogen und mit gültiger Lizenz → Status `kampfbereit`; derselbe Aufruf für „JC B“ (Bar) → Status `angemeldet`. (b) Pool-Prüfung `istTeilnehmerStartberechtigt` (über die bestehende Funktion oder den Pool-Generieren-Pfad) lässt den Kämpfer von „JC A“ zu. (c) `bestaetigeKampfbereitschaft`-Pfad (Zeile 545) wirft für „JC B“ weiter „Das Startgeld ist noch nicht bezahlt.“
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement:** an den vier Server-Stellen `startgeldErfuellt` statt der lokalen Berechnung; in `legeTeilnehmerAn` das Flag vor `pruefeKampfbereitschaft` bestimmen; `bruecke.js`-Feldliste um `startgeld_zahlweg_gesichert` ergänzen, damit Waage/Geräte es spiegeln; im Browser `berechneStatus` (`teilnehmer.js:193`) und die beiden weiteren Stellen über `import { startgeldErfuellt } from '/js/shared/zahlweg.js'` (Muster: `scoreboard.js` mit `/js/shared/anzeigeName.js`; falls `teilnehmer.js` kein Modul ist, im `<script>`-Tag in `teilnehmer.html` `type="module"` ergänzen oder die Prüfung per Inline-Kopie mit Verweis auf die Shared-Datei und einem Test, der beide gleich hält).
- [ ] **Step 4:** `node --test tests/unit/` → PASS; `npx playwright test tests/e2e/teilnehmer-ohne-startgeld.spec.js tests/e2e/teilnehmer-lizenz-startgeld-rechte.spec.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Zahlweg: Kampfbereitschaft nutzt abgeleiteten Zahlstatus"`

### Task 4: API `/api/zahlweg`

**Files:**
- Create: `src/controllers/zahlwegController.js`, `src/routes/zahlwegRoutes.js`
- Modify: `src/app.js` (neben Zeile 434–441: `app.use('/api/zahlweg', requireWriteAuth, getZahlwegRoutes(knex));` — nicht im Einzelbenutzerbetrieb für `GET/PUT /:turnierId`, die Kasse dort schon)
- Test: `tests/unit/zahlwegRoutes.test.js` (Muster `einladungOhneVereinUndTeilen.test.js`: Express-App mit Router, JWT-Header)

**Interfaces:**
- Consumes: Task 2 (`ladeZahlwegFuerVerein`, `ladeVorbelegung`, `speichereZahlweg`, `ladeKasse`, `kassiereBar`), `ladeBenutzerMitAktivemVerein`, `hatVereinsZugriffAufTurnier`, `rolleReicht`.
- Produces:
  - `GET /api/zahlweg/:turnierId` → `{ erforderlich: boolean, angebotene: string[], startgeld: number, abrechnungsbasis, zahlweg: Zeile|null, vorbelegung: {…}|null, aenderbar: boolean }` für den aktiven Verein des Anrufers; `erforderlich` = Startgeld > 0 und der Anrufer-Verein ist nicht Ausrichter
  - `PUT /api/zahlweg/:turnierId` Body `{ zahlweg, rechnung_email, rechnung_ansprechperson, rechnung_anschrift }` → `{ success: true, zahlweg: Zeile }`; Fehler als `{ success: false, error }`
  - `GET /api/zahlweg/:turnierId/kasse` → `{ eintraege: ladeKasse(...) }`; erlaubt Ausrichter-Mitgliedern und im Einzelbenutzerbetrieb jedem, sowie Super-Admins im Modus
  - `POST /api/zahlweg/:turnierId/kasse/bar-kassiert` Body `{ vereinName }` → `{ success: true, anzahl }`; gleiche Berechtigung

- [ ] **Step 1: Failing tests** (Cloud-Modus, ein Turnier mit Startgeld 8 des Vereins „JC Ausrichter“): Benutzer von „JC A“ `PUT` mit Überweisung → 200, `GET` zeigt die Zeile samt `aenderbar: true`; fehlende Rechnungs-E-Mail → 400; Zahlweg `bar` bei `angebotene_zahlwege = 'ueberweisung'` → 400; Rolle `helfer` → 403; nicht freigegebenes Mitglied → 403; Mitglied des Ausrichters `PUT` → 400 („Ausrichter zahlt nicht“); Turnier ohne Startgeld → `GET.erforderlich === false`, `PUT` 400; `kasse` für Mitglied von „JC A“ → 403, für Ausrichter 200; `bar-kassiert` für „JC B“ setzt Kämpfer auf bezahlt und liefert die Anzahl; zweiter Benutzer desselben Vereins überschreibt die Zeile (eine Zeile in der Tabelle).
- [ ] **Step 2:** `node --test tests/unit/zahlwegRoutes.test.js` → FAIL.
- [ ] **Step 3: Implement** Controller als `erzeugeZahlwegController(knex)` und Routen wie `nachrichtenRoutes.js`; Fehler über `FachFehler` in die JSON-Antwort abbilden (Muster eines bestehenden Controllers).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** `git commit -m "Zahlweg: API für Anmelder und Kasse"`

### Task 5: Zahlweg-Dialog bei der Anmeldung und Turnierfelder

**Files:**
- Create: `public/js/zahlwegDialog.js` (Muster `public/js/nachzueglerDialog.js`, `window.ZahlwegDialog.frageNach(turnierId)`)
- Modify: `public/js/teilnehmer.js` (nach erfolgreichem Anlegen/Import, dort wo `NachzueglerDialog.frageNachSpeichern` aufgerufen wird; zusätzlich die Zeile „Zahlweg: … – ändern“ neben dem Knopf „Startgeld bezahlen“, Zeilen 1621–1651), `public/teilnehmer.html`, `public/turnier.html` + `public/js/turnier.js` (Felder `abrechnungsbasis`, Kästchen für angebotene Zahlwege; Validierung und Speichern im `turnierController` Zeilen 61, 95, 168–302 ergänzen, Export/Import Zeilen 957 und 1354)
- Test: `tests/e2e/startgeld-kasse.spec.js` (Turnierformular-Teil)

**Interfaces:**
- Consumes: `GET/PUT /api/zahlweg/:turnierId` aus Task 4.
- Produces: `window.ZahlwegDialog.frageNach(turnierId: number): Promise<'gespeichert' | 'abgebrochen' | 'nichtNoetig'>` — öffnet das Popup nur, wenn `erforderlich` und noch kein Zahlweg vorhanden; das Popup lässt sich nicht überspringen (kein Schließen ohne Speichern; Zahlweg wählen, Rechnungs-E-Mail, Ansprechperson, Anschrift, vorbelegt aus `vorbelegung`, Hinweis „Höchstbetrag = Kämpfer × Startgeld, Abrechnung nach `abrechnungsbasis`“). Turnier-API liefert und speichert `abrechnungsbasis` (Werte aus `ABRECHNUNGSBASEN`) und `angebotene_zahlwege`.

- [ ] **Step 1: Failing E2E** (Offline-Server der Suite, Turnierformular): Startgeld 8 eintragen, nur „Bar“ ankreuzen, speichern, neu laden → Auswahl bleibt; Basis „Teilnahme Waage“ bleibt; Turnier ohne Kreuz bei einem Zahlweg lässt sich bei Startgeld > 0 nicht speichern (Meldung). 
- [ ] **Step 2:** `npx playwright test tests/e2e/startgeld-kasse.spec.js -g "Turnierformular"` → FAIL.
- [ ] **Step 3: Implement** Turnierfelder serverseitig und im Formular; mindestens ein Zahlweg muss angeboten werden, sobald Startgeld > 0.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Implement** `zahlwegDialog.js` und den Aufruf in `teilnehmer.js` (nur Cloud, nur wenn der Anrufer nicht Ausrichter ist); die Zeile „Zahlweg: Überweisung/Bar – ändern“ öffnet denselben Dialog (Änderung nur, solange `aenderbar`). Der Dialog ist rein clientseitig; seine Fachlogik (wann Pflicht, wann änderbar) liegt in der API und ist dort getestet — hier ein manueller Check im Browser: Anmeldung eines Kämpfers als Mitglied eines Fremdvereins im Cloud-Modus (`BETRIEBSMODUS=cloud` mit lokalem PostgreSQL) öffnet das Popup genau einmal, danach nur die Zeile.
- [ ] **Step 6: Commit** `git commit -m "Zahlweg: Dialog bei der Anmeldung und Turnierfelder"`

### Task 6: Kassenliste an der Waage und Transfer zum Hallen-Server

**Files:**
- Modify: `public/teilnehmer.html` + `public/js/teilnehmer.js` (Knopf „Kasse“ und Dialog), `src/controllers/turnierController.js` (`baueTurnierExport` ab Zeile 1148: `zahlwege` mitgeben ohne `geaendert_von`; `importWettkampfdaten`/`importiereTurnierDaten`: Zeilen wiederherstellen und `startgeld_zahlweg_gesichert` je Teilnehmer übernehmen, danach `synchronisiereGesichert`)
- Test: `tests/e2e/startgeld-kasse.spec.js` (Kassen-Teil), `tests/unit/zahlwegeService.test.js` (Export/Import)

**Interfaces:**
- Consumes: `GET …/kasse`, `POST …/kasse/bar-kassiert` aus Task 4, `synchronisiereGesichert` aus Task 2.
- Produces: Export-JSON-Feld `zahlwege: Array<{verein_name, zahlweg, rechnung_email, rechnung_ansprechperson, rechnung_anschrift}>`; nach dem Import am Hallen-Server stehen die Zeilen unter der neuen Turnier-ID und das Flag der Teilnehmer ist neu berechnet.

- [ ] **Step 1: Failing tests:** (Unit) Export enthält `zahlwege` ohne Benutzerbezug; Import in ein frisches Turnier stellt die Zeilen her und setzt `startgeld_zahlweg_gesichert` für den Überweisungs-Verein und den Ausrichter. (E2E, Offline-Server mit Fixtures über `testDbVerbindung`): Kasse zeigt „JC B“ mit 3 offenen Kämpfern; Klick „Alles bar kassiert“ → Anzeige 0 offen, in der Teilnehmerliste sind die Kämpfer als bezahlt markiert; ein Verein ohne Zahlweg-Zeile steht ebenfalls auf der Liste, sein Name ist als „ohne Zahlweg“ gekennzeichnet.
- [ ] **Step 2:** Tests → FAIL.
- [ ] **Step 3: Implement** Export/Import und den Kassen-Dialog (Tabelle: Verein, Zahlweg, Kämpfer, offen, Knopf); der Knopf erscheint nur bei Turnieren mit Startgeld > 0.
- [ ] **Step 4:** `node --test tests/unit/` und `npx playwright test tests/e2e/startgeld-kasse.spec.js` → PASS.
- [ ] **Step 5: Commit** `git commit -m "Zahlweg: Kasse an der Waage und Transfer"`

### Task 7: Dokumentation und Gesamtlauf

**Files:**
- Modify: `CLAUDE.md` (Domänenmodell: `turnier_zahlwege`, `startgeld_zahlweg_gesichert`, Turnierfelder; Architektur: Abschnitt „Startgeld-Zahlweg (Stufe 1)“ mit Spec-Verweis und den Abweichungen)

- [ ] **Step 1:** CLAUDE.md ergänzen (Stil der übrigen Abschnitte, mit den Testdateien).
- [ ] **Step 2:** `npm run ci:lokal` läuft grün (Unit-Tests und E2E-Suite) — Erwartung: keine fehlschlagende Spec; bei Fehlern erst beheben, nicht überspringen.
- [ ] **Step 3: Commit** `git commit -m "Zahlweg: Dokumentation"`

---

## Selbstprüfung (Spec-Abdeckung Stufe 1)
- Startgeld-Block im Turnier (Basis, angebotene Zahlwege) → Task 5; Zahlungsziel/Hinweistext/Stammdaten des Ausrichters sind Stufe 2 (Rechnung), bewusst noch nicht hier.
- Zahlweg + Rechnungsadresse, Popup nicht überspringbar, änderbar bis Anmeldeschluss, Mitglieder sehen nichts → Tasks 4 und 5.
- Abgeleiteter Zahlstatus, Ausrichter zahlt nichts, Bar → Waage → Tasks 2, 3, 6.
- Neuer Verein zahlt Bar: in Stufe 1 über „ohne Zahlweg“ auf der Kassenliste abgebildet (kein Flag, Waage kassiert); die Erfassung von Rechnungs-E-Mail/Anschrift beim Anlegen vor Ort fehlt noch und kommt mit Stufe 2.
- Nicht in Stufe 1: Rückspielen, Rechnungen, Quittungen, Lastschrift, Mandat, Zeitplaner.
