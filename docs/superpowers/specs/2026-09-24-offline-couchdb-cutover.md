# Offline-Cutover: SQLite → CouchDB/PouchDB — Ergänzung zur Zielarchitektur

Status: genehmigt (Design), Umsetzung folgt phasenweise
Datum: 2026-09-24
Branch: `Couch-DB`
Basis-Spec: [2026-09-22-couchdb-pouchdb-migration-design.md](2026-09-22-couchdb-pouchdb-migration-design.md)

## Zweck dieser Ergänzung

Die Basis-Spec beschreibt die Zielarchitektur (Online-Cloud-CouchDB + lokale CouchDB am
Technik-Koffer + PouchDB-Clients) und ordnet die Umsetzung in 5 Phasen. Sie lässt für den
**heutigen Offline-Modus (SQLite)** zwei konkrete Fragen offen, die für den Umsetzungsstart
geklärt werden müssen:

1. Der heutige Offline-Modus ist nicht "ein Turnier, kein Login" (das Zielbild des
   Technik-Koffers), sondern eine vollständige lokale Kopie des gesamten Schemas inkl.
   `vereine`/`benutzer` und einer Turnier-Liste (`turniere.html`). Wie bildet sich das im
   "eine CouchDB-DB pro Turnier + Accounts-DB nur online"-Modell der Basis-Spec ab, ohne
   dass sich heutiges Verhalten ändert?
2. Wo läuft die "lokale CouchDB" für Entwicklung/heutigen Offline-Betrieb technisch —
   erfordert das eine separate CouchDB-Serverinstallation?

## Vorgabe für diese Phase

**Der Umbau in dieser Phase betrifft ausschließlich den lokalen/Offline-Betrieb
(`IS_OFFLINE=true`).** Der Online-Betrieb (Postgres via Knex) bleibt vollständig unverändert
— das ist eine spätere, eigene Phase. Ziel: Offline-Verhalten bleibt aus Nutzersicht 1:1
identisch zu heute (SQLite), nur der Datenspeicher darunter wechselt zu CouchDB, und die
Wettkampf-Seiten bekommen zusätzlich PouchDB-Clients mit Replikation (statt REST-Fetch) —
das ist Phase 1 + Phase 2 der Basis-Spec, eingegrenzt auf lokal.

## Entscheidung 1: Datenbank-Topologie für Offline

Übertragung des Basis-Spec-Modells 1:1 auf den lokalen Fall, ohne Neuerfindung:

- **`offline_accounts`** (eine lokale CouchDB-Datenbank): `vereine`, `benutzer`,
  `mitgliedschaften` — Pendant zu den heutigen lokalen SQLite-Tabellen. Wird über die
  bereits vorhandenen `vereineRepository.js`/`benutzerRepository.js`/
  `mitgliedschaftenRepository.js` bedient (die sind bereits genau für dieses
  "eine geteilte Accounts-DB"-Muster gebaut, siehe CLAUDE.md). Automatische
  Provisionierung von `offline_user`/"Offline Club" beim ersten Request, analog zur
  heutigen Logik in `requireAuth` (`src/middleware/auth.js`).
- **`turnier_<uuid>`** pro angelegtem Turnier: Pools/Teilnehmer/Kämpfe/Kampfflächen/
  Mannschaften/Mannschaftsmitglieder/Mannschaftskämpfe + der bereits vorhandene
  `turnier:meta`-Singleton-Doc (`turnierRepository.js`).
- **Turnier-Liste** (`turniere.html`, heute `SELECT * FROM turniere`): lokale
  CouchDB-Datenbanken mit Präfix `turnier_` auflisten (`nano.db.list()`), je Datenbank den
  `turnier:meta`-Doc lesen. Kein Cross-DB-Index nötig, da die Anzahl lokaler Turnier-DBs
  klein bleibt (ein Verein legt nicht hunderte Turniere lokal an).

Das ist rein additiv zum bereits gebauten `src/db/`-Fundament — keine der bestehenden
Repositories/Kaskaden muss dafür geändert werden.

## Entscheidung 2: "Lokale CouchDB" ohne separate Serverinstallation

Statt eine echte Apache-CouchDB-Installation als Voraussetzung zu verlangen (zusätzlicher
Infrastruktur-Schritt für jeden Entwickler und jeden Technik-Koffer), wird die lokale
CouchDB **eingebettet im selben Node-Prozess** betrieben:

- `express-pouchdb` (bereits als Dev-Dependency für die Unit-Test-Infrastruktur vorhanden,
  siehe `tests/unit/helpers/couchTestServer.js`) wandert nach `dependencies` und wird auch
  produktiv verwendet — dieses Paket ist genau dafür gebaut, PouchDB in einen
  vollständigen, HTTP-CouchDB-API-kompatiblen Server zu verwandeln.
