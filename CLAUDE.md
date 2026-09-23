# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hajime Pro (hajime-pro)

Turnierverwaltungssoftware für Judo-Wettkämpfe nach den Regeln des Deutschen Judo-Bundes (DJB) — deckt den gesamten Ablauf von der Anmeldung bis zur Siegerliste ab. Kein Scoring/Refereeing-Tool (keine Ippon/Waza-ari/Shido-Erfassung), sondern reine Wettkampf-Organisation: Teilnehmerverwaltung, Auslosung, Matten-/Zeitplanung, Live-Steuerung, Ergebnisanzeige.

## Tech-Stack
- **Backend:** Node.js (ES-Module) + Express, Knex als Query-Builder/Migrations
- **DB:** PostgreSQL im Online-Betrieb, SQLite im Offline-Betrieb (`IS_OFFLINE=true` steuert Umschaltung in `knexfile.cjs`/`app.js`)
- **Frontend:** Server-gerenderte statische HTML-Seiten in `public/` + Vanilla-JS, Material Components Web für UI, `jsqr`/`qrcode-generator` für QR-Scanning (Judopass) an der Waage
- **Auth:** JWT (`jsonwebtoken`), vereinsbasierte Zugriffsrechte

## Commands
- **Dev-Server starten:** `npm start` (= `node src/app.js`), liest `.env` (`IS_OFFLINE`, `PORT`, DB-Zugangsdaten); Standardport 3000
- **DB-Umschaltung:** `IS_OFFLINE=true` in `.env` → SQLite (`data/turnier.sqlite`, Pfad über `DB_SQLITE_PATH` überschreibbar); sonst PostgreSQL über `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT`
- **Migrationen:** kein npm-Script dafür — direkt über knex ausführen, z.B. `npx knex migrate:latest --env offline` (oder `--env online`); Konfiguration in `knexfile.cjs`, Dateien in `migrations/`
- **DB komplett zurücksetzen:** `node setup_db.js` — löscht und erstellt alle Tabellen neu für das über `IS_OFFLINE` gewählte Environment; verweigert den Lauf im Online-Modus, außer `CONFIRM_ONLINE_RESET=JA_WIRKLICH_LOESCHEN` ist zusätzlich gesetzt (Schutz gegen versehentliches Löschen der gemeinsamen Cloud-DB)
- **E2E-Tests (Playwright):**
  - `npm run test:e2e` — komplette Suite, headless
  - `npm run test:e2e:ui` — Playwright UI-Modus
  - Einzelne Datei: `npx playwright test tests/e2e/<name>.spec.js`
  - Einzelner Test: `npx playwright test tests/e2e/<name>.spec.js -g "<Testname>"`
  - Die Suite startet ihren eigenen Server (`node src/app.js`, Port 3100, `IS_OFFLINE=true`, isolierte SQLite-DB `data/test.sqlite`) über `webServer` in `playwright.config.js`; `globalSetup` (`tests/e2e/global-setup.js`) setzt diese DB einmalig vor dem gesamten Lauf zurück und migriert sie neu
  - Tests laufen bewusst seriell gegen eine gemeinsame DB (`fullyParallel: false`, `workers: 1`) — keine Isolation zwischen Tests, Reihenfolge/Zustand innerhalb einer Spec-Datei kann relevant sein
  - `test/` (Singular, Repo-Root) enthält CSV-Fixtures für Import-Tests — nicht zu verwechseln mit `tests/e2e/`
  - `tests/e2e/fixtures/` (Pool-JSON-Fixturen) und `tests/e2e/helpers/` (z.B. `pool-fixture-turnier.js` — gemeinsames Turnier-Aufbau-/Bracket-Durchspiel-Gerüst) bündeln Aufbau-Logik, die mehrere Spec-Dateien identisch brauchen, damit eine Anpassung nicht in jeder Datei einzeln nachgezogen werden muss
  - `npm run test:e2e:vollablauf` — separate Suite `tests/e2e-vollablauf/` (eigenes `playwright.vollablauf.config.js`) für den kompletten Online/Offline-Turnierablauf: startet zwei echte Serverprozesse parallel (Online gegen die echte Cloud-Postgres-DB, Offline gegen eine frische SQLite) und simuliert den realen Datenaustausch per Datei-Download/-Upload; bewusst nicht Teil von `npm run test:e2e`, da sie in die echte Cloud-DB schreibt und deutlich langsamer läuft
