# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Hajime Pro (hajime-pro)

Turnierverwaltungssoftware für Judo-Wettkämpfe nach den Regeln des Deutschen Judo-Bundes (DJB) — deckt den gesamten Ablauf von der Anmeldung bis zur Siegerliste ab. Kein Scoring/Refereeing-Tool (keine Ippon/Waza-ari/Shido-Erfassung), sondern reine Wettkampf-Organisation: Teilnehmerverwaltung, Auslosung, Matten-/Zeitplanung, Live-Steuerung, Ergebnisanzeige.

## Tech-Stack
- **Backend:** Node.js (ES-Module) + Express, Knex als Query-Builder/Migrations
- **DB:** PostgreSQL (Cloud: Supabase oder eigener Server; Hallen-Server: lokal). SQLite wurde entfernt (`DB_CLIENT=sqlite` verhindert den Start; ein bestehendes Turnier lässt sich per Turnier-Export/-Import übernehmen). Welche Datenbank und welche Rolle gilt, entscheidet `BETRIEBSMODUS` (siehe Commands)
- **Frontend:** Server-gerenderte statische HTML-Seiten in `public/` + Vanilla-JS, Material Components Web für UI, `jsqr`/`qrcode-generator` für QR-Scanning (Judopass) an der Waage
- **Auth:** JWT (`jsonwebtoken`), Zugriffsrechte über die Rolle je Verein (`benutzer_vereine.rolle`, siehe Helferverwaltung) plus globalen Super-Admin. Schreibzugriff im Hallenbetrieb: Turnierleitungs-Passwort (`src/utils/steuerungPasswort.js`): `STEUERUNG_PASSWORD` aus der `.env` ist nur das vom Installationsskript erzeugte Start-Passwort; `POST /api/auth/verify` meldet dafür `aenderungErforderlich`, `menu.js` erzwingt den Änderungs-Dialog (`POST /api/auth/steuerung-passwort`, min. 8 Zeichen), das neue Passwort liegt gehasht (scrypt) in der Tabelle `steuerung_passwort` (repliziert im Cluster, die Middleware liest einen alle 5 s nachgeladenen Speicherstand) und ersetzt das Start-Passwort; `konfig:steuerung` trägt den SHA-256 für Client-Geräte. Leeres `STEUERUNG_PASSWORD` = kein Passwort (Tests/Entwicklung)

## Arbeitsregeln (Token sparen)
- **Jede Änderung in einem eigenen Branch** (`git switch -c <typ>/<thema>`), nie direkt auf `main` und nie mehrere Themen in einem Branch; pro Thema ein Branch, ein PR
- **Nur das lesen, was die Aufgabe braucht:** diese Datei enthält nur Grundlagen. Details stehen in `docs/claude/` (Tabelle unten) — nur die passende Datei und dort gezielt per Grep/`offset`/`limit`, nie alles. Keine Subagenten, Worktrees oder Kopien ohne ausdrückliche Bitte
- Tests gezielt starten (einzelne Spec/Unit-Datei), die volle Suite läuft in der CI

## Themenverzeichnis (`docs/claude/`)
| Datei | Inhalt |
|---|---|
| `betrieb.md` | Betriebsmodi `BETRIEBSMODUS`, Helfer-Variablen, Sync-Modus, Client-Gerät, Cluster/Installation, Cloud-Update, Downloads über die Cloud, Turnier aus der Cloud holen |
| `domaenenmodell.md` | Tabellen: vereine, turniere, pools, teilnehmer, kaempfe, mannschaften, Rollen, Orga, Urkunden |
| `architektur-kern.md` | Routen-Factories/Knex-DI, `src/shared/`, `*Manager.js`, Mannschafts-Engine, DJB-WKO-Regeln |
| `turnierablauf.md` | Teilnehmer-Import aus E-Mail, Urkunden, Waage in Runden/Nachzügler, Anzeigetafel, Pool-Beginn-Hinweis, Zeitprognose, Menü ohne Flackern |
| `sync-client-cluster.md` | Offline/Sync-Schicht, Client-Gerät, Android-App, Server-Cluster, Live-Durchsage, Video-Archiv, Desktop-Client |
| `cloud-verwaltung.md` | Helferverwaltung, Helfer einladen, Nachrichten, Turnier teilen, Super-Admin, 2FA, Sicherung, Protokoll, Konsole, Impressum/Datenschutz, Planungs-Tools, Turnier-Assistent und Funktionen je Turnier, Orga-Planer |
| `teilnehmer-app-cloud-live.md` | Live-Uplink, Teilnehmer-App (Zugang, Schalter), Cloud-Live-Betrieb |
| `mannschaften.md` | Mannschafts-Pools und -Begegnungen |
| `startgeld-lastschrift.md` | Startgeld-Abrechnung, Rechnungen, SEPA-Lastschrift (Mandate, pain.008, Rücklastschrift, Zahlungsdaten-Schlüssel) |
| `seiten.md` | Seitenstruktur von `public/` |

