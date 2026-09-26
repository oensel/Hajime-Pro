# Plan B – Offline-Clients (CouchDB-Umbau) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Kompakter als Plan A: Dieser Plan wird in derselben Sitzung umgesetzt, in der er entsteht. Er legt
> Schnittstellen, Kernlogik und Testfälle fest; der Code entsteht testgetrieben pro Task.

**Goal:** Notebooks/Tablets laufen mit `SYNC_ROLLE=client` als eigener Node-Knoten (Browser → `http://localhost:3000`) mit lokaler PouchDB. Waage, Scoreboard und Mattenleitung funktionieren ohne Verbindung zum Hallen-Server weiter, rechnen die Folgekämpfe ihrer Matte selbst und übertragen alles automatisch, sobald der Server wieder erreichbar ist.

**Architecture:**
- **Client-Knoten:** keine relationale DB. Er betreibt:
  - eine lokale Dokument-DB unter `/db` (nur von `localhost` erreichbar);
  - eine Live-Replikation in beide Richtungen zur Turnier-DB des Servers;
  - eine kleine **Client-API**, die die Lese-Endpunkte der Seiten aus den lokalen Dokumenten beantwortet;
  - `kaskadeLokal`, das nach jedem Ergebnis die Folgekämpfe der gewählten Matte berechnet.
- **Datenweg im Frontend:** `datenzugriff.js` bleibt unverändert und spricht mit dem lokalen `/db`.
- **Auf dem Server** kommen hinzu: Auflösung von CouchDB-Konflikten, der Status `klaerung`, das `turnier:`-Dokument und eine Konfliktliste.
- **Altlast:** Der alte JSON-Offline-Mechanismus entfällt.

**Tech Stack:** wie Plan A; `node:test`, Playwright mit **zwei** Webservern (Server Port 3200, Client Port 3201).

**Spec:** `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md` (Abschnitte 4, 6–8, 10, 12, 13)

## Global Constraints

- Wie Plan A: deutsche Bezeichner/Kommentare, `src/shared/` DB-/DOM-frei, ohne `SYNC_ROLLE` exakt heutiges Verhalten, `npm run test:e2e` bleibt grün (abzüglich der bewusst entfernten Alt-Offline-Specs).
- Client-Knoten öffnen **keine** knex-Verbindung.
- Replikation zum Server immer mit `skip_setup: true` (nie eine DB auf dem Server anlegen).
- Mannschafts-Pools: kein Offline-Rechnen (Stufe 2); Auswechseln und Mannschaftszuordnung offline gesperrt.
- Commit-Trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Festlegungen, die über die Spec hinausgehen

1. **`turnier:<id>`-Dokument:** Die Turnierzeile ohne PDF-Spalten plus `status_effektiv` und `hat_ausschreibung`. Waage, Menü und Scoreboard lesen `/api/turniere/:id` bzw. `/api/turniere`; dafür braucht der Client die Turnierzeile. Sie ist klein und ändert sich am Wettkampftag kaum. Der Grundsatz „CouchDB enthält nicht das ganze Turnier“ bleibt gewahrt.
2. **Client-API** (`src/sync/clientApi.js`) statt Umbau aller Seiten:
   - Nicht unterstützte `GET`-Aufrufe liefern `404 { error: 'Nur am Server verfügbar' }`.
   - Schreibende Aufrufe außerhalb von `/api/sync` liefern `403` mit derselben Meldung. Alle Schreibvorgänge laufen ohnehin über `datenzugriff.js` → `/db`.
