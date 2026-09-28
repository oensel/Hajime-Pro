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
- **DB-Umschaltung:** `IS_OFFLINE=true` in `.env` → SQLite (`data/turnier.sqlite`, Pfad über `DB_SQLITE_PATH` überschreibbar); sonst PostgreSQL über `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT`. Im Hallenbetrieb (`IS_OFFLINE=true`) wählt `DB_CLIENT=pg` PostgreSQL statt SQLite (`src/utils/dbUmgebung.js`, Pflicht im Server-Cluster)
- **Sync-Modus (Hallen-Server):** `SYNC_ROLLE=server` (+ optional `SYNC_DATENVERZEICHNIS`, Standard `./data/dokumente`, und `SYNC_SECRET`) aktiviert die eingebettete Dokument-DB unter `/db`; genau ein Turnier pro Server, Anlegen/Import eines Turniers löscht das bisherige
- **Client-Gerät (Notebook/Tablet an Matte/Waage):** `SYNC_ROLLE=client`, `SYNC_SERVER_URL=http://<hallen-server>:3000`, `SYNC_SECRET` (wie am Server), optional `SYNC_DATENVERZEICHNIS`; `npm start`, Browser auf `http://localhost:3000` (Startseite `client.html`). Keine relationale DB, keine `IS_OFFLINE`/`DB_*`-Variablen nötig. Unter Windows das Datenverzeichnis möglichst vom Virenscanner ausnehmen (LevelDB-Dateien werden sonst gelegentlich beim Anlegen blockiert; `oeffneMitWiederholung` fängt das ab)
- **Server-Cluster (zwei Hallen-Server, Master/Secondary):** zusätzlich zu `SYNC_ROLLE=server` und `DB_CLIENT=pg`: `CLUSTER_KNOTEN` (`server1`|`server2`), `CLUSTER_PARTNER_URL` (feste Adresse des anderen Servers), optional `CLUSTER_VIP` (Anzeige), `CLUSTER_ZEUGE` (IP → Ping, URL → GET; leer = Default-Gateway), `CLUSTER_RUECKSTUFEN_BEFEHL` (Standard `sudo -n /usr/local/bin/hajime-rueckstufen.sh`). Ohne `CLUSTER_KNOTEN` ist der Server wie bisher immer Master. Betrieb (PostgreSQL-Replikation, keepalived, Skripte, Abnahme-Checkliste): `deploy/linux/README.md`
- **Migrationen:** kein npm-Script dafür — direkt über knex ausführen, z.B. `npx knex migrate:latest --knexfile knexfile.cjs --env offline` (oder `--env online`, auch für `DB_CLIENT=pg`; ohne `--knexfile` findet knex die `.cjs`-Datei nicht); Konfiguration in `knexfile.cjs`, Dateien in `migrations/`
- **Lokales PostgreSQL ohne Installation:** `npm run pg:start` / `pg:stopp` / `pg:status` (`scripts/lokale-pg.mjs`, Binaries aus der devDependency `embedded-postgres`, Daten in `data/pg-lokal`, trust-Auth nur auf 127.0.0.1, Port/DB-Name aus `DB_PORT`/`DB_NAME`); legt beim ersten Start die Instanz und die Datenbank an. Für den lokalen Server-Modus: `IS_OFFLINE=true`, `DB_CLIENT=pg`, `DB_HOST=127.0.0.1`, `DB_PORT=5433`, `SYNC_ROLLE=server`
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
  - `npm run test:e2e:vollablauf` — separate Suite `tests/e2e-vollablauf/` (eigenes `playwright.vollablauf.config.js`) für den kompletten Online/Offline-Turnierablauf: startet zwei echte Serverprozesse parallel (Online gegen die echte Cloud-Postgres-DB, Offline gegen eine frische SQLite) und simuliert den Turnier-Transfer Cloud ↔ Hallen-Server per Datei-Download/-Upload (die Matten spielt sie per Scoreboard direkt am Offline-Server); bewusst nicht Teil von `npm run test:e2e`, da sie in die echte Cloud-DB schreibt und deutlich langsamer läuft
