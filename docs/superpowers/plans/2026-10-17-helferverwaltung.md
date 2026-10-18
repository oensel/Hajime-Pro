# Helferverwaltung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rollen je Verein (Super-Admin, Admin, Benutzer, Helfer), Registrierung mit E-Mail-Bestätigung und Freischaltung, Helferplan (Zeitstrahl, 2-Stunden-Slots), responsive Helfer-Seiten für Selbsteintragung und druckbare Helferausweise.

**Architecture:** Die Rolle liegt auf `benutzer_vereine.rolle`; alle Zugriffsprüfungen laufen über ein reines Rollenmodul (`src/shared/rollen.js`). Registrierung und Freischaltung nutzen einmalige Token (nur Hash gespeichert) und Seiten mit POST-Bestätigung. Helferplan-Logik liegt in `src/services/helferPlan.js` (knex-DI wie die übrigen Services), die Routen in zwei Factories (`/api/helfer` für Helfer, `/api/helfer-plan` für die Orga). Frontend: normale Seiten in `public/` (Vanilla-JS), reine Rechen-/Layoutmodule in `src/shared/` (per `/js/shared` ausgeliefert).

**Tech Stack:** Node.js ESM, Express, Knex/PostgreSQL, `node:test` mit `tests/helpers/testPostgres.js`, Playwright, `pdf-lib`, `qrcode-generator`, nodemailer (`src/utils/mailer.js`). Keine neue Abhängigkeit.

**Spec:** `docs/specs/2026-10-17-helferverwaltung-design.md`

**Branch:** Der aktuelle Branch `feat/mehrere-turniere` gehört zu einer anderen Funktion. Vor Task 1 einen eigenen Branch `feat/helferverwaltung` von `main` (oder vom Stand, den der Auftraggeber nennt) anlegen. Nicht committen: `.claude/launch.json`, `testdaten-import/` (nicht Teil dieser Arbeit).

## Global Constraints

Gelten für jede Task.

- Rollenwerte exakt `admin`, `benutzer`, `helfer` (Spalte `benutzer_vereine.rolle`); Hierarchie Admin ⊃ Benutzer ⊃ Helfer; `benutzer.ist_super_admin` bleibt die einzige globale Rolle und darf alles in allen Vereinen.
- Registrierung: Passwort mindestens 8 Zeichen; Vereinssuche ab 2 Zeichen, Teilstring an beliebiger Stelle, ohne Beachtung von Groß-/Kleinschreibung, Treffer mit passendem Anfang zuerst; nur vorhandene Vereine wählbar.
- Einmal-Token: 48 Stunden gültig, nur der SHA-256-Hash wird gespeichert, genau einmal verwendbar. Ein bloßer Aufruf eines Mail-Links verändert nie Daten; jede Wirkung geschieht per POST.
- Slots: Standardlänge 120 Minuten, Raster 15 Minuten, Mindestlänge 30 Minuten, keine Überlappung in einer Zeile. Uhrzeiten als ganze Minuten seit Mitternacht (`von_min`, `bis_min`, `turniere.beginn_min`, `turniere.ende_min`); ein Turnier ist ein Kalendertag.
- Zeitstrahl: von `beginn_min − 60` bis `ende_min + 60`.
- Standard-Bedarf für „Kampfgericht Matte n“ und „Waage n“: 2. `turniere.waagen_anzahl` Standard 1.
- Austragefrist und Eintragefrist für Helfer: Turniertag 08:00 Uhr Europe/Berlin (keine Zeitzonenbibliothek; `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'`).
- Ein Helfer darf sich nicht in zwei zeitlich überlappende Slots (auch nicht in verschiedene Tätigkeiten) desselben Turniers eintragen.
- Ein Konto, das in einem Verein nur Helfer ist, darf dort nichts verwalten. Der letzte Admin eines Vereins kann nicht herabgestuft, entfernt oder ausgetreten werden (Super-Admin darf).
- Mails ausschließlich über `sendeMail` aus `src/utils/mailer.js`; ein fehlender SMTP-Server darf keinen Ablauf scheitern lassen. Alle Texte deutsch, Anrede „du“ in Helferseiten und Mails an Helfer.
- Helfer-Registrierung und Helfer-Seiten (`/api/helfer`, `public/helfer*.html`) sind nur im Betriebsmodus `cloud` aktiv oder wenn `HELFER_APP_AKTIV=true` (für Tests, analog `LIVE_API_AKTIV`). Der Orga-Teil (`/api/helfer-plan`) ist in allen Modi aktiv.
- Migrationen: ESM mit `export const config = { transaction: false };` wie die vorhandenen.
- Code im Stil der Umgebung: Routen-Factories mit knex-Injection, Fehlertexte deutsch, Kommentare nur wo das Warum nicht offensichtlich ist.

## Review Focus

Eingaben/Zustände, die die Spec nicht ausdrücklich nennt und die am wahrscheinlichsten Probleme machen. Jede Zeile hat einen Test in der genannten Task.

1. Ein Konto, das nur Helfer ist, stellt `PUT /api/turniere/:id` für ein Turnier seines Vereins, auch nachdem es per `/api/vereine/aktiv` dorthin gewechselt hat: 403 (Task 2, Task 3).
2. Der letzte Admin versucht auszutreten, sich herabzustufen oder entfernt zu werden: abgelehnt; als Super-Admin erlaubt (Task 3).
3. Zwei Helfer buchen gleichzeitig den letzten freien Platz: genau einer gewinnt (Task 7).
4. Austragefrist rund um die Sommerzeitumstellung (Turniertag 2026-10-25 und 2027-03-28): 08:00 Berlin bleibt 08:00 Berlin (Task 6).
5. Mail-Link wird zweimal aufgerufen, ist abgelaufen oder gehört zu einer bereits entschiedenen Anfrage: keine Doppelwirkung, klare Meldung; ein GET verbraucht den Token nicht (Task 4, Task 5).
6. Registrierung mit bereits vorhandener, noch unbestätigter E-Mail (in anderer Schreibweise, z. B. Großbuchstaben): kein zweites Konto, Bestätigungsmail wird erneut gesendet (Task 4).
7. Slot wird verkürzt, verschoben oder gelöscht, obwohl schon Helfer eingetragen sind, oder der Bedarf wird unter die Zahl der Eingetragenen gesetzt: ohne ausdrückliche Bestätigung abgelehnt (Task 7).

---

## Dateiübersicht