3. **Offline-Einreihung:** Neu spielbar gewordene Kämpfe bekommen offline keine `matten_reihenfolge`. `baueMattenAnsicht` sortiert `NULL` ans Ende (nach ID). Das entspricht „hinten anhängen“. Die Pausenregel wird offline **nicht** zusätzlich angewendet; das war im bisherigen JSON-Offline-Modus genauso. Die Pausenwarnung der Mattenansicht funktioniert trotzdem, weil sie aus Dokumenten berechnet wird.
4. **Kaskaden-Schreibvorgänge** tragen `bearbeitet_von: 'kaskade:<clientId>'`. Die Brücke ignoriert sie, weil der Server selbst maßgeblich nachrechnet.
5. **`SYNC_SECRET`:** Replikationsanfragen ohne Browser-Kennung (`Sec-Fetch-Mode`-Header fehlt) müssen den Header `x-hajime-sync-secret` tragen, sonst gibt es `401`. Browser auf dem Server-Frontend sind davon ausgenommen, weil die Hallen-REST-API ohnehin offen ist (Offline-Mock-User). Das ist ein Schutz gegen versehentliche fremde Replikation, nicht gegen Angreifer im LAN.

## Dateiübersicht

| Datei | Neu/Ändern | Verantwortung |
|---|---|---|
| `src/sync/abgleich.js`, `src/controllers/turnierController.js` | ändern | `turnier:`-Dokument (Export `ermittleEffektivenStatus`, `TURNIER_SPALTEN_OHNE_PDF`) |
| `src/sync/clientDienst.js` | neu | Client-Knoten: lokale DB, Instanz, Replikation, Status, Leerlauf/Trennen für Tests |
| `src/sync/replikation.js` | neu | Live-Replikation mit Retry, Zähler ausstehender Änderungen, Uhr-Offset |
| `src/sync/clientKonfig.js` | neu | `clientId`, gewählte Matte (`_local/client-konfig`), Heartbeat `client:<clientId>` |
| `src/sync/kaskadeLokal.js` | neu | Offline-Kaskade der gewählten Matte |
| `src/shared/kaskadeDokumente.js` | neu | rein: `berechneKaskadenPatches(kampfDokumente)` (bündelt Gruppen-Überkreuz + Standard, iteriert bis stabil) |
| `src/sync/clientApi.js` | neu | Lese-Endpunkte aus Dokumenten, Sperre für den Rest |
| `src/sync/syncDienst.js`, `src/sync/bruecke.js` | ändern | `SYNC_SECRET`, `_conflicts`-Auflösung, Status `klaerung`, Konflikt-API |
| `src/routes/syncRoutes.js` | ändern | Client-Status, Mattenwahl, Konfliktliste, Test-Endpunkte |
| `src/app.js` | ändern | Client-Modus: keine knex-Routen, statische Allowlist |
| `public/client.html`, `public/js/client.js` | neu | Startseite des Clients (Mattenwahl, Links, Sync-Status) |
| `public/js/syncStatus.js` | neu | Statusleiste für Client-Seiten |
| `public/js/menu.js` | ändern | Client-Modus: nur Waage/Scoreboard/Mattenleitung im Menü |
| `public/js/scoreboard.js`, `public/js/kampf.js` | ändern | Matte aus Client-Konfig, „Matte wechseln“ mit Nachfrage; Altlast entfernen |
| `public/matten.html` + `public/js/matten.js` | ändern | Konfliktliste (Server) |
| `src/controllers/offlineController.js`, `src/routes/offlineRoutes.js` | löschen | Altlast |
| `playwright.sync.config.js`, `tests/e2e-sync/*` | ändern/neu | zweiter Webserver (Client), Offline-Szenarien |
| `tests/e2e/steuerung-offline-modus.spec.js`, `tests/e2e/steuerung-*-online-vs-offline.spec.js` | löschen/ersetzen | durch Sync-Vergleichstests |

---