- **Unit-Tests (reine Module):** `npm run test:unit` — `node:test` für `src/shared/`- und Sync-Hilfsmodule (`tests/unit/`)
- **Sync-Suite:** `npm run test:e2e:sync` — startet ZWEI Knoten: Hallen-Server (`SYNC_ROLLE=server`, Port 3200, `data/test-sync.sqlite`, `data/test-sync-dokumente/`) und ein Client-Gerät (`SYNC_ROLLE=client`, Port 3201, `data/test-sync-client/`). Testdaten werden in `playwright.sync.config.js` VOR dem Serverstart gelöscht (der Client fragt beim Start sofort den Server). Test-Endpunkte (nur `NODE_ENV=test`): `POST /api/sync/test/leerlauf` (Server: Brücke+Abgleich fertig; Client: alles übertragen), `POST /api/sync/test/trennen|verbinden` (Client offline/online), `GET /api/sync/test/verworfen`. Helfer in `tests/e2e-sync/helpers.js` (`syncLeerlauf`, `clientTrennen`, …); direkte `/db`-Zugriffe senden per `extraHTTPHeaders` das `SYNC_SECRET`
- **Cluster-Suite:** `npm run test:e2e:cluster` (`playwright.cluster.config.js`, `tests/e2e-cluster/`) — läuft ohne Docker, auch unter Windows: der Leitstand (`tests/e2e-cluster/leitstand.js`, webServer der Suite, Steuer-API Port 3309) baut zwei lokale PostgreSQL-Instanzen (Binaries aus der devDependency `embedded-postgres`, Ports 5511/5512, Standby per Low-Level-Backup-API statt `pg_basebackup`), zwei Hallen-Server (3311/3312) und ein Client-Gerät (3313) auf und simuliert keepalived (Gesundheit, `nopreempt`), die VIP (HTTP-Proxy 3310, `baseURL` der Tests) und den Zeugen. Ausfälle per `POST /knoten/:k/stoppen|starten`, `POST /zeuge/:k/trennen|verbinden`; Daten unter `data/test-cluster/` (Server-Logs in `logs/`). Die Tests bauen seriell aufeinander auf
- Kein Lint-Script konfiguriert

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
- **Routen als Factories mit Knex-Dependency-Injection:** jede Datei in `src/routes/` exportiert eine Funktion (`getXRoutes(knex)`), die in `src/app.js` mit der einen zentral erzeugten Knex-Instanz (Online/Offline je nach `IS_OFFLINE`) aufgerufen und gemountet wird; alle Schreib-Routen (`/api/turniere`, `/api/teilnehmer`, `/api/pools`, `/api/kampfflaechen`, `/api/kaempfe`, `/api/mannschaften`, `/api/mannschaftskaempfe`) laufen zusätzlich durch `requireWriteAuth` (`src/middleware/auth.js`); `/api/auth` und `/api/vereine` bewusst ohne dieses Gate (Login/Registrierung/Vereinsauswahl)
- **`src/shared/`** ist bewusst framework-/DB-frei gehalten (kein knex, kein DOM) und läuft identisch am Server und auf Client-Geräten (Offline-Kaskade, Mattenansicht):
  - `bracketTopologie.js` — deklarative Turnierbaum-Struktur pro Modus (welcher Kampf bezieht seine Kämpfer aus welchem Vorkampf)
  - `kampfProgression.js` — Kaskaden-Engine: befüllt Folgekämpfe erst, wenn beide Kämpfer-Slots feststehen
  - `pausenRegel.js` — Mindestpausenzeiten zwischen Kämpfen eines Athleten (DJB-WKO)
  - `mannschaftsProgression.js` — Kaskaden-Engine für Mannschaftsbegegnungen, das Pendant zu `kampfProgression.js` auf Ebene der Begegnungen statt der Einzelkämpfe