Neu:
- `migrations/20261018100000_helferverwaltung_rollen.js`, `migrations/20261018110000_helferverwaltung_plan.js`
- `src/shared/rollen.js`, `src/shared/helferZeit.js`, `src/shared/helferZeitstrahl.js`
- `src/services/einmalToken.js`, `src/services/helferPlan.js`, `src/services/helferAusweis.js`, `src/services/registrierung.js`
- `src/controllers/freigabeController.js`, `src/controllers/helferController.js`, `src/controllers/helferPlanController.js`, `src/controllers/nutzerController.js`
- `src/routes/freigabeRoutes.js`, `src/routes/helferRoutes.js`, `src/routes/helferPlanRoutes.js`, `src/routes/nutzerRoutes.js`
- `public/helfer.html`, `public/js/helfer.js`, `public/css/helfer.css`, `public/helfer-plan.html`, `public/js/helferPlan.js`, `public/bestaetigen.html`, `public/freigabe.html`, `public/admin-nutzer.html`, `public/js/adminNutzer.js`
- Tests: `tests/unit/rollen.test.js`, `helferZeit.test.js`, `helferZeitstrahl.test.js`, `einmalToken.test.js`, `rollenZugriff.test.js`, `registrierung.test.js`, `freigabe.test.js`, `helferPlan.test.js`, `helferRoutes.test.js`, `helferAusweis.test.js`, `nutzer.test.js`; `tests/e2e/helfer-plan.spec.js`, `tests/e2e/helfer-seiten.spec.js`

Geändert: `src/utils/vereinHelper.js`, `src/middleware/auth.js`, `src/controllers/vereinController.js`, `src/controllers/authController.js`, `src/controllers/turnierController.js` (Felder, Export/Import), `src/routes/cloudRoutes.js`, `src/utils/superAdmin.js`, `src/app.js`, `public/js/menu.js`, `public/login.html`, `public/turnier.html`, `public/profil.html`, `CLAUDE.md`.

---

### Task 1: Migration Rollen, Token, Plan-Tabellen, Turnierfelder

**Files:**
- Create: `migrations/20261018100000_helferverwaltung_rollen.js`, `migrations/20261018110000_helferverwaltung_plan.js`
- Test: `tests/unit/helferMigration.test.js`

**Interfaces:**
- Produces (Schema): `benutzer_vereine.rolle` (string, nullable), `.angefragt_ueber` (string, nullable: `'helfer-app'|'verwaltung'`), `.entschieden_von` (string nullable, → `benutzer.id`), `.entschieden_am` (timestamp nullable); `benutzer.email_bestaetigt_am` (timestamp nullable); `token_einmal(id increments, benutzer_id string → benutzer CASCADE, zweck string, verein_id integer nullable → vereine CASCADE, token_hash string unique, laeuft_ab_am timestamp, benutzt_am timestamp nullable, created_at)`; `turniere.beginn_min`, `.ende_min` (integer nullable), `.waagen_anzahl` (integer not null default 1); `helfer_taetigkeiten(id, turnier_id → turniere CASCADE, art 'matte'|'waage'|'frei', kampfflaeche_id integer nullable → kampfflaechen SET NULL, bezeichnung string, bedarf integer, reihenfolge integer default 0)`; `helfer_slots(id, taetigkeit_id → helfer_taetigkeiten CASCADE, von_min integer, bis_min integer, bedarf integer)`; `helfer_einsaetze(id, slot_id → helfer_slots CASCADE, benutzer_id string nullable → benutzer CASCADE, name_manuell string nullable, eingetragen_von string nullable, eingetragen_am timestamp default now)` mit eindeutigem Index `(slot_id, benutzer_id)`.

- [ ] **Step 1: Failing test** `helferMigration.test.js`: `starteTestPostgres({ migriere: false })`, migriere mit `knex.migrate.up()` bis vor `20261018100000` (z. B. `migrate.up` in einer Schleife bis die nächste Migration die gesuchte ist, oder zuerst `migrate.latest()` und `migrate.down()` zweimal), lege einen Verein, zwei Benutzer und je eine `benutzer_vereine`-Zeile an (`freigegeben` 1 und 0), führe die Migrationen aus. Assertions: Zeile mit `freigegeben = 1` hat `rolle === 'admin'`, Zeile mit `freigegeben = 0` hat `rolle === null`; `benutzer.email_bestaetigt_am` ist für beide Bestandsbenutzer nicht null; `turniere.waagen_anzahl` default 1; Tabellen `token_einmal`, `helfer_taetigkeiten`, `helfer_slots`, `helfer_einsaetze` existieren; doppelter `(slot_id, benutzer_id)` wirft.
- [ ] **Step 2:** `node --test tests/unit/helferMigration.test.js` → FAIL (Spalte fehlt).
- [ ] **Step 3: Implement** beide Migrationen (`up`/`down`). Bestandsdaten: freigegebene Mitgliedschaften → `rolle='admin'`; alle bestehenden `benutzer` → `email_bestaetigt_am = now()`.
- [ ] **Step 4:** Test erneut ausführen → PASS; zusätzlich `node --test tests/unit/urkundenVorlagenTransfer.test.js` (Migrationskette intakt) → PASS.
- [ ] **Step 5: Commit** `feat(helfer): Migrationen für Rollen, Token und Helferplan`

### Task 2: Rollenmodul und Zugriffsprüfungen

**Files:**
- Create: `src/shared/rollen.js`
- Modify: `src/utils/vereinHelper.js` (`ladeBenutzerMitAktivemVerein`, `ladeVereineFuerBenutzer`, `setzeAktivenVerein`, `hatVereinsZugriffAufTurnier`), `src/middleware/auth.js` (`requireTournamentEditAccess`, `requireVereinFreigabe`, neu `requireRolle`)
- Test: `tests/unit/rollen.test.js`, `tests/unit/rollenZugriff.test.js`

**Interfaces:**
- Produces in `src/shared/rollen.js`: `export const ROLLEN = ['admin','benutzer','helfer']`; `export function rolleReicht(rolle: string|null, mindestens: 'helfer'|'benutzer'|'admin'): boolean` (null/unbekannt → false); `export function istGueltigeRolle(r): boolean`.
- Produces in `vereinHelper.js`: `ladeBenutzerMitAktivemVerein` liefert zusätzlich `verein_rolle` (Rolle der Mitgliedschaft im aktiven Verein oder `null`); `ladeVereineFuerBenutzer` liefert je Eintrag zusätzlich `rolle`; `hatVereinsZugriffAufTurnier(user, turnier)` verlangt `rolleReicht(user.verein_rolle,'benutzer')` ODER `user.ist_super_admin`; `export function hatHelferZugriffAufVerein(knex, benutzerId, vereinId): Promise<boolean>` (freigegebene Mitgliedschaft beliebiger Rolle oder Super-Admin); `export async function ladeVereinIdsMitRolle(knex, benutzerId, mindestens): Promise<number[]>`.
- Produces in `auth.js`: `requireRolle(knex, mindestens)` – Middleware-Factory, prüft die Rolle im aktiven Verein (Super-Admin immer erlaubt, Einzelbenutzerbetrieb immer erlaubt), antwortet 403 mit deutscher Meldung.
- Consumes: Migration aus Task 1.