### Task B1: `turnier:`-Dokument im Abgleich
- [ ] Test (`sync-abgleich.spec.js`): Das Dokument `turnier:<id>` existiert, `bezeichnung` stimmt, ein Feld `ausschreibung_pdf` gibt es nicht, und `altersklassen` ist das Original aus der DB.
- [ ] `turnierController.js`: `TURNIER_SPALTEN_OHNE_PDF` und `ermittleEffektivenStatus` exportieren.
- [ ] `abgleich.js`: Die Turnierzeile mit diesen Spalten laden, dazu `status_effektiv` (mit `turnierHatEchteKaempfe`) und `hat_ausschreibung`. Tabelle `turniere` → Typ `turnier` in `LIVE_TABELLEN`, aber gesondert geladen.
- [ ] Sync-Suite und Unit-Tests grün, Commit.

### Task B2: Client-Knoten – lokale DB, Replikation, Status (Zwei-Server-Testaufbau)
- [ ] `playwright.sync.config.js`: `webServer` als Array; Client auf Port 3201 mit `SYNC_ROLLE=client`, `SYNC_SERVER_URL=http://localhost:3200`, `SYNC_DATENVERZEICHNIS=./data/test-sync-client`, `SYNC_SECRET` auf beiden Seiten gleich, `NODE_ENV=test`. Global-Setup leert zusätzlich das Client-Verzeichnis.
- [ ] Test `sync-client-grundlagen.spec.js` (über einen zweiten `request`-Kontext auf `http://localhost:3201`):
  - Client-Status meldet `rolle: 'client'`, `verbunden: true` und dieselbe `instanz_id` wie der Server.
  - Ein Server-Dokument erscheint in der lokalen `/db`.
  - Ein lokales Dokument erscheint auf dem Server.
  - Ein Request von außen auf das Client-`/db` ist nicht Teil des Tests (die localhost-Prüfung sichert der Code).
- [ ] `app.js`: Bei `SYNC_ROLLE=client` keine knex-Instanz, keine knex-Routen. `/db` = lokale PouchDB (Middleware: nur Loopback-Adressen, nur die aktuelle Instanz-DB).
- [ ] `clientDienst.js`:
  - `starteClientDienst(konfig)`.
  - Instanz ermitteln: `GET ${SYNC_SERVER_URL}/api/sync/status` (bei Fehler die zuletzt bekannte Instanz aus `_local`-Datei `instanz.json` im Datenverzeichnis).
  - Lokale DB `turnier_<instanz>` öffnen; `replikation.starte()`.
  - Alle 5 s den Server-Status prüfen (Erkennung eines Instanzwechsels, siehe B8).
- [ ] `replikation.js`:
  - `PouchDB.sync(lokal, remote, { live: true, retry: true })`; `remote` mit `skip_setup: true` und dem Header `x-hajime-sync-secret`.
  - Zustand `{ verbunden, ausstehend, fehler }`. `ausstehend` = lokale Änderungen seit der zuletzt gepushten Sequenz (`db.info().update_seq` minus `last_seq` des Push-Checkpoints, ermittelt über die Events `change`/`paused`).
  - Uhr-Offset aus dem `Date`-Header der Status-Antwort des Servers.
- [ ] `syncRoutes.js`: Client-Status `{ rolle, instanz_id, db_name, verbunden, ausstehend, fehler, matte_id, client_id }`. Test-Endpunkte `POST /api/sync/test/trennen|verbinden|leerlauf`; `leerlauf` wartet, bis `verbunden && ausstehend === 0` und die Pull-Seite ruht.
- [ ] `syncDienst.js` (Server): `SYNC_SECRET`-Prüfung gemäß Festlegung 5.
- [ ] Tests grün, Commit.

### Task B3: Client-API und eingeschränktes Frontend
- [ ] Test `sync-client-frontend.spec.js`:
  - `GET :3201/pools.html` → Hinweisseite „nur am Server“.
  - `GET :3201/steuerung.html`, `/kampf.html`, `/teilnehmer.html` und `/client.html` → 200.
  - `GET :3201/api/kaempfe?kampfflaecheId=` liefert dieselbe Ansicht wie der Server.
  - `POST :3201/api/pools` → 403.