- **`tests/unit/`** — Node-eigener Test-Runner (`npm run test:unit`, `node --test`), unabhängig von der Playwright-E2E-Suite; deckt aktuell die neue CouchDB-Datenzugriffsschicht (`src/db/`) ab, getestet gegen eine In-Memory-CouchDB-kompatible HTTP-API (`tests/unit/helpers/couchTestServer.js`, `express-pouchdb` + `pouchdb-adapter-memory`), ohne dass dafür eine echte CouchDB-Installation nötig ist; Konvention dabei: genau ein `startTestCouchServer()`-Aufruf pro Testdatei via `before()`/`after()`, jeder einzelne Test bekommt eine eigene zufällig benannte Datenbank innerhalb dieses einen Servers (zusätzlich technisch erzwungen — ein zweiter Aufruf in derselben Datei wirft einen Fehler)
- Kein Lint-Script konfiguriert; `npm run test:unit` (siehe `tests/unit/` oben) und die Playwright-E2E-Suite sind die einzigen automatisierten Testsuiten

## Domänenmodell (Kernentitäten)
- **`vereine`** — Judo-Vereine; jeder Nutzer (`benutzer`) gehört zu genau einem Verein (`verein_freigegeben`-Flag für Mitgliedschafts-Freigabe)
- **`turniere`** — ein Wettkampftag, gehört einem ausrichtenden Verein, hat Status-Lifecycle (`geplant` → `abgesagt`/`abgeschlossen`)
- **`kampfflaechen`** — die Matten eines Turniers
- **`pools`** — die eigentlichen Wettkampfklassen (Alters-/Gewichtsklasse + Geschlecht), jeweils mit Modus (Jeder-gegen-Jeden, Doppel-KO-8/16/32, Gruppen-Überkreuz), Kampfzeit und Golden-Score-Einstellungen
- **`turnier_teilnehmer`** — angemeldete Athlet:innen (Judopass-ID, Gewicht, Verein, zugeordneter Pool)
- **`kaempfe`** — einzelne Kämpfe innerhalb eines Pools, verknüpft per `..._quelle_kampf_id/_typ` mit ihren Vorgängerkämpfen (Bracket-Verkettung); bei Mannschaftskämpfen zusätzlich per `mannschaftskampf_id`/`mannschaft_gewichtsklasse` einer Begegnung zugeordnet
- **`mannschaften`** — eine Mannschaft in einem Mannschafts-Pool (`pools.typ = 'mannschaft'`), Verein als freier Text (analog `turnier_teilnehmer.verein`)
- **`mannschaft_mitglieder`** — ordnet vorhandene `turnier_teilnehmer` einer Gewichtsklassen-Position der Mannschaft zu (der Judoka bleibt ein normaler `turnier_teilnehmer`, Wiegen/QR-Scan laufen unverändert über `waage`)
- **`mannschaftskaempfe`** — eine Begegnung (Team A vs. Team B) innerhalb eines Mannschafts-Pools, strukturell parallel zu `kaempfe` (gleiche Status-Werte, gleiches Quelle-Verknüpfungsmuster für die Bracket-Kaskade); ihre Einzelkämpfe (einer pro gemeinsam besetzter Gewichtsklasse) sind ganz normale `kaempfe`-Zeilen