- [ ] **Step 1: Failing tests.** `rollen.test.js`: `rolleReicht('admin','benutzer') === true`, `('benutzer','admin') === false`, `('helfer','benutzer') === false`, `(null,'helfer') === false`, `('quatsch','helfer') === false`. `rollenZugriff.test.js` (mit `starteTestPostgres`): drei Benutzer als freigegebener Admin/Benutzer/Helfer desselben Vereins + ein Super-Admin; `hatVereinsZugriffAufTurnier` ist wahr für Admin, Benutzer, Super-Admin (auch ohne Mitgliedschaft im Turnier-Verein), falsch für Helfer und für nicht freigegebene Mitgliedschaft; `requireTournamentEditAccess` antwortet für den Helfer mit 403 (Review Focus 1, einschließlich des Falls, dass der Verein per `setzeAktivenVerein` aktiv gesetzt ist); `ladeVereineFuerBenutzer` enthält `rolle`.
- [ ] **Step 2:** Tests ausführen → FAIL.
- [ ] **Step 3: Implement** wie in Interfaces; `ladeVerwalteteVereinIds` in `vereinController.js` bleibt bis Task 3 unverändert.
- [ ] **Step 4:** `node --test tests/unit/rollen.test.js tests/unit/rollenZugriff.test.js` → PASS. Dann `npx playwright test tests/e2e/registrierung.spec.js` → PASS (Regression, Offline-Modus ohne Rollenprüfung).
- [ ] **Step 5: Commit** `feat(helfer): Rollenmodul und rollenbasierte Zugriffsprüfung`

### Task 3: Vereinsverwaltung mit Rollen (Freigabe, Rollenwechsel, Schutz des letzten Admins)

**Files:**
- Modify: `src/controllers/vereinController.js` (`ladeVerwalteteVereinIds` nur Admin; `approveMember`, `rejectMember`, `getPendingRequests`, `superApproveMember`, `leaveVerein`, `benachrichtigeUeberBeitrittsanfrage`), `src/routes/vereinRoutes.js`, `src/utils/superAdmin.js`
- Create: `src/services/vereinsRollen.js`
- Test: `tests/unit/vereinsRollen.test.js`

**Interfaces:**
- Produces in `src/services/vereinsRollen.js`:
  - `export async function entscheideAnfrage(knex, { vereinId, benutzerId, entscheiderId, entscheidung: 'freigeben'|'ablehnen', rolle?: string }): Promise<{ ok: true } | { ok: false, status: number, error: string }>` (Freigeben verlangt gültige Rolle; setzt `freigegeben=1`, `rolle`, `entschieden_von`, `entschieden_am`; Ablehnen löscht die Mitgliedschaft und räumt `aktiver_verein_id` auf wie `rejectMember`; nur Admin des Vereins oder Super-Admin darf entscheiden; bereits freigegebene Anfrage → 409)
  - `export async function aendereRolle(knex, { vereinId, benutzerId, neueRolle, durchId }): Promise<same>` (Admin des Vereins oder Super-Admin; Schutz des letzten Admins → 409)
  - `export async function entferneMitglied(knex, { vereinId, benutzerId, durchId }): Promise<same>` (Admin/Super-Admin oder das Mitglied selbst über `leaveVerein`; letzter Admin → 409, Super-Admin darf; offene Dienste → 409, siehe Task 7 – hier nur Hook `hatOffeneDienste(knex, benutzerId, vereinId)` aus `helferPlan.js`, bis Task 7 ein Stub, der `false` liefert)
  - `export async function ladeEmpfaengerFuerAnfrage(knex, vereinId): Promise<string[]>` – E-Mails aller freigegebenen Admins des Vereins; ohne Admin alle Konten mit `ist_super_admin`
  - `export async function istLetzterAdmin(knex, vereinId, benutzerId): Promise<boolean>`
- Produces Routen (`vereinRoutes.js`, hinter `requireAuth`): `POST /api/vereine/approve` Body `{ userId, vereinId, rolle }` (bisher ohne `rolle` → 400), `POST /api/vereine/rolle` Body `{ userId, vereinId, rolle }`, `GET /api/vereine/mitglieder?vereinId=` (Admin: Name, E-Mail, Rolle, Status).
- `ensureSuperAdmin` legt die Mitgliedschaft des Super-Admins weiterhin als `freigegeben=1` an, jetzt mit `rolle='admin'`.

- [ ] **Step 1: Failing tests** `vereinsRollen.test.js`: (a) Helfer darf nicht freigeben (403), Admin darf; (b) Freigabe ohne gültige Rolle → 400, mit `'helfer'` setzt `rolle='helfer'`; (c) `ladeEmpfaengerFuerAnfrage` liefert Vereins-Admins, sobald vorhanden, sonst alle Super-Admins (zwei Super-Admins → beide Adressen); (d) Review Focus 2: einziger Admin kann sich weder herabstufen noch entfernt werden → 409, ein Super-Admin darf; mit zweitem Admin geht es; (e) `leaveVerein` bleibt rückwärtskompatibel (letztes Vereinsmitglied löscht den Verein wie bisher).
- [ ] **Step 2:** Test ausführen → FAIL.
- [ ] **Step 3: Implement** den Service; die Controller delegieren daran. `benachrichtigeUeberBeitrittsanfrage` nutzt `ladeEmpfaengerFuerAnfrage` und `SUPER_ADMIN_EMAIL` entfällt dort (Konstante bleibt für das Bootstrapping).
- [ ] **Step 4:** `node --test tests/unit/vereinsRollen.test.js` → PASS; `npx playwright test tests/e2e/registrierung.spec.js` → PASS (die Specs, die `approve` aufrufen, müssen `rolle` mitschicken – Spec anpassen).
- [ ] **Step 5: Commit** `feat(helfer): Freigabe mit Rollenwahl, Rollenwechsel, Schutz des letzten Admins`

### Task 4: Registrierung mit E-Mail-Bestätigung

**Files:**
- Create: `src/services/einmalToken.js`, `src/services/registrierung.js`, `public/bestaetigen.html`
- Modify: `src/controllers/authController.js` (`register`, `login`), `src/routes/authRoutes.js`
- Test: `tests/unit/einmalToken.test.js`, `tests/unit/registrierung.test.js`

**Interfaces:**
- Produces in `einmalToken.js`:
  - `export async function erzeugeToken(knex, { benutzerId, zweck: 'email'|'freischaltung', vereinId?: number, gueltigStunden = 48 }): Promise<string>` (liefert den Klartext-Token, speichert SHA-256)
  - `export async function pruefeToken(knex, token, zweck): Promise<null | { id, benutzer_id, verein_id }>` (verbraucht NICHT; null bei unbekannt/abgelaufen/benutzt)
  - `export async function verbrauchePruefe(knex, token, zweck): Promise<null | { id, benutzer_id, verein_id }>` (atomar: setzt `benutzt_am` nur, wenn noch nicht gesetzt; zweiter Aufruf → null)