- Anders als im Test-Setup (Adapter `memory`, flüchtig) nutzt der produktive Einsatz den
  **Standard-Node-Adapter von PouchDB** (LevelDB-basiert, persistent auf Platte) — kein
  zusätzliches Adapter-Paket nötig. Datenverzeichnis: `data/couchdb/` (Konvention analog zu
  `DB_SQLITE_PATH`), Default `./data/couchdb`, überschreibbar über eine neue optionale
  `.env`-Variable `COUCHDB_LOCAL_PATH`.
- Gemountet unter demselben Express-`app`, Pfadpräfix `/_couch` (kein zweiter Port,
  vereinfacht spätere Firewall-Situation am Technik-Koffer-WLAN für Phase 2/Phase 5). Nur
  aktiv, wenn `IS_OFFLINE=true`. `src/db/couch.js` (`connect`, `ensureDatabase`) wird dafür
  unverändert weiterverwendet — es kennt nur eine Basis-URL, ob die auf eine echte CouchDB
  oder auf `express-pouchdb` zeigt, ist ihm egal (beide sprechen dasselbe HTTP-Protokoll).
- Für die künftige Hochverfügbarkeits-Phase (Basis-Spec, Phase 5, zwei baugleiche
  Linux-Notebooks) bleibt die Option offen, `express-pouchdb` dort durch eine echte
  CouchDB-Installation zu ersetzen (z.B. wegen `keepalived`-Replikations-Anforderungen) —
  das ist eine reine Infrastrukturentscheidung für später und ändert an der Anwendung
  nichts, da beide Seiten dasselbe HTTP-API sprechen.

## Migrationsstrategie: additiv, dann Umschaltung, nie gleichzeitig kaputt

Um während der Migration nie einen Zwischenzustand zu erzeugen, in dem Offline-Funktionen
nicht mehr wie mit SQLite funktionieren, läuft jede Umstellung eines Bereichs zweistufig:

1. **Additiv:** Neue CouchDB-Logik wird gebaut und (wo sinnvoll) parallel zur bestehenden
   Knex-Logik ausgeführt, ohne dass sich sichtbares Verhalten ändert. Eigenständig testbar.
2. **Umschaltung:** Sobald der konsumierende Bereich (z.B. ein Controller) selbst auf
   CouchDB migriert ist, wird die parallele Knex-Schreib-/Leselogik für diesen Bereich
   entfernt.

Knex/SQLite bleiben für den Offline-Modus so lange vollständig funktionsfähig bestehen, bis
**alle** Controller migriert sind — erst danach wird die Offline-Knex-Konfiguration
(`knexfile.cjs`, `--env offline`) entfernt.

## Umsetzungsreihenfolge (je ein eigener Umsetzungsplan)

1. **Fundament:** eingebettete lokale CouchDB, `offline_accounts`-Bootstrap (additiv neben
   der bestehenden Knex-Logik), Turnier-DB-Registry (öffnen/cachen per `turnierId`)
2. Turniere-Controller/Routes (Liste + CRUD) — erste echte Umschaltung, inkl. Anpassung von
   `requireTurnierAktiv` (`src/middleware/auth.js`)
3. Vereine-Controller (Offline-Pfad) — schaltet auf `offline_accounts` um, danach kann die
   parallele Knex-Provisionierung aus Schritt 1 entfernt werden
4. Teilnehmer-Controller
5. Pools-Controller (nutzt die 8 bereits gebauten `*PoolKaskade.js`-Module)
6. Kampfflächen-Controller
7. Kämpfe-Controller (nutzt `kaempfeKaskade`/`pausenPruefung`)
8. Mannschaften- + Mannschaftskämpfe-Controller (nutzt `mannschaftsBegegnungKaskade`)
9. Offline-Import/Export-Controller (`offlineController.js`)
10. E2E-Test-Setup (`tests/e2e/global-setup.js`) auf die eingebettete lokale CouchDB
    umstellen, Entfernen der Offline-Knex-Konfiguration
11. Voller automatisierter Testlauf + manueller Funktionsdurchlauf aller Offline-Seiten

**Ausdrücklich nicht Teil dieser Phase** (folgt danach als eigener Plan, Basis-Spec Phase 2):
PouchDB im Browser (Ersatz von REST-Fetch durch Replikation), beginnend mit der Waage.
Diese Phase bereitet dafür nur das Fundament (CouchDB als Datenspeicher) vor — die Clients
sprechen bis dahin weiterhin über die bestehenden REST-Endpunkte mit dem Server, nur dass
der Server jetzt CouchDB statt SQLite als Speicher nutzt.

## Nicht-Ziele dieser Phase

- Keine Navigations-Vereinfachung (Login/Vereins-Auswahl/Turnier-Liste bleiben lokal exakt
  wie heute erreichbar) — das ist explizit Teil von Phase 2 der Basis-Spec, nicht dieser.
- Keine Online-CouchDB, kein Sync-Werkzeug, keine Hochverfügbarkeit — unverändert spätere
  Phasen der Basis-Spec.