## Zentrale Architekturkonzepte
- **Routen als Factories mit Knex-Dependency-Injection:** jede Datei in `src/routes/` exportiert eine Funktion (`getXRoutes(knex)`), die in `src/app.js` mit der einen zentral erzeugten Knex-Instanz (Online/Offline je nach `IS_OFFLINE`) aufgerufen und gemountet wird; alle Schreib-Routen (`/api/turniere`, `/api/teilnehmer`, `/api/pools`, `/api/kampfflaechen`, `/api/kaempfe`, `/api/mannschaften`, `/api/mannschaftskaempfe`, `/api/offline`) laufen zusätzlich durch `requireWriteAuth` (`src/middleware/auth.js`); `/api/auth` und `/api/vereine` bewusst ohne dieses Gate (Login/Registrierung/Vereinsauswahl)
- **`src/shared/`** ist bewusst framework-/DB-frei gehalten (kein knex, kein DOM) und läuft identisch server- und client-seitig (Browser-Offline-Modus):
  - `bracketTopologie.js` — deklarative Turnierbaum-Struktur pro Modus (welcher Kampf bezieht seine Kämpfer aus welchem Vorkampf)
  - `kampfProgression.js` — Kaskaden-Engine: befüllt Folgekämpfe erst, wenn beide Kämpfer-Slots feststehen
  - `pausenRegel.js` — Mindestpausenzeiten zwischen Kämpfen eines Athleten (DJB-WKO)
  - `mannschaftsProgression.js` — Kaskaden-Engine für Mannschaftsbegegnungen, das Pendant zu `kampfProgression.js` auf Ebene der Begegnungen statt der Einzelkämpfe
- **`src/db/`** — CouchDB-Datenzugriffsschicht (Fundament der CouchDB/PouchDB-Migration, siehe `docs/superpowers/specs/2026-09-22-couchdb-pouchdb-migration-design.md`): `couch.js` (Verbindung, Datenbank-Provisionierung), `documentId.js` (ID-Schema `<typ>:<uuid>`), `baseRepository.js` (generisches CRUD + Mango-Query). Noch nicht in `app.js`/Controller verdrahtet — das ist Gegenstand eines künftigen Cutover-Plans (siehe Spec: Fremdschlüssel-Kopplung verhindert eine schrittweise Migration einzelner Tabellen). `src/db/repositories/` enthält bereits entitätsspezifische Repositories (`kampfflaechenRepository.js`, `turnierTeilnehmerRepository.js`, `poolsRepository.js`, `kaempfeRepository.js`) als dünne Wrapper um `baseRepository.js` — die ersten drei bieten `findAll` an (da jede Turnier-Datenbank diese Entitäten isoliert enthält), während `kaempfeRepository` statt `findAll` die Methode `findByPool` anbietet, da eine Turnier-Datenbank mehrere Pools mit jeweils eigenen Kämpfen enthält; zusätzlich `mannschaftenRepository.js` mit `findByPool` und `findUnassigned` für Pool-Zuweisung, `mannschaftMitgliederRepository.js` mit `findByMannschaft` für Gewichtsklassen-Positionen und `mannschaftskaempfeRepository.js` mit `findByPool` für Team-Begegnungen; alle bieten `create` mit `created_at`-Zeitstempel und sind nur gegen die In-Memory-Testinfrastruktur getestet. `turnierRepository.js` ist bewusst ein Sonderfall statt eines `baseRepository.js`-Wrappers: als Singleton-Dokument mit fester ID `turnier:meta` (`get`/`save` statt `create`/`findById`/`query`), da eine Turnier-Datenbank per Konstruktion nur ein einziges Turnier enthält und daher keine generierten IDs braucht; eine datenbankübergreifende Turnierliste ist bewusst nicht Teil dieser Schicht, sondern eine Katalog-Aufgabe der Online-CouchDB für eine spätere Phase
- **`src/services/*Manager.js`** — Turniermodus-Implementierungen (DoppelKo8/16/32Manager, GruppenUeberKreuzManager, JederGegenJedenManager), erzeugen die Kämpfe eines Pools beim Anlegen; für Mannschafts-Pools die entsprechenden `Mannschaft*Manager.js` (Jeder-gegen-Jeden, Doppel-KO-8/16), die Begegnungen statt Einzelkämpfe erzeugen
- **`src/services/mannschaftsBegegnungEngine.js`** — erzeugt pro Begegnung die Einzelkämpfe je gemeinsam besetzter Gewichtsklasse, wertet Sieg-/Wertungspunkte aus und lost bei vollständigem Gleichstand automatisch einen Stichkampf aus (DJB-WKO Art. 3.12.13.1); das Abschenken-Verbot (Art. 3.12.13.3) hängt in `teilnehmerController.js` an den bestehenden „nicht angetreten“/„disqualifizieren“-Aktionen
- **Offline-Modus pro Matte:** `offlineController.js` exportiert die Kämpfe/Teilnehmer einer einzelnen Kampffläche, sodass eine Matte ohne Internetverbindung weiterlaufen kann; Ergebnisse werden später zurücksynchronisiert
- **Regelkonformität DJB-WKO:** Alters-/Gewichtsklassen (`src/config/altersklassen.json`), Kampf-/Pausenzeiten und die dreistufige Golden-Score-Regel (kein Golden Score bis U13, 3 Min. begrenzt bei U15, unbegrenzt ab U18) sind explizit im Code nachgebildet und kommentiert (`poolController.js`, `pausenRegel.js`)