- Produces in `registrierung.js`: `export async function registriere(knex, { email, password, vorname, nachname, vereinId, quelle: 'helfer-app'|'verwaltung', basisUrl }): Promise<{ status: 201|200|400|409, ... }>`; `export async function bestaetige(knex, token, basisUrl): Promise<{ ok, vereinId? }>` (setzt `email_bestaetigt_am`, legt die Mitgliedschaft `freigegeben=0` mit `angefragt_ueber` an, erzeugt Freischaltungs-Token und sendet die Mail an `ladeEmpfaengerFuerAnfrage` mit Link `<basisUrl>/freigabe.html?token=…`); `export async function sendeBestaetigungNeu(knex, email, basisUrl)`.
- Routen: `POST /api/auth/register` (Body wie bisher plus optional `vereinId`, `quelle`; Konto ohne Bestätigung, antwortet ohne Token wenn `email_bestaetigt_am` leer), `POST /api/auth/email-bestaetigen` Body `{ token }`, `POST /api/auth/email-bestaetigung-erneut` Body `{ email }` (antwortet immer 200, kein Hinweis, ob die Adresse existiert). `login` weist unbestätigte Konten mit 403 und `code: 'email_unbestaetigt'` ab.
- Seite `bestaetigen.html?token=`: zeigt einen Knopf „E-Mail bestätigen“, der per POST bestätigt (Schutz vor Mail-Scannern), danach die Wartemeldung.
- Verhalten ohne `vereinId` (Altfluss über `verein_auswahl.html`): unverändert, Konto gilt als bestätigt, wenn `quelle` fehlt? **Nein** – jede Neuregistrierung muss bestätigen; der Altfluss legt nach der Bestätigung weiter über `/api/vereine/join` an. Die Vereinsauswahl bei der Registrierung ist optional.
- E-Mail-Adressen werden kleingeschrieben und getrimmt gespeichert und gesucht.

- [ ] **Step 1: Failing tests.** `einmalToken.test.js`: Token gültig; nach `verbrauchePruefe` zweiter Aufruf → null; abgelaufener Token (Zeit per direktem Update von `laeuft_ab_am`) → null; falscher `zweck` → null; `pruefeToken` ändert `benutzt_am` nicht (Review Focus 5); in der DB steht nie der Klartext. `registrierung.test.js` (E-Mail-Versand per `mock.method` auf `sendeMail` aus `../../src/utils/mailer.js` bzw. per Injektion eines `sende`-Parameters, falls ES-Module das Mocken nicht zulassen – dann `registriere(…, { sende })` ergänzen): Registrierung legt Konto mit `email_bestaetigt_am = null` an und sendet genau eine Mail an die Adresse; keine Mitgliedschaft vor der Bestätigung; nach `bestaetige` existiert die Mitgliedschaft `freigegeben=0` und eine Mail geht an die Vereins-Admins (ohne Admin an die Super-Admins); gleiche E-Mail in Großschreibung → kein zweites Konto, erneute Bestätigungsmail (Review Focus 6); bestätigte Adresse bereits vergeben → 409; Passwort kürzer als 8 → 400; unbekannter `vereinId` → 400; Login vor Bestätigung → 403 `email_unbestaetigt`.
- [ ] **Step 2:** Tests ausführen → FAIL.
- [ ] **Step 3: Implement** Services, Controller-Änderungen, Seite `bestaetigen.html` (Stil wie `login.html`).
- [ ] **Step 4:** Unit-Tests PASS. `tests/e2e/registrierung.spec.js` anpassen: Im Offline-Modus ist `requireAuth` ein Mock, `register` aber nicht; der Spec erwartet jetzt die Wartemeldung statt der Weiterleitung auf `verein_auswahl.html` → anpassen und ausführen: PASS.
- [ ] **Step 5: Commit** `feat(helfer): Registrierung mit E-Mail-Bestätigung und Einmal-Token`

### Task 5: Freischaltung per Mail-Link und Super-Admin-Verwaltung

**Files:**
- Create: `src/controllers/freigabeController.js`, `src/routes/freigabeRoutes.js`, `public/freigabe.html`, `src/controllers/nutzerController.js`, `src/routes/nutzerRoutes.js`, `public/admin-nutzer.html`, `public/js/adminNutzer.js`
- Modify: `src/app.js` (Routen mounten)
- Test: `tests/unit/freigabe.test.js`, `tests/unit/nutzer.test.js`

**Interfaces:**
- Consumes: `erzeugeToken`, `pruefeToken`, `verbrauchePruefe` (Task 4), `entscheideAnfrage`, `ladeEmpfaengerFuerAnfrage` (Task 3).
- Produces Routen (ohne `requireAuth`, Token trägt die Berechtigung): `GET /api/freigabe/:token` → `{ benutzer: {vorname,nachname,email}, verein: {id,name}, vorbelegteRolle }` oder 404/410; `POST /api/freigabe/:token` Body `{ entscheidung: 'freigeben'|'ablehnen', rolle? }` → ruft `verbrauchePruefe(token,'freischaltung')` dann `entscheideAnfrage` mit `entscheiderId = null` (Token-Entscheidung, `entschieden_von` bleibt leer) und sendet dem Antragsteller die Ergebnis-Mail. Ein bereits entschiedener oder abgelaufener Token → 410 mit Text „Diese Anfrage wurde bereits entschieden oder ist abgelaufen.“
- Das Freischaltungs-Token wird auch erzeugt, wenn ein Helfer im Profil einen weiteren Verein anfragt (`POST /api/vereine/join`): Mail an `ladeEmpfaengerFuerAnfrage` mit Link. `join` verlangt jetzt `email_bestaetigt_am`.
- Vorbelegte Rolle: `angefragt_ueber === 'helfer-app'` → `helfer`, sonst `benutzer`.
- `nutzerRoutes` (Prefix `/api/nutzer`, `requireAuth` + `requireSuperAdmin(knex)`): `GET /` (alle Konten: Name, E-Mail, `ist_super_admin`, Mitgliedschaften), `POST /:id/super-admin` Body `{ wert: boolean }` (der letzte Super-Admin kann sich nicht entziehen → 409).
- Seiten: `freigabe.html` (Rollenauswahl-Dropdown, Knöpfe „Freischalten“/„Ablehnen“, Ergebnistext), `admin-nutzer.html` (Tabelle, Umschalter).

- [ ] **Step 1: Failing tests.** `freigabe.test.js`: GET verbraucht den Token nicht und liefert die Daten; POST `freigeben` mit `rolle:'helfer'` setzt Mitgliedschaft `freigegeben=1, rolle='helfer'`, sendet Mail an den Antragsteller; zweites POST mit demselben Token → 410 (Review Focus 5); abgelaufener Token → 410; POST ohne gültige Rolle bei `freigeben` → 400 und der Token bleibt gültig; `ablehnen` löscht die Mitgliedschaft. `nutzer.test.js`: Nicht-Super-Admin → 403; Super-Admin ernennt weiteren Super-Admin; letzter Super-Admin kann sich nicht entziehen → 409.
- [ ] **Step 2:** Tests ausführen → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Unit-Tests PASS.
- [ ] **Step 5: Commit** `feat(helfer): Freischaltung per Mail-Link und Super-Admin-Verwaltung`