- **`src/services/*Manager.js`** — Turniermodus-Implementierungen (DoppelKo8/16/32Manager, GruppenUeberKreuzManager, JederGegenJedenManager), erzeugen die Kämpfe eines Pools beim Anlegen; für Mannschafts-Pools die entsprechenden `Mannschaft*Manager.js` (Jeder-gegen-Jeden, Doppel-KO-8/16), die Begegnungen statt Einzelkämpfe erzeugen
- **`src/services/mannschaftsBegegnungEngine.js`** — erzeugt pro Begegnung die Einzelkämpfe je gemeinsam besetzter Gewichtsklasse, wertet Sieg-/Wertungspunkte aus und lost bei vollständigem Gleichstand automatisch einen Stichkampf aus (DJB-WKO Art. 3.12.13.1); das Abschenken-Verbot (Art. 3.12.13.3) hängt in `teilnehmerController.js` an den bestehenden „nicht angetreten“/„disqualifizieren“-Aktionen
- **Offline-Betrieb an der Matte/Waage:** Client-Geräte (`SYNC_ROLLE=client`, siehe unten) laufen mit lokaler PouchDB weiter, wenn das WLAN zum Hallen-Server wegbricht, und replizieren automatisch nach. Der frühere JSON-Export/-Import pro Matte (`/api/offline`, Browser-Offline-Modus in `steuerung.html`) ist entfallen; Datei-Austausch gibt es nur noch für ganze Turniere (Cloud ↔ Hallen-Server, Turnier-Export/-Import mit `urspruengliche_id`)
- **Sync-Schicht (CouchDB-Umbau, `src/sync/`):** mit `SYNC_ROLLE=server` betreibt der Hallen-Server eine eingebettete Dokument-DB (PouchDB/LevelDB, `express-pouchdb` unter `/db`, eine DB `turnier_<instanz_id>` für das einzige Turnier; das vorhandene Turnier wird verzögert beim ersten `/api`-/`/db`-Request aktiviert). `abgleich.js` spiegelt die Live-Tabellen nach jedem Schreibzugriff als Dokumente (`bearbeitet_von: 'server'`, Typ in `dokumenttyp`), `bruecke.js` wendet Dokument-Änderungen von Waage/Scoreboard/Mattenleitung über die Service-Funktionen der Controller an (`aktualisiereKampf`, `werteForfeit`, `legeTeilnehmerAn`, …; werfen `FachFehler`) und meldet Ablehnungen per `letzte_ablehnung` + `konflikt:`-Dokument zurück. Das Frontend spricht über `public/js/datenzugriff.js` (REST ohne Sync, Dokument-DB mit Sync). Die relationale DB bleibt führend. Die Brücke ist reihenfolgeunabhängig (Replikation liefert nicht in Spielreihenfolge): Ergebnisse mit abweichender Paarung werden zurückgestellt und nachgeholt, bleibt die Abweichung, wird der Kampf `klaerung` (Konflikt hoch); CouchDB-Konflikte löst sie so, dass Geräte-Revisionen vor Server-Revisionen gewinnen, bei Wiegungen die jüngste (`gewogen_am`). Konfliktliste: `matten.html` (`public/js/konflikte.js`, `/api/sync/konflikte`). Design/Plan: `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md`, `docs/superpowers/plans/`
- **Client-Gerät (`src/sync/clientDienst.js`):** lokale PouchDB (nur von localhost über `/db`), Live-Replikation zum Server (`replikation.js`, zählt eigene noch nicht übertragene Änderungen über `geschrieben_von_knoten`), Client-API (`clientApi.js`, beantwortet die Lese-Endpunkte von Waage/Scoreboard/Mattenleitung/`menu.js` aus den lokalen Dokumenten; Verwaltungsseiten liefern einen Hinweis), Offline-Kaskade der gewählten Matte (`kaskadeLokal.js` → `src/shared/kaskadeDokumente.js`, schreibt `bearbeitet_von: 'kaskade:<clientId>'`, der Server ignoriert das und rechnet selbst), Mattenwahl + Heartbeat `client:<clientId>` (`clientKonfig.js`, nicht replizierte DB `hajime_client`), Turnierwechsel sichert nicht übertragene Änderungen unter `<SYNC_DATENVERZEICHNIS>/verworfen/`. Statusleiste: `public/js/syncStatus.js`
- **Server-Cluster (`src/cluster/`):** keepalived entscheidet, wer die VIP hält, und ruft über localhost `/api/cluster/befoerdern` bzw. `/zurueckstufen`; `/api/cluster/gesund` (PostgreSQL erreichbar, Zeuge erreichbar, keine ausstehende Rückstufung/Übergabe) ist sein Gesundheitscheck. `rollenLogik.js` (rein, Unit-Tests) entscheidet über Epoche, Beförderung und Rückstufung (höhere Epoche gewinnt, Gleichstand nach Netztrennung: server1); `clusterDienst.js` führt aus (Prüfzyklus 1 s, Zustand + Verlauf lokal in `<SYNC_DATENVERZEICHNIS>/cluster-zustand.json`, Rückstufung über `CLUSTER_RUECKSTUFEN_BEFEHL`, geplante Übergabe), `pgReplikation.js` befördert per `pg_promote()` und schaltet synchron/asynchron (`ALTER SYSTEM synchronous_standby_names`). Jeder Server startet als Secondary: der Sync-Dienst läuft dann im Modus `secondary` (keine Brücke/kein Abgleich, Instanz aus der Standby-DB, alle 2 s geprüft), `middleware/nurMaster.js` und die `/db`-Middleware lehnen Schreibzugriffe mit 409 ab. Die Turnier-Dokument-DB replizieren beide Server per Pull voneinander. Frontend: `cluster.html` (`public/js/cluster.js`, Menüpunkt und Secondary-Banner aus `menu.js`)
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
`login` → `verein_auswahl` → `turniere` (Turnierauswahl) → `turnier`/`teilnehmer`/`pools`/`mannschaften` (Verwaltung) → `matten`/`steuerung`/`kampf` (Live-Betrieb am Wettkampftag) → `waage` (Einwiegen per QR-Scan) → `anzeige`/`dashboard`/`siegerliste` (öffentliche Anzeigen); `cluster` (Status des Server-Clusters, nur Hallen-Server mit `CLUSTER_KNOTEN`), `client` (Startseite eines Client-Geräts)