## Mannschaftskämpfe
Mannschafts-Pools (`pools.typ = 'mannschaft'`) laufen als Team-vs-Team-Begegnungen: pro fest
definierter Gewichtsklassen-Position (`pools.mannschafts_gewichtsklassen`, DJB-Vorlage für U15/U18
m/w, sonst aus den Einzelwettkampf-Gewichtsklassen übernommen oder frei editierbar) ein
Einzelkampf; Sieger der Begegnung = mehr Kampfsiege, bei Gleichstand Wertungspunkte, bei
vollständigem Gleichstand automatischer Stichkampf. Unterstützte Turniersysteme: Jeder-gegen-Jeden
und Doppel-KO-8/16 (Doppel-KO-32 und Gruppen-Überkreuz für Mannschaften bewusst noch nicht
umgesetzt). Mannschafts-Pools werden manuell angelegt (kein automatisches Bulk-Auslosen aus
Einzelanmeldungen) und komplett auf der eigenen Seite `mannschaften.html` verwaltet — sie
erscheinen bewusst nicht in `pools.html`/`pools.js`, deren Rendering strukturell auf
Einzelwettkampf-Pools zugeschnitten ist. Bundesliga-Ligabetrieb (Startgenehmigungen,
Transferfenster, Kampfgemeinschaften, Fremdstarter-Kontingente) ist explizit außerhalb des Scopes
— das ist überjährige Vereinsverwaltung, kein Turniertag.

## Umfang / bewusste Auslassungen
- Kein separater Team-Ligabetrieb (Bundesliga-Startgenehmigungen/Transferfenster) — siehe
  „Mannschaftskämpfe“ oben; einzelne Turniertage mit Mannschaftskämpfen sind abgedeckt
- Keine Kampfrichter-/Scoring-Logik (IJF-Kampfregeln zu Wurftechniken/Bewertungen sind nicht Teil der Anwendung)

## Seitenstruktur (`public/`)
`login` → `verein_auswahl` → `turniere` (Turnierauswahl) → `turnier`/`teilnehmer`/`pools`/`mannschaften` (Verwaltung) → `matten`/`steuerung`/`kampf` (Live-Betrieb am Wettkampftag) → `waage` (Einwiegen per QR-Scan) → `anzeige`/`dashboard`/`siegerliste` (öffentliche Anzeigen)