### Task 6: Zeitlogik (rein)

**Files:**
- Create: `src/shared/helferZeit.js`
- Test: `tests/unit/helferZeit.test.js`

**Interfaces:**
- Produces:
  - `export const RASTER_MIN = 15, MIN_LAENGE = 30, STANDARD_SLOT = 120`
  - `export function fristEndeBerlin(datum: 'YYYY-MM-DD'): Date` – Instant für 08:00 Uhr Europe/Berlin an diesem Tag (ohne externe Bibliothek)
  - `export function darfHelferAendern(datum: string, jetzt: Date): boolean` – `jetzt < fristEndeBerlin(datum)`
  - `export function ueberlappt(a: {von_min, bis_min}, b: {von_min, bis_min}): boolean` (aneinandergrenzend zählt nicht als Überlappung)
  - `export function rasterRunde(min: number): number`
  - `export function erzeugeStandardSlots(beginnMin: number, endeMin: number): Array<{von_min, bis_min}>` – 120-Minuten-Slots ab `beginnMin`, letzter Slot gekürzt auf `endeMin`, Mindestlänge beachten (ein Rest unter 30 Minuten wird dem vorigen Slot zugeschlagen)
  - `export function zeitstrahlBereich(beginnMin, endeMin): { von: number, bis: number }` (± 60 Minuten, auf volle Stunden gerundet, nicht unter 0 / über 1440)
  - `export function formatiereMinuten(min: number): string` → `"09:30"`

- [ ] **Step 1: Failing tests.** `fristEndeBerlin('2026-10-25')` entspricht `2026-10-25T07:00:00Z` (Sommerzeit endet in der Nacht, 08:00 Berlin = 07:00 UTC) und `fristEndeBerlin('2026-10-24')` entspricht `2026-10-24T06:00:00Z`; `fristEndeBerlin('2027-03-28')` entspricht `2027-03-28T06:00:00Z` (Review Focus 4); `darfHelferAendern('2026-11-14', new Date('2026-11-14T06:59:59Z'))` ist wahr, `…T07:00:00Z` falsch; `ueberlappt({von_min:540,bis_min:660},{von_min:660,bis_min:780})` falsch, `…{von_min:600,…}` wahr; `erzeugeStandardSlots(540, 960)` ergibt 540–660, 660–780, 780–900, 900–960; `erzeugeStandardSlots(540, 675)` ergibt 540–675 (Rest 15 Minuten wird zugeschlagen); `zeitstrahlBereich(540, 960)` ergibt `{von: 480, bis: 1020}`.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren (Offset von Europe/Berlin über `Intl.DateTimeFormat(...).formatToParts` am betreffenden Tag bestimmen). **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(helfer): Zeitlogik für Slots und Austragefrist`

### Task 7: Helferplan-Service (Tätigkeiten, Slots, Einsätze)

**Files:**
- Create: `src/services/helferPlan.js`
- Test: `tests/unit/helferPlan.test.js`

**Interfaces:**
- Consumes: `helferZeit.js` (Task 6), Tabellen aus Task 1, `rolleReicht`.
- Produces (alle `async`, werfen `FachFehler`-ähnliche Fehler mit `status` und deutscher Meldung; verwende die vorhandene Klasse `FachFehler`, falls eine in `src/shared/` oder `src/services/` existiert, sonst `class PlanFehler extends Error { status }` in dieser Datei):
  - `synchronisiereStandardTaetigkeiten(knex, turnierId): Promise<void>` – legt je Kampffläche „Kampfgericht Matte n“ und je Waage „Waage n“ (Anzahl `turniere.waagen_anzahl`) an, Bedarf 2, mit Standard-Slots aus `erzeugeStandardSlots`; vorhandene bleiben, überzählige Waagen/Matten nur löschen, wenn sie keine Einsätze haben
  - `legeTaetigkeitAn(knex, turnierId, { bezeichnung, bedarf }): Promise<{id}>` (frei, mit Standard-Slots)
  - `aendereTaetigkeit(knex, id, { bezeichnung?, bedarf? })`, `loescheTaetigkeit(knex, id, { bestaetigt })` (mit Einsätzen nur bei `bestaetigt === true`)
  - `legeSlotAn(knex, taetigkeitId, { von_min, bis_min }): Promise<{id}>` (Raster, Mindestlänge, keine Überlappung → 409)
  - `aendereSlot(knex, slotId, { von_min?, bis_min?, bedarf?, bestaetigt? })` (Review Focus 7: Verkürzung/Verschiebung oder Bedarf unter der Zahl der Eingetragenen verlangt `bestaetigt`, sonst 409 mit Anzahl; gibt `{ betroffeneBenutzerIds: string[] }` zurück)
  - `loescheSlot(knex, slotId, { bestaetigt })`
  - `traegeEin(knex, { slotId, benutzerId, durchId, jetzt = new Date(), alsOrga = false }): Promise<{id}>` – Transaktion mit `forUpdate()` auf dem Slot; Fehler: voll (409 „Gerade vergeben“), Überlappung mit eigenem Dienst im selben Turnier (409), Frist (403 „Bitte melde dich bei der Turnierleitung“, außer `alsOrga`), keine freigegebene Mitgliedschaft im ausrichtenden Verein (403)
  - `traegeAus(knex, { einsatzId, durchId, jetzt, alsOrga }): Promise<void>` (Frist wie oben; ein Helfer darf nur eigene Einsätze entfernen)
  - `traegeManuellEin(knex, { slotId, name, durchId }): Promise<{id}>`
  - `ladePlan(knex, turnierId): Promise<{ turnier: {beginn_min, ende_min, datum, waagen_anzahl}, taetigkeiten: Array<{id, art, bezeichnung, bedarf, slots: Array<{id, von_min, bis_min, bedarf, einsaetze: Array<{id, benutzer_id, name}>}>}> }>`
  - `ladeOffeneSlots(knex, turnierId, benutzerId): Promise<Array<{ taetigkeit, slotId, von_min, bis_min, frei, eingetragen: boolean }>>` – sortiert nach Bezeichnung, dann `von_min`; enthält nur nicht volle Slots und Slots, in denen der Benutzer steht
  - `ladeMeineDienste(knex, benutzerId): Promise<Array<{ einsatzId, turnier: {id,name,datum}, taetigkeit, von_min, bis_min }>>` – aufsteigend nach Datum, dann `von_min`
  - `hatOffeneDienste(knex, benutzerId, vereinId): Promise<boolean>` (ersetzt den Stub aus Task 3: Dienste in noch nicht vergangenen Turnieren dieses Vereins)

- [ ] **Step 1: Failing tests** (`starteTestPostgres`, Turnier mit zwei Kampfflächen anlegen): Synchronisieren erzeugt Matte 1, Matte 2, Waage 1 mit Standard-Slots und Bedarf 2, ist idempotent (zweiter Lauf ändert nichts); Waage-Anzahl von 1 auf 2 ergänzt nur Waage 2; Slot-Überlappung/Raster/Mindestlänge werden abgelehnt; `traegeEin` zweimal gleichzeitig für den letzten Platz (`Promise.allSettled` mit zwei verschiedenen Benutzern, Bedarf 1) → genau einer erfüllt, einer 409 (Review Focus 3); Überlappung mit eigenem Dienst in anderer Tätigkeit → 409; nach `jetzt` hinter der Frist → 403, mit `alsOrga: true` erlaubt; Helfer kann nicht fremden Einsatz austragen; `ladeOffeneSlots`: volle Slots fehlen, eigene bleiben, Sortierung nach Bezeichnung dann Zeit; `ladeMeineDienste` sortiert über zwei Turniere; `aendereSlot` mit Eingetragenen und Verkürzung ohne `bestaetigt` → 409, mit `bestaetigt` → ok und `betroffeneBenutzerIds` gefüllt; Bedarf unter Anzahl der Eingetragenen ohne Bestätigung → 409.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(helfer): Helferplan-Service mit Eintragelogik`