- [ ] `clientApi.js` (alles aus lokalen Dokumenten):
  - `GET /api/config` → `{ isOffline: true, syncRolle: 'client' }`
  - `GET /api/auth/mode`, `POST /api/auth/verify` (SHA-256 gegen `konfig:steuerung.steuerung_passwort_sha256`)
  - `GET /api/auth/me` (Offline-Mock-Benutzer wie in `requireAuth`)
  - `GET /api/turniere` (Array mit dem Turnier), `GET /api/turniere/:id` (mit geparsten Altersklassen, `teilnehmer_anzahl`)
  - `GET /api/kampfflaechen?turnierId`
  - `GET /api/kaempfe?kampfflaecheId` (`baueMattenAnsicht`)
  - `GET /api/teilnehmer?turnierId` (nach Nachname sortiert), `GET /api/teilnehmer/:id`
  - `GET /api/mannschaften?turnierId` → `[]`, `GET /api/pools/vorhanden` → `{ gesperrt }` (aus Kampf-Dokumenten)
  - `/api/djb-klassen` und `/api/graduierungen` bleiben die statischen Routen aus `app.js`
  - Sonst `404`/`403` gemäß Festlegung 2.
- [ ] Statische Allowlist im Client-Modus: `client.html`, `steuerung.html`, `kampf.html`, `teilnehmer.html`, `anzeige.html`, `overlay.html`, `login.html` + `/js`, `/css`, Bilder. `/` → `client.html`. Alle anderen `.html` → Hinweisseite.
- [ ] `menu.js`: Bei `syncRolle === 'client'` nur die Menüpunkte Teilnehmer/Waage, Mattenleitung, Scoreboard (neu, `steuerung.html`) und Start (`client.html`) zeigen.
- [ ] `client.html`/`client.js`: Mattenwahl (siehe B5), Links, Statusleiste.
- [ ] Tests grün (Server-Suite unverändert), Commit.

### Task B4: `kaskadeLokal` (Offline-Kaskade)
- [ ] Unit-Test `kaskadeDokumente.test.js`: DK8-ähnliche Fixtur mit Quellverknüpfungen. Nach dem Beenden zweier Vorkämpfe liefert `berechneKaskadenPatches` die Slots des Folgekampfs; Gruppen-Überkreuz-Halbfinale werden berücksichtigt; wiederholtes Anwenden bis zum Fixpunkt.
- [ ] `src/shared/kaskadeDokumente.js`: `berechneKaskadenPatches(kaempfe) → Map<id, patch>`. Die Iteration entspricht `aktualisiereTurnierOffline` in `scoreboard.js`, ohne Anzeige-Namen (die liefert `baueMattenAnsicht`).
- [ ] `kaskadeLokal.js`:
  - Hört auf den lokalen `_changes`-Feed.
  - Bei einem `kampf:`-Dokument mit `bearbeitet_von: 'browser'` in einem Einzel-Pool der gewählten Matte: alle Kampf-Dokumente des Pools laden, Patches berechnen, geänderte Dokumente mit `bearbeitet_von: 'kaskade:<clientId>'` in einem Rutsch schreiben (`bulkDocs`).
- [ ] `bruecke.js`: `bearbeitet_von` mit dem Präfix `kaskade:` ignorieren.
- [ ] E2E (`sync-client-offline.spec.js`, Teil 1): Client getrennt → kompletter DK8-Pool über `:3201/steuerung.html` → alle 11 Kämpfe lokal beendet, Finale korrekt → verbinden → Leerlauf beider Seiten → Server-SQL identisch zum Referenzergebnis (Anna gewinnt, alle beendet).
- [ ] Commit.