## Commands (Kurzfassung)
- **Dev-Server starten:** `npm start` (= `node src/app.js`), liest `.env` (`BETRIEBSMODUS`, `PORT`, DB-Zugangsdaten); Standardport 3000
- **DB-Umschaltung:** PostgreSQL über `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT` (knex-Umgebung `online`, daneben `online-migration`); es gibt nur noch PostgreSQL (`src/utils/dbUmgebung.js` → `betriebsmodus.cjs`)
- **Migrationen:** kein npm-Script dafür — direkt über knex ausführen, z.B. `npx knex migrate:latest --knexfile knexfile.cjs --env online` (ohne `--knexfile` findet knex die `.cjs`-Datei nicht); Konfiguration in `knexfile.cjs`, Dateien in `migrations/`
- **Lokales PostgreSQL ohne Installation:** `npm run pg:start` / `pg:stopp` / `pg:status` (`scripts/lokale-pg.mjs`, Binaries aus der devDependency `embedded-postgres`, Daten in `data/pg-lokal`, trust-Auth nur auf 127.0.0.1, Port/DB-Name aus `DB_PORT`/`DB_NAME`); legt beim ersten Start die Instanz und die Datenbank an. Für den lokalen Server-Modus: `IS_OFFLINE=true`, `DB_HOST=127.0.0.1`, `DB_PORT=5433`, `SYNC_ROLLE=server`
- **DB komplett zurücksetzen:** `node setup_db.js` — löscht und erstellt alle Tabellen neu für die über den Betriebsmodus gewählte Datenbank; verweigert den Lauf gegen PostgreSQL (`cloud` und `server` mit `pg`), außer `CONFIRM_ONLINE_RESET=JA_WIRKLICH_LOESCHEN` ist zusätzlich gesetzt (Schutz gegen versehentliches Löschen der gemeinsamen Cloud-DB)
- **E2E-Tests (Playwright):**
  - `npm run test:e2e` — komplette Suite, headless
  - `npm run test:e2e:ui` — Playwright UI-Modus
  - Einzelne Datei: `npx playwright test tests/e2e/<name>.spec.js`
  - Einzelner Test: `npx playwright test tests/e2e/<name>.spec.js -g "<Testname>"`
  - Die Suite startet ihren eigenen Server (`node src/app.js`, Port 3100, `IS_OFFLINE=true`, eigenes PostgreSQL `data/test-pg` auf Port 5601) über `webServer` in `playwright.config.js`; der erste `webServer`-Eintrag (`tests/helpers/pg-dienst.mjs`, nutzt `tests/helpers/testPostgres.js` mit dem eingebetteten PostgreSQL) startet die Datenbank frisch und migriert sie, `globalTeardown` (`tests/e2e/global-teardown.js`) stoppt und löscht sie. Specs, die Fixtures direkt in der DB anlegen, nutzen `testDbVerbindung` aus `test-env.js`
  - Playwright startet nicht, wenn der Checkout-Pfad einen Punkt-Ordner wie `.claude` enthält (Express `sendFile` beantwortet dann alle Seiten mit 404, der Server-Check läuft in den Timeout): in Worktrees unter `.claude/worktrees` die Suite aus einer Kopie ohne Punkt im Pfad starten
  - Tests laufen bewusst seriell gegen eine gemeinsame DB (`fullyParallel: false`, `workers: 1`) — keine Isolation zwischen Tests, Reihenfolge/Zustand innerhalb einer Spec-Datei kann relevant sein
  - `tests/e2e/fixtures/import-csv/` enthält CSV-Beispiele für den Teilnehmer-Import
  - `tests/e2e/fixtures/` (Pool-JSON-Fixturen) und `tests/e2e/helpers/` (z.B. `pool-fixture-turnier.js` — gemeinsames Turnier-Aufbau-/Bracket-Durchspiel-Gerüst) bündeln Aufbau-Logik, die mehrere Spec-Dateien identisch brauchen, damit eine Anpassung nicht in jeder Datei einzeln nachgezogen werden muss; `helpers/turnier-aufbau.js` ist der Baukasten für Specs mit eigenem Turnier (Turnier, Klassen anlegen, einwiegen, auslosen, auf Matten verteilen, Kämpfe der Matte lesen), Vorbild `waage-runden-matte-und-app.spec.js` (Runde 2 während Runde 1 kämpft: Matte/Scoreboard-Sicht und Teilnehmer-App über Live-Snapshot → Ingest)
  - `npm run test:e2e:vollablauf` — separate Suite `tests/e2e-vollablauf/` (eigenes `playwright.vollablauf.config.js`) für den kompletten Online/Offline-Turnierablauf: startet zwei echte Serverprozesse parallel (Online gegen die echte Cloud-Postgres-DB, Offline gegen ein frisches eingebettetes PostgreSQL) und simuliert den Turnier-Transfer Cloud ↔ Hallen-Server per Datei-Download/-Upload (die Matten spielt sie per Scoreboard direkt am Offline-Server); bewusst nicht Teil von `npm run test:e2e`, da sie in die echte Cloud-DB schreibt und deutlich langsamer läuft
- **Unit-Tests (reine Module):** `npm run test:unit` — `node:test` für `src/shared/`- und Sync-Hilfsmodule (`tests/unit/`); Tests mit Datenbank (`migration-sync`, `urkundenVorlagenTransfer`) starten über `tests/helpers/testPostgres.js` ein eigenes eingebettetes PostgreSQL in einem temporären Verzeichnis (je ~7 s)
- Kein Lint-Script konfiguriert

## Umfang / bewusste Auslassungen
- Kein separater Team-Ligabetrieb (Bundesliga-Startgenehmigungen/Transferfenster) — siehe
  „Mannschaftskämpfe“ oben; einzelne Turniertage mit Mannschaftskämpfen sind abgedeckt
- Keine Kampfrichter-/Scoring-Logik (IJF-Kampfregeln zu Wurftechniken/Bewertungen sind nicht Teil der Anwendung)