### Task 8: API-Routen für Helfer und Orga

**Files:**
- Create: `src/controllers/helferController.js`, `src/controllers/helferPlanController.js`, `src/routes/helferRoutes.js`, `src/routes/helferPlanRoutes.js`
- Modify: `src/app.js`, `src/controllers/turnierController.js` (Felder `beginn_min`, `ende_min`, `waagen_anzahl` in `createTurnier`/`updateTurnier`/`getTurnier`)
- Test: `tests/unit/helferRoutes.test.js`

**Interfaces:**
- Consumes: Task 2, 5, 7.
- Produces Routen `/api/helfer` (hinter `requireAuth`, nur wenn `bm.istCloud || process.env.HELFER_APP_AKTIV === 'true'`): `GET /turniere` (anstehende Turniere der Vereine mit freigegebener Mitgliedschaft, Status `geplant`, Datum ≥ heute, mit `offeneDienste`), `GET /turniere/:id/dienste` (`ladeOffeneSlots`), `POST /einsaetze` Body `{ slotId }`, `DELETE /einsaetze/:id`, `GET /meine-dienste`, `GET /profil`, `POST /profil/verein` Body `{ vereinId }` (wie `join`, ohne neuen Verein), `DELETE /profil/verein/:vereinId` (gesperrt bei offenen Diensten/letztem Admin), `POST /profil/passwort`. Jede Route prüft `hatHelferZugriffAufVerein` für das Turnier.
- Produces Routen `/api/helfer-plan` (immer; `requireAuth`; Turnier-ID aus `:turnierId`; Zugriff über `requireTournamentEditAccess(knex)`; zusätzlich `requireTurnierAktiv(knex)` für Schreibzugriffe): `GET /:turnierId` (`ladePlan`, ruft vorher `synchronisiereStandardTaetigkeiten`), `POST /:turnierId/taetigkeiten`, `PUT/DELETE /taetigkeiten/:id`, `POST /taetigkeiten/:id/slots`, `PUT/DELETE /slots/:id`, `POST /slots/:id/einsaetze` (Body `{ benutzerId }` oder `{ name }`), `DELETE /einsaetze/:id`, `GET /:turnierId/mitglieder` (Vereinsmitglieder des ausrichtenden Vereins mit Name). Nach `aendereSlot` mit `betroffeneBenutzerIds` Mail an die Betroffenen („Dein Dienst … ist jetzt von … bis …“). Für Taetigkeit-/Slot-/Einsatz-IDs ergänzt die Middleware die Turnier-Ermittlung (`resolveTurnierId` in `auth.js` um `/api/helfer-plan` erweitern).
- Zeitfrist über `darfHelferAendern(turnier.datum, new Date())`; Orga umgeht sie (`alsOrga: true`).