### Task B5: Mattenwahl, „Matte wechseln“ mit Nachfrage, Heartbeat
- [ ] `clientKonfig.js`:
  - `clientId` (UUID, einmalig in `_local/client-konfig`).
  - `matte_id` ändern mit `setzeMatte(id)`.
  - Heartbeat alle 30 s (und sofort bei einem Mattenwechsel) als `client:<clientId>`: `{ dokumenttyp: 'client', geraet: os.hostname(), matte_id, letzter_kontakt, ausstehend }`; nur solange verbunden.
- [ ] Routen: `GET /api/sync/client/matte`, `PUT /api/sync/client/matte { matte_id }`. Die Antwort enthält `warnung`, falls laut Heartbeat ein anderer Client (Kontakt < 2 min) die Ziel-Matte bedient.
- [ ] Frontend:
  - `client.html` und `scoreboard.js`/`kampf.js` im Client-Modus: Matte aus der Client-Konfig vorwählen.
  - Ein Wechsel über das Dropdown bzw. „Matte wechseln“ fragt über `zeigeZentraleBestaetigung` nach. Der Text nennt die ausstehenden Änderungen, einen laufenden Kampf und die Warnung.
- [ ] `kaskadeLokal` rechnet nur für `matte_id`.
- [ ] E2E: erster Aufruf ohne Matte → Auswahl; Wechsel mit Nachfrage (Abbrechen behält die Matte); Warnung, wenn ein zweiter Client-Heartbeat (per Dokument simuliert) die Ziel-Matte bedient.
- [ ] Commit.

### Task B6: Sync-Statusleiste
- [ ] `syncStatus.js`: Fragt alle 2 s `/api/sync/status` ab und zeigt eine kleine feste Leiste:
  - grün „verbunden“
  - gelb „offline – n Änderungen ausstehend“
  - rot bei `fehler`
  - blau „Turnierwechsel läuft“
- [ ] Wird auf den Client-Seiten eingebunden (auf dem Server nur, wenn `rolle === 'server'` gemeldet wird, dann immer grün).
- [ ] E2E: Nach dem Trennen zeigt die Leiste „offline“ mit der Anzahl, nach dem Verbinden „verbunden“.
- [ ] Commit.

### Task B7: Konfliktfälle auf dem Server
- [ ] **`_conflicts`:** Die Brücke liest den Feed mit `conflicts: true`. Für Dokumente mit `_conflicts` lädt sie alle Revisionen.
  - Teilnehmer: Die Revision mit dem jüngsten `gewogen_am` gewinnt.
  - Sonst gewinnt die Revision mit der höchsten `epoche`, bei Gleichstand die von CouchDB gewählte.
  - Verlierer löschen; weicht der Gewinner von der aktuellen Revision ab, als neue Revision schreiben. Danach normal verarbeiten.
- [ ] **Status `klaerung`:** Enthält ein Kampf-Dokument einer Matte ein Ergebnis (`status` `beendet`), während SQL andere `kaempfer1_id`/`kaempfer2_id` hat, wird das Ergebnis nicht angewendet.
  - SQL-Kampf: `status = 'klaerung'`
  - Konflikt-Dokument `konflikt_typ: 'klaerung'`, `prioritaet: 'hoch'`
  - Abgleich
- [ ] **Konflikt-API (Server):**
  - `GET /api/sync/konflikte` (offene, hohe Priorität zuerst)
  - `POST /api/sync/konflikte/:id/erledigt`
  - `POST /api/sync/konflikte/:id/wiederholen`: `sync_angewendet` für `bezug_id` löschen und die aktuelle Revision des Bezugsdokuments erneut verarbeiten
- [ ] **UI:** `matten.html` bekommt den Abschnitt „Sync-Konflikte“ (nur wenn `rolle === 'server'`) mit Liste, Knöpfen und Anzeige beider Versionen (JSON aufklappbar).
- [ ] E2E:
  - Konflikt per `_bulk_docs` mit `new_edits: false` erzeugen → gewinnt die jüngere Wiegung
  - Klärungsfall per Dokument mit falscher Paarung
  - Konfliktliste sichtbar, „erledigt“ entfernt den Eintrag
- [ ] Commit.

### Task B8: Instanzwechsel am Client
- [ ] Der `clientDienst` erkennt bei der Statusabfrage eine neue `instanz_id`:
  - Replikation stoppen, Status blau.
  - Nicht übertragene lokale Änderungen (Dokumente, deren `_rev` nicht mit dem Server übereinstimmt bzw. die es dort nicht gibt: Vergleich per `revsDiff` gegen den Server, falls erreichbar; sonst alle Nicht-Server-Dokumente) nach `data/verworfen/<alte_instanz>_<zeitstempel>.json` schreiben.
  - Lokale DB löschen, neue öffnen, Replikation starten.
  - Status meldet `instanz_gewechselt_am`; die Seiten laden bei einer Änderung der `instanz_id` neu (`syncStatus.js`).
- [ ] E2E: Client getrennt, zwei lokale Änderungen → auf dem Server ein neues Turnier anlegen → verbinden → Client hat die neue Instanz, die Server-DB enthält keine alten Dokumente, die Datei unter `verworfen/` enthält die beiden Änderungen (Test-Endpunkt `GET /api/sync/test/verworfen` liefert die Dateiliste).
- [ ] Commit.

### Task B9: Waage offline
- [ ] E2E (`sync-client-offline.spec.js`, Teil 2):
  - Client getrennt → auf `:3201/teilnehmer.html` 5 Judoka wiegen (per `Datenzugriff.speichereTeilnehmer` im Seitenkontext, eine davon über das Formular) und 1 Nachmeldung.
  - Das Ergebnis meldet `ausstehend: true`.
  - Verbinden → Leerlauf → Server-SQL hat alle Gewichte, die Nachmeldung genau einmal.
  - Außerdem: Die Mannschaftszuordnung ist offline gesperrt (Hinweis).
- [ ] `datenzugriff.js`: Bei `rolle === 'client' && !verbunden` nicht warten, sondern sofort `{ ok: true, ausstehend: true, meldung }` liefern.
- [ ] `waage-modal.js`: Mannschaftszuordnung im Client-Modus überspringen, solange nicht verbunden, mit Hinweis.
- [ ] Commit.

### Task B10: Altlast entfernen, Vergleichstests umziehen
- [ ] Die vier `steuerung-*-online-vs-offline.spec.js` als `tests/e2e-sync/client-vs-server-*.spec.js` neu anlegen.
  - Durchlauf 1: am Server-Frontend.
  - Durchlauf 2: am getrennten Client, danach verbinden.
  - Gleicher Vergleich über `normalisiereKaempfe`.
  - Die Fixturen/Aufbauten übernehmen, `request` jeweils gegen den richtigen Knoten.
- [ ] Löschen:
  - `tests/e2e/steuerung-offline-modus.spec.js` und die vier alten Specs
  - `offlineController.js`, `offlineRoutes.js` samt Einbindung in `app.js`
  - Offline-Export/-Import-UI in `kampf.js`/`kampf.html`
  - `offlineState`/`isOfflineMode` samt `aktualisiereTurnierOffline` und Datei-Import in `scoreboard.js`/`steuerung.html`
- [ ] `npm run test:e2e`, `test:e2e:sync` und `test:unit` grün.
- [ ] Commit.

### Task B11: Doku
- [ ] `CLAUDE.md`:
  - Client-Modus (`SYNC_ROLLE=client`, `SYNC_SERVER_URL`, `SYNC_SECRET`), Client-API, `kaskadeLokal`, Konfliktliste
  - Offline-Modus pro Matte neu beschreiben (ersetzt den JSON-Mechanismus)
  - Sync-Suite mit zwei Knoten
- [ ] Spec: Festlegungen 1–5 dieses Plans in die Abschnitte 4, 6, 7 und 10 übernehmen.
- [ ] Commit.