- [ ] **Step 1: Failing tests** `helferRoutes.test.js`: Express-App mit echtem JWT (`jsonwebtoken`, Secret aus `process.env.JWT_SECRET` bzw. dem Default) und `starteTestPostgres`, über `fetch` angesprochen. Helfer sieht nur Turniere seiner Vereine; Fremdverein-Turnier bei `GET /turniere/:id/dienste` → 403; `POST /einsaetze` ok und ein zweiter Helfer sieht den Slot mit weniger freien Plätzen; Helfer auf `/api/helfer-plan/:id` → 403; Benutzer (nicht Helfer) darf Plan lesen/schreiben und sich selbst eintragen; Super-Admin darf überall; Orga-Eintrag nach der Frist ok, Helfer-Austragen nach der Frist → 403; Review Focus 1 über die echte Route `PUT /api/turniere/:id` (Helfer 403).
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(helfer): API für Helfer-Seiten und Helferplan`

### Task 9: Turnierfelder in der Turnierverwaltung

**Files:**
- Modify: `public/turnier.html` (Felder „Beginn“, „Ende“ als `type="time"`, „Anzahl Waagen“ als Zahl 1–10, Speichern/Laden), ggf. `public/js/*` der Seite
- Test: `tests/e2e/turnier-helfer-felder.spec.js`

**Interfaces:** Consumes `beginn_min`/`ende_min`/`waagen_anzahl` aus Task 8 (Controller). Die Seite wandelt `HH:MM` ↔ Minuten mit `parseUhrzeit`/`formatiereMinuten` (letzteres aus `/js/shared/helferZeit.js`; `parseUhrzeit(text): number|null` ergänzt in `helferZeit.js` mit eigenem Unit-Test in `helferZeit.test.js`).

- [ ] **Step 1:** Failing E2E (Turnier anlegen, Beginn 09:00, Ende 16:00, Waagen 2 setzen, neu laden, Werte sichtbar) und `parseUhrzeit`-Unit-Test (`'09:30' → 570`, `'24:00' → null`, `'abc' → null`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** `npx playwright test tests/e2e/turnier-helfer-felder.spec.js` und Unit-Test PASS.
- [ ] **Step 5: Commit** `feat(helfer): Beginn, Ende und Waagenanzahl am Turnier`

### Task 10: Zeitstrahl-Layout (rein) und Helferplan-Seite

**Files:**
- Create: `src/shared/helferZeitstrahl.js`, `public/helfer-plan.html`, `public/js/helferPlan.js`
- Modify: `public/js/menu.js` (Menüpunkt „Helfer“ für Rolle ab Benutzer; Hallen-Server: immer)
- Test: `tests/unit/helferZeitstrahl.test.js`, `tests/e2e/helfer-plan.spec.js`

**Interfaces:**
- Produces in `helferZeitstrahl.js` (DOM-frei): `export function minutenZuProzent(min, bereich: {von,bis}): number`; `export function pixelZuMinuten(deltaPx, breitePx, bereich): number` (auf Raster gerundet); `export function ziehe(slot: {von_min,bis_min}, modus: 'links'|'rechts'|'mitte', deltaMin, bereich, nachbarn: Array<{von_min,bis_min}>): {von_min,bis_min}` (hält Mindestlänge, Raster, Bereichsgrenzen und Nachbarn ein; ungültig → unveränderter Slot); `export function slotZustand(eingetragen, bedarf): 'ok'|'teil'|'leer'`; `export function freiePositionFuerNeuenSlot(minuten, nachbarn, bereich): {von_min,bis_min}|null` (Doppelklick: Stunde runden, 120 Minuten, bei Platzmangel gekürzt, unter 30 Minuten → null).
- Seite: Layout nach dem abgestimmten Entwurf – Zeitstrahl-Kopfzeile, eine Zeile je Tätigkeit, Slots mit Rändern zum Ziehen (Pointer-Events), Doppelklick legt einen Slot an, Klick öffnet die Detailleiste (Helfer anzeigen/zuteilen/entfernen, Slot löschen, Bedarf), „+ Tätigkeit hinzufügen“ unter der letzten Zeile mit Popup (Bezeichnung, Anzahl Helfer pro Slot; Pflichtfeld mit Fehlermeldung „Bezeichnung eingeben“, Enter bestätigt, Esc schließt), Knöpfe „Helferausweise drucken“ (Task 12) und im Hallen-Server „Helferplan aus der Cloud aktualisieren“ (Task 11). Bei Konflikt-Antworten (409 mit Anzahl) fragt die Seite per `confirm`-Dialog nach und wiederholt mit `bestaetigt: true`. Speichern beim Loslassen der Maus, nicht bei jeder Bewegung. Fehlt `beginn_min`/`ende_min`, zeigt die Seite einen Hinweis mit Link zu `turnier.html`.
- Ohne neue Bibliothek, Stil nach `matten.html`-Muster (Material Components wie die übrigen Seiten).

- [ ] **Step 1: Failing tests.** Unit: `ziehe` hält Mindestlänge 30 beim Verkleinern; verschiebt in 15er-Schritten; stößt an den Nachbarn und an den Bereichsrand an (Slot bleibt unverändert, wenn der Schritt ungültig ist); `slotZustand(0,2)==='leer'`, `(1,2)==='teil'`, `(2,2)==='ok'`, `(3,2)==='ok'`; `freiePositionFuerNeuenSlot(570, [{von_min:600,bis_min:720}], bereich)` ergibt 540–600; `minutenZuProzent`. E2E `helfer-plan.spec.js` (Offline-Modus, `offline_user` ist Admin): Turnier mit Beginn/Ende/Matten anlegen → Seite öffnen → Zeilen „Kampfgericht Matte 1“, „Waage 1“ sichtbar; „+“ → Popup → leer bestätigen zeigt Fehler, mit Name „Waffelstand“ und Anzahl 3 entsteht eine Zeile mit Slots; Doppelklick auf freie Fläche legt Slot an; Ziehen des rechten Rands verkürzt den Slot (per API prüfen).
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS (Unit und E2E).
- [ ] **Step 5: Commit** `feat(helfer): Helferplan-Seite mit Zeitstrahl`

### Task 11: Turnier-Export/-Import und Aktualisierung aus der Cloud

**Files:**
- Modify: `src/controllers/turnierController.js` (`exportTurnier`, `importiereTurnierDaten`), `src/routes/cloudRoutes.js`, `src/services/cloudZugriff.js`, `public/js/helferPlan.js`
- Test: `tests/unit/helferTransfer.test.js`, Erweiterung `tests/e2e/turnier-aus-cloud-holen.spec.js` nicht nötig (eigener Test unten)

**Interfaces:**
- Export enthält zusätzlich `helferplan: { taetigkeiten: [...mit slots und einsaetze (name statt benutzer_id/E-Mail)] }`. Import legt die Tätigkeiten, Slots und Einsätze als `name_manuell`-Einträge an (Benutzerkonten gibt es im Hallen-Server nicht). Alte Exportdateien ohne `helferplan` bleiben importierbar.
- Neu: `POST /api/cloud/turniere/:id/helferplan` (Einzelbenutzerbetrieb, wie die übrigen Cloud-Routen): holt den Export der Cloud (bestehender Anmeldeweg von `cloudRoutes`) und ersetzt nur den Helferplan des lokalen Turniers (Zuordnung über `urspruengliche_id`). Knopf in `helferPlan.js`.

- [ ] **Step 1: Failing tests** `helferTransfer.test.js` (PG): Export eines Turniers mit Plan und zwei Einsätzen (ein Konto, ein manueller Name) enthält Anzeigenamen, aber weder E-Mail noch Passwort-Hash noch Benutzer-IDs; Import in eine zweite Datenbank (oder dasselbe Schema mit anderer Turnier-ID) erzeugt gleiche Slots und `name_manuell`-Einträge; Import einer Datei ohne `helferplan` funktioniert. Test der Aktualisierungsroute mit der vorhandenen Fake-Cloud (`tests/helpers/fake-cloud.mjs`, ggf. um `helferplan` im Export erweitern).
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS; bestehende Export-/Import-Specs laufen weiter (`npx playwright test tests/e2e/turnier-aus-cloud-holen.spec.js`).
- [ ] **Step 5: Commit** `feat(helfer): Helferplan in Turnier-Export und Aktualisierung aus der Cloud`

### Task 12: Helferausweis (PDF)

**Files:**
- Create: `src/services/helferAusweis.js`
- Modify: `src/routes/helferPlanRoutes.js`, `src/controllers/helferPlanController.js`, `public/js/helferPlan.js` (Knopf)
- Test: `tests/unit/helferAusweis.test.js`

**Interfaces:**
- Produces: `export async function erzeugeAusweisPdf(knex, turnierId, { benutzerIds?: string[] }): Promise<Uint8Array>` – ein Ausweis pro Person (Konto oder manueller Name) mit allen Einsätzen dieses Turniers; 4 Ausweise (2×2) pro A4-Seite; Inhalt: Turniername und Datum, Name, Einsätze (Tätigkeit, Zeit), farbige Kopfleiste je erster Tätigkeit (stabile Farbe per Hash der Bezeichnung), QR-Code mit `hajime-helfer:<turnierId>:<kennung>`; Schrift wie in `urkundenRenderer.js` (fontkit + vorhandene Schriften aus `public/fonts/urkunden/`). Route `GET /api/helfer-plan/:turnierId/ausweise?ids=` liefert `application/pdf`. QR-Matrix mit `qrcode-generator` (serverseitig nutzbar) als Rechtecke gezeichnet.
- Personen ohne Einsatz erhalten keinen Ausweis.

- [ ] **Step 1: Failing test** `helferAusweis.test.js` (PG): drei Personen (zwei Konten, ein manueller Name) mit Einsätzen, vierte Person ohne Einsatz → PDF mit `PDFDocument.load` geprüft: 1 Seite, Aufruf mit 5 Personen ergibt 2 Seiten; `benutzerIds`-Filter reduziert auf die gewählten; Umlaute im Namen (z. B. „Jörg Müller“) erzeugen keinen Fehler.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5: Commit** `feat(helfer): druckbare Helferausweise`

### Task 13: Responsive Helfer-Seiten und Login-Anpassungen

**Files:**
- Create: `public/helfer.html`, `public/js/helfer.js`, `public/css/helfer.css`
- Modify: `public/login.html` (Registrierung: Verein mit Autovervollständigung, Hinweis nach Registrierung „Bitte bestätige deine E-Mail“; Anmeldung zeigt bei `email_unbestaetigt` Hinweis mit „Mail erneut senden“), `public/profil.html` (Rolle je Verein, Freigabeliste mit Rollenwahl für Admins, Mitgliederverwaltung), `public/js/menu.js` (Rolle des aktiven Vereins; reine Helfer sehen nur „Helfer-App“; Menüpunkte „Helfer“ und „Nutzer“ nach Rolle; Weiterleitung nach Login: reiner Helfer → `helfer.html`)
- Test: `tests/unit/helferAnzeige.test.js`, `tests/e2e/helfer-seiten.spec.js`

**Interfaces:**
- `public/js/helfer.js` nutzt ausschließlich `/api/helfer/*`. Reiter: Turniere, (Turnier →) offene Dienste (nach Bezeichnung, dann Uhrzeit, „noch X Plätze frei“, Knopf „Eintragen“, Hinweis bei Überlappung, „Gerade vergeben“), Meine Dienste (nach Datum und Uhrzeit, „Austragen“, nach 08:00 am Turniertag „Bitte melde dich bei der Turnierleitung“), Profil (Name, E-Mail, Vereine mit Status und Rolle, Verein hinzufügen mit Autovervollständigung, Passwort ändern, Abmelden).
- Reine Anzeigelogik DOM-frei in `src/shared/helferAnzeige.js`: `export function filtereVereine(liste: string[], eingabe: string): string[]` (Regeln aus den Global Constraints), `export function platzText(frei: number): string` (`'noch 1 Platz frei'`, `'noch 3 Plätze frei'`), `export function gruppiereNachBezeichnung(slots)`.
- Layout: einspaltig bis 720 px mit unterer Navigation, darüber mittig begrenzte Breite (max. 720 px) mit Navigation oben; Touch-Ziele mindestens 44 px; kein horizontales Scrollen bei 375 px Breite.

- [ ] **Step 1: Failing tests.** `helferAnzeige.test.js`: `filtereVereine(['Judo Club Senden','JC Musterstadt','SV Sendenhorst Judo','Budokan Münster'], 'sen')` ergibt `['Judo Club Senden','SV Sendenhorst Judo']` in dieser Reihenfolge (Anfangstreffer zuerst, dann alphabetisch; hier hat keiner einen Anfangstreffer → alphabetisch), `'s'` ergibt `[]` (unter 2 Zeichen), `'SENDEN'` trifft case-insensitiv, `'sv '` stellt „SV Sendenhorst Judo“ vor Treffer mit dem Text in der Mitte; `platzText(1)` und `platzText(3)`. E2E `helfer-seiten.spec.js` (Server mit `HELFER_APP_AKTIV=true` ist im Test-Server gesetzt, `tests/e2e/test-env.js`/`playwright.config.js` entsprechend ergänzen): als `offline_user` Turnier mit Plan anlegen, `helfer.html` öffnen, Slot eintragen → erscheint unter „Meine Dienste“, austragen entfernt ihn, bei Viewport 375×812 kein horizontales Scrollen (`document.documentElement.scrollWidth <= clientWidth`) und bei 1280×800 mittige Breite.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS (Unit + E2E).
- [ ] **Step 5: Commit** `feat(helfer): responsive Helfer-Seiten, Login und Profil mit Rollen`

### Task 14: Dokumentation und Gesamtlauf

**Files:**
- Modify: `CLAUDE.md` (Domänenmodell: Rollen je Verein, neue Tabellen; Architektur: Helferverwaltung; Commands: `HELFER_APP_AKTIV`; Seitenstruktur), `docs/betrieb.md` (SMTP-Konfiguration ist für Registrierung nötig, kurzer Abschnitt)
- Test: Gesamtlauf

- [ ] **Step 1:** Abschnitt „Helferverwaltung“ in `CLAUDE.md` ergänzen (Rollenmodell, Token-Ablauf, Frist, Schalter `HELFER_APP_AKTIV`, Dateien), `docs/betrieb.md` ergänzen.
- [ ] **Step 2:** `npm run test:unit` → PASS. `npm run test:e2e` → PASS. Danach `npm run ci:lokal` → PASS (alle Specs der Suite, keine vergessene Spec in `tests/e2e-sync/shards.js`-Listen).
- [ ] **Step 3: Commit** `docs(helfer): Helferverwaltung in CLAUDE.md und Betriebsdoku`

---

## Self-Review (Spec → Task)

| Spec-Abschnitt | Task |
|---|---|
| 2/3 Rollen, Hierarchie, Super-Admin, Migration der Bestandsmitglieder zu Admin, Schutz des letzten Admins | 1, 2, 3, 5 |
| 4 Registrierung, E-Mail-Bestätigung, Wartemeldung, Admin-/Super-Admin-Mail, Freischaltungs-Seite mit Rollenwahl, Ablehnung | 4, 5 |
| 4.1 Profil (Vereine, Rolle, Status, weiterer Verein, Passwort, Austritt gesperrt bei offenen Diensten) | 3, 7, 8, 13 |
| 4.2 Sichtbarkeit nur eigener Vereine | 8 |
| 5 Helfer-Seiten (responsiv, ohne PWA), 5.1 Regeln, 5.2 Frist 08:00 | 6, 7, 8, 13 |
| 6 Helferplan, Zeitstrahl, „+“ mit Popup, Slots ziehen, Detail, Bestätigung bei Änderungen, Mail bei Zeitänderung | 7, 8, 10 |
| 7 Datenmodell inkl. Turnierfelder | 1, 9 |
| 8 Hallen-Server: Export/Import, Aktualisierung aus der Cloud | 11 |
| 9 Helferausweis | 12 |
| 11 Tests | je Task, Gesamtlauf Task 14 |

Typ-Konsistenz: `rolleReicht`, `ladeEmpfaengerFuerAnfrage`, `entscheideAnfrage`, `erzeugeToken`/`pruefeToken`/`verbrauchePruefe`, `traegeEin`/`traegeAus`, `ladeOffeneSlots`, `ladeMeineDienste`, `fristEndeBerlin`/`darfHelferAendern` werden in den Interfaces einmal definiert und in späteren Tasks mit diesen Namen verwendet. Spaltennamen `von_min`/`bis_min`/`beginn_min`/`ende_min` durchgängig; die Spec wurde entsprechend angepasst.

Offene Annahmen des Plans, die der Auftraggeber bei Bedarf ändert: keine Zeitzonenbibliothek; Mail-Test per Injektion eines `sende`-Parameters, falls das Mocken von ES-Modulen nicht geht; Farbe der Ausweis-Kopfleiste per Hash der Tätigkeit.
