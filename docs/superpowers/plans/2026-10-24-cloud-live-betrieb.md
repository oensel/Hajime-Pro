# Cloud-Live-Betrieb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Cloud führt bis zu 10 Turniere gleichzeitig live (Dokument-DB, Abgleich, Brücke) und Geräte koppeln sich per QR an sie wie an einen Hallen-Server.

**Architecture:** Ein neuer Verwalter (`src/cloudLive/verwalter.js`) hält je Live-Turnier ein Instanz-Bündel (Dokument-DB, `erzeugeAbgleich`, `erzeugeBruecke` mit eigenem `zustand`). Ein Router unter `/turnierlive/:schluessel` spiegelt die Pfade, die ein Client am Hallen-Server benutzt (`/api/sync/status`, `/api/client/koppeln`, `/db/…`); Geräte bekommen `serverUrl = https://cloud/turnierlive/<schluessel>` und brauchen daher keine Code-Änderung in `clientKern`/`replikation`. Der Hallen-Server-Code (`syncDienst.js`) bleibt unverändert.

**Tech Stack:** Node.js ESM, Express, Knex/PostgreSQL, PouchDB + express-pouchdb, `node:test` (Unit), Playwright (E2E), Capacitor (Android).

**Spec:** `docs/superpowers/specs/2026-10-24-cloud-live-betrieb-design.md`

## Global Constraints

- Höchstens **10** gleichzeitig live geführte Turniere je Cloud-Prozess (`MAX_LIVE_TURNIERE = 10`), 11. Start → Fehler 409.
- Ein Turnier ist entweder am Hallen-Server oder in der Cloud live, nie beides; kein Übernehmen eines laufenden Turniers.
- Geräte-Berechtigung = Geheimnis aus dem QR (kein Konto), gilt für die Dokument-DB **genau eines** Turniers; `_all_dbs`, `_replicate`, `_users` u. ä. sind gesperrt.
- Der 6-stellige Kopplungscode gilt nur zusammen mit dem Turnierschlüssel (Pfad `/turnierlive/<schluessel>`); Fehlversuche begrenzt je IP (`erzeugeSperre` aus `src/sync/kopplung.js`) und je Turnier.
- Zugang läuft ab: 06:00 Uhr Berliner Zeit am Tag nach dem Turniertag (`endeDesTurniertags` aus `src/liveCloud/zugang.js`) oder mit „Live beenden“.
- Nur Betriebsmodus `cloud` (oder `CLOUD_LIVE_AKTIV=true` für Tests); am Hallen-Server gibt es die Funktion nicht.
- Keine Durchsage, kein Video-Streaming/-Archiv, kein Cluster in der Cloud.
- Deutsche Kommentare/Meldungen im Stil der Umgebung; Routen als Factories `getXRoutes(knex)`.

## Review Focus

1. Zwei Live-Turniere mit überlappenden SQL-IDs der Kämpfe: ein Gerät von Turnier A schreibt ein Dokument mit `sql_id` eines Kampfs von Turnier B → Brücke lehnt ab, B bleibt unverändert (Task 2).
2. Gerät ruft `/turnierlive/<A>/db/turnier_<instanz-von-B>` oder `/db/_all_dbs` bzw. `_replicate` → 404/403 (Task 4).
3. Code richtig, aber zu einem anderen Turnierschlüssel; 6 Fehlversuche je IP → 429 (Task 4).
4. „Live beenden“ während ein Gerät offline Änderungen hat; danach repliziert das Gerät → abgelehnt, Daten bleiben im Gerät erhalten (Task 6).
5. Cloud-Neustart bei laufenden Live-Turnieren → Instanzen werden wieder geöffnet, Geräte replizieren weiter (Task 3).

## Dateistruktur

- `migrations/20261101110000_cloud_live_betrieb.js` — Tabelle `cloud_live`, Spalte `turniere.auf_hallen_server_geholt_am`.
- `src/cloudLive/zugang.js` — Zugangsdaten je Turnier (Schlüssel, Geheimnis, Code, Ablauf, Sperre).
- `src/cloudLive/verwalter.js` — Verwalter der Live-Instanzen (öffnen, schließen, Abgleich anstoßen, Neustart-Wiederaufnahme).
- `src/cloudLive/geraeteRoutes.js` — Router `/turnierlive/:schluessel` für Geräte (Status, Koppeln, `/db`).
- `src/cloudLive/verwaltungRoutes.js` + `src/routes/…` Einbindung — `/api/cloud-live` für Admins (Status, Starten, Beenden, Code, Sperre).
- `src/sync/bruecke.js` — Abschottungsprüfung (Option `abschottung` am `zustand`).
- `public/cloud-live.html`, `public/js/cloudLive.js` — Oberfläche zum Live-Schalten mit QR.
- `src/cloudLive/teilnehmerAppFeed.js` — Teilnehmer-App-Speisung aus dem Live-Turnier.
- `desktop/…`, `mobil/…` — Geräteauswahl (Hallen-Server suchen, sonst Cloud nach Rückfrage).
- Tests: `tests/unit/cloudLive*.test.js`, `tests/e2e/cloud-live*.spec.js`.

---

### Task 1: Datenmodell und Zugang je Turnier

**Files:**
- Create: `migrations/20261101110000_cloud_live_betrieb.js`, `src/cloudLive/zugang.js`
- Test: `tests/unit/cloudLiveZugang.test.js`

**Interfaces:**
- Produces (`src/cloudLive/zugang.js`):
  - `starteZugang(knex, turnierId): Promise<ZugangDaten>` — legt `cloud_live` an (Schlüssel 16 Byte base64url, Geheimnis 32 Byte hex, Code 6 Ziffern, `instanz_id` UUID); gibt es schon eine aktive Zeile, wird sie geliefert.
  - `ladeZugang(knex, turnierId): Promise<ZugangDaten | null>`, `ladeZugangPerSchluessel(knex, schluessel): Promise<ZugangDaten | null>`
  - `pruefeCode(knex, schluessel, code): Promise<{ ok: true, geheimnis: string } | { ok: false, grund: 'ungueltig'|'gesperrt'|'abgelaufen' }>`
  - `pruefeGeheimnis(knex, schluessel, geheimnis): Promise<{ ok: true, zugang: ZugangDaten } | { ok: false, grund: ... }>` (zeitkonstanter Vergleich)
  - `erneuereZugang(knex, turnierId)` (neuer Code **und** neues Geheimnis; alte Geräte müssen neu koppeln), `setzeGesperrt(knex, turnierId, gesperrt: boolean)`, `beendeZugang(knex, turnierId)` (setzt `beendet_am`)
  - `ZugangDaten = { turnierId, schluessel, geheimnis, code, instanzId, gesperrt: boolean, gueltigBis: Date | null, beendetAm: Date | null }`

- [ ] **Step 1: Failing tests** in `tests/unit/cloudLiveZugang.test.js` (Muster: `tests/unit/liveCloudZugang*.test.js`, eingebettetes PostgreSQL über `tests/helpers/testPostgres.js`): `starteZugang` liefert 6-stelligen Code und einen 22-stelligen Schlüssel und ist idempotent; `pruefeCode` mit richtigem Code → `ok` + Geheimnis, falscher Code → `ungueltig`; Code eines anderen Turniers unter dem Schlüssel → `ungueltig`; nach `setzeGesperrt(true)` → `gesperrt`; nach `beendeZugang` → `ungueltig`; Turnier mit Datum gestern (Ende des Turniertags überschritten, `jetzt` injiziert) → `abgelaufen`; `erneuereZugang` macht Code **und** Geheimnis des alten Stands ungültig.
- [ ] **Step 2:** `npx node --test tests/unit/cloudLiveZugang.test.js` → FAIL (Modul fehlt).
- [ ] **Step 3: Migration** `cloud_live(turnier_id PK FK turniere ON DELETE CASCADE, schluessel unique, geheimnis, code, instanz_id uuid, erzeugt_am, gesperrt_am null, beendet_am null)`; `turniere.auf_hallen_server_geholt_am` timestamp null. `down` entfernt beides.
- [ ] **Step 4: `zugang.js` implementieren**; Ablauf über `endeDesTurniertags(turniere.datum)` (Parameter `jetzt` injizierbar wie in `src/liveCloud/zugang.js`).
- [ ] **Step 5:** Test → PASS; `npx knex migrate:latest --knexfile knexfile.cjs --env online` gegen Test-DB läuft ohne Fehler.
- [ ] **Step 6: Commit** `git add migrations/20261101110000_cloud_live_betrieb.js src/cloudLive/zugang.js tests/unit/cloudLiveZugang.test.js && git commit -m "Cloud-Live: Zugang und Datenmodell je Turnier"`

### Task 2: Brücke gegen fremde Turniere abschotten

**Files:**
- Modify: `src/sync/bruecke.js` (`verarbeite`, ab Zeile ~310)
- Test: `tests/unit/brueckeAbschottung.test.js`

**Interfaces:**
- Consumes: `zustand = { db, turnierId, instanzId, epoche, abschottung?: boolean }`
- Produces: Bei `zustand.abschottung === true` wird jedes Geräte-Dokument vor dem Anwenden geprüft: `kampf` → `kaempfe.pool_id` gehört über `pools.turnier_id` zu `zustand.turnierId`; `kampfflaeche`/`pool` → `turnier_id` der Zeile; `teilnehmer` mit `sql_id` → `turnier_teilnehmer.turnier_id`; Teilnehmer ohne `sql_id` → `doc.turnier_id === zustand.turnierId`; Zusatzkampf → `pools.turnier_id` des `doc.pool_id`. Verstoß → `lehneAb(db, doc, tabelle, new FachFehler(403, 'Dokument gehört nicht zu diesem Turnier.'))`, keine SQL-Änderung. Ohne `abschottung` (Hallen-Server) unverändertes Verhalten.

- [ ] **Step 1: Failing test** (zwei Turniere A/B in der Test-DB, `erzeugeBruecke` mit `zustand.abschottung = true` für A): Dokument `kampf:<id-von-B>` mit `status:'beendet'` in der DB von A → Kampf von B bleibt `bereit`, das Dokument trägt `letzte_ablehnung`; dasselbe Dokument für einen Kampf von A → wird angewendet; Teilnehmer-Dokument mit `turnier_id` von B ohne `sql_id` → abgelehnt, kein neuer `turnier_teilnehmer`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: `pruefeGehoertZumTurnier(knex, typ, doc, turnierId): Promise<boolean>`** als Hilfsfunktion in `bruecke.js` implementieren und in `verarbeite` vor dem `try` aufrufen (nur bei `zustand.abschottung`).
- [ ] **Step 4:** Test → PASS; bestehende Sync-Unit-Tests (`npm run test:unit`) bleiben grün.
- [ ] **Step 5: Commit** „Brücke: optionale Abschottung je Turnier“.

### Task 3: Verwalter der Live-Instanzen

**Files:**
- Create: `src/cloudLive/verwalter.js`
- Test: `tests/unit/cloudLiveVerwalter.test.js`

**Interfaces:**
- Consumes: `erzeugeDokumentDb(konfig)` und `turnierDbName` (`src/sync/dokumentDb.js`), `erzeugeAbgleich`, `erzeugeBruecke`, `zugang.js` aus Task 1.
- Produces: `erzeugeVerwalter({ knex, konfig }): Verwalter` mit
  - `starte(turnierId): Promise<ZugangDaten>` — `starteZugang`, öffnet DB `turnier_<instanzId>`, `abschottung: true`, `abgleich.fuehreAus()`, `bruecke.starte()`; mehr als `MAX_LIVE_TURNIERE` offene → `FachFehler(409, 'Es laufen bereits 10 Turniere live.')`; schon offen → idempotent.
  - `beende(turnierId, { erzwingen?: boolean }): Promise<{ ausstehendeGeraete: number }>` (Details Task 6)
  - `instanz(schluessel): Instanz | null` mit `{ turnierId, instanzId, db, dbName, dokumentMiddleware }`
  - `planeAbgleich(): void` — stößt `abgleich.plane()` aller offenen Instanzen an
  - `wiederaufnahme(): Promise<void>` — öffnet alle Turniere mit aktiver `cloud_live`-Zeile (`beendet_am IS NULL`), beim Serverstart
  - `schliesseAlle(): Promise<void>` (für Tests/Shutdown)
  - `offeneAnzahl(): number`

- [ ] **Step 1: Failing tests:** zwei Turniere starten → `instanz()` liefert zwei getrennte DBs; Abgleich schreibt `kampf:<id>`-Dokumente nur des eigenen Turniers in die jeweilige DB; elfter Start → 409; `wiederaufnahme()` nach `schliesseAlle()` öffnet wieder beide (gleiche `instanzId`, Dokumente noch da); Start desselben Turniers zweimal → eine Instanz.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementieren.** Eine gemeinsame `erzeugeDokumentDb(konfig)`-Instanz (ein Datenverzeichnis `CLOUD_LIVE_DATENVERZEICHNIS`, Standard `./data/cloud-live`), je Turnier ein `zustand` + Abgleich + Brücke. Serialisiertes Öffnen/Schließen je Turnier (Promise-Kette), damit Doppelaufrufe nicht zwei Instanzen anlegen.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** „Cloud-Live: Verwalter für mehrere Turnier-Instanzen“.

### Task 4: Geräte-Router `/turnierlive/:schluessel`

**Files:**
- Create: `src/cloudLive/geraeteRoutes.js`
- Modify: `src/app.js` (Einbindung vor `express.json`, bei `bm.istCloud || process.env.CLOUD_LIVE_AKTIV === 'true'`; Verwalter erzeugen, `wiederaufnahme()` aufrufen)
- Test: `tests/unit/cloudLiveGeraeteRoutes.test.js`

**Interfaces:**
- Consumes: `Verwalter` (Task 3), `pruefeCode`/`pruefeGeheimnis` (Task 1), `erzeugeSperre`/`normalisiereCode` (`src/sync/kopplung.js`).
- Produces: `getCloudLiveGeraeteRoutes({ knex, verwalter }): express.Router`, eingehängt unter `/turnierlive/:schluessel` mit
  - `GET /api/sync/status` → `{ rolle: 'server', instanz_id, turnier_id, db_name, modus: 'master' }` (ohne Geheimnis erreichbar, wie am Hallen-Server; 404 bei unbekanntem Schlüssel)
  - `POST /api/client/koppeln` `{ code, clientId }` → `{ secret }` (Sperre je IP **und** je Schlüssel; 429 mit `restSekunden`, 401 bei falschem Code)
  - `ALL /db/*` → verlangt Header `x-hajime-sync-secret` = Geheimnis des Turniers (`pruefeGeheimnis`), erlaubt nur Pfade, deren erstes Segment `turnier_<instanzId>` dieses Turniers oder leer (`GET /db/`) ist, lehnt `_`-Segmente und fremde DB-Namen mit 404 ab, reicht sonst an `instanz.dokumentMiddleware` (express-pouchdb) weiter; für CORS der Android-App `appCors` wie in `app.js`.
  - Nach jeder erfolgreichen Anfrage auf `/db` mit Schreibmethode wird nichts weiter getan; die Brücke läuft über den Changes-Feed.

- [ ] **Step 1: Failing tests** (Express-App mit Router, echtes PouchDB in Tempverzeichnis): Koppeln mit richtigem Code liefert das Geheimnis, falscher Code 401, 6 Fehlversuche von einer IP → 429; Status unter falschem Schlüssel → 404; `/db/turnier_<instanzId>` ohne Header → 401, mit Header → 200; `/db/turnier_<instanz-von-B>` unter Schlüssel A → 404; `/db/_all_dbs`, `/db/_replicate`, `/db/_users` → 404; Replikation per `PouchDB.replicate` von einer Client-DB nach `…/turnierlive/<A>/db/turnier_<A>` funktioniert und das Dokument liegt in der Instanz von A, nicht von B.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Router implementieren**, Pfad-Umschreibung nach dem Muster der `middleware` in `src/sync/syncDienst.js` (erstes Segment prüfen, `req.url` auf `/db/...` zurücksetzen).
- [ ] **Step 4: In `src/app.js` einhängen** (vor `express.json`, nach `sync`-Block), Verwalter in `app.set('cloudLive', verwalter)`; `res.on('finish')`-Hook für `/api`-Schreibzugriffe ruft `verwalter.planeAbgleich()`.
- [ ] **Step 5:** Test → PASS, `npm run test:unit` grün.
- [ ] **Step 6: Commit** „Cloud-Live: Geräte-Router mit Kopplung und /db je Turnier“.

### Task 5: Verwaltungs-API und Mischen-Sperre

**Files:**
- Create: `src/cloudLive/verwaltungRoutes.js`
- Modify: `src/app.js` (Mount `/api/cloud-live` hinter `requireAuth`), `src/routes/turnierRoutes.js`-Export-Pfad für die Holen-Aktion (Markierung `auf_hallen_server_geholt_am`, Export gesperrt solange live), `src/utils/vereinHelper.js` nur lesend nutzen
- Test: `tests/unit/cloudLiveVerwaltung.test.js`

**Interfaces:**
- Produces `getCloudLiveVerwaltungRoutes({ knex, verwalter }): express.Router` unter `/api/cloud-live`, alle Routen verlangen Rolle `admin` im ausrichtenden Verein des Turniers oder Super-Admin (`requireRolle`/`hatVereinsZugriffAufTurnier`):
  - `GET /:turnierId` → `{ live: boolean, geholt: boolean, code, schluessel, url, qr, gesperrt, gueltigBis, geraete: [{ clientId, geraet, matteId, letzterKontakt, ausstehend }] , offeneInstanzen, maxInstanzen }`
  - `POST /:turnierId/starten` `{ bestaetigt?: boolean }` → 409 `{ code: 'bereits_geholt' }` wenn `auf_hallen_server_geholt_am` gesetzt und nicht `bestaetigt`; 409 bei Status `entwurf`/`abgesagt`; sonst `verwalter.starte`
  - `POST /:turnierId/beenden` `{ erzwingen?: boolean }` → Task 6
  - `POST /:turnierId/code-erneuern`, `POST /:turnierId/sperren` `{ wert }`
- Export-Sperre: `GET /api/turniere/:id/export` und die Holen-Aktion antworten 409 `Turnier läuft live in der Cloud` solange `cloud_live.beendet_am IS NULL` und eine Zeile existiert; die Holen-Aktion (`?liveToken=1`, `cloudRoutes`-Weg) setzt `turniere.auf_hallen_server_geholt_am = now()`.
- Der `qr`-Text wird mit `src/shared/kopplungsQr.js` erzeugt (dort das bestehende Format um die URL mit Pfadpräfix ergänzen, keine Formatänderung).

- [ ] **Step 1: Failing tests:** Nicht-Admin → 403; fremder Verein → 403; Start eines geholten Turniers ohne `bestaetigt` → 409 `bereits_geholt`, mit `bestaetigt:true` → 200; Export eines live laufenden Turniers → 409; nach Beenden wieder erlaubt; Holen setzt `geholt`; Status liefert `maxInstanzen: 10`.
- [ ] **Step 2:** FAIL → **Step 3:** implementieren → **Step 4:** PASS.
- [ ] **Step 5: Commit** „Cloud-Live: Verwaltungs-API, Mischen-Sperre“.

### Task 6: Live beenden mit Rückschreiben

**Files:**
- Modify: `src/cloudLive/verwalter.js` (`beende`), `src/cloudLive/geraeteRoutes.js`
- Test: `tests/unit/cloudLiveBeenden.test.js`

**Interfaces:**
- `beende(turnierId, { erzwingen })`: liest die `client:`-Heartbeat-Dokumente (`ausstehend`, Aktualität ≤ 2 Minuten); ist die Summe `> 0` und nicht `erzwingen`, wirft `FachFehler(409, …)` mit `daten: { ausstehendeGeraete }`; sonst `bruecke.stoppe()`, `abgleich.leerlauf()`, `beendeZugang`, DB zerstören (`db.destroy()`, offene `/db`-Anfragen vorher beenden wie `syncDienst.beendeOffeneDbAnfragen`), Instanz entfernen.
- Nach dem Beenden antworten `/turnierlive/<schluessel>/api/sync/status` und `/db/*` mit 410 `{ error: 'beendet' }`; `clientKern` behandelt das wie „Server nicht erreichbar“ (lokale Änderungen bleiben im Gerät, siehe Task 9).

- [ ] **Step 1: Failing tests:** Gerät mit `ausstehend: 3` → ohne `erzwingen` 409 mit Zahl, mit `erzwingen` beendet; letzter Stand eines beendeten Kampfs steht danach in `kaempfe`; Replikation nach dem Beenden → 410; erneutes `starte` legt eine neue Instanz mit neuer `instanzId` an.
- [ ] **Step 2:** FAIL → **Step 3:** implementieren → **Step 4:** PASS.
- [ ] **Step 5: Commit** „Cloud-Live: Live beenden mit Rückschreiben“.

### Task 7: Oberfläche „Live in der Cloud“

**Files:**
- Create: `public/cloud-live.html`, `public/js/cloudLive.js`
- Modify: `public/turniere.html`/`public/js/turniere.js` (Knopf „Live in der Cloud“ je Turnierkarte, nur Cloud und Admin), `src/shared/menueRechte.js` (keine Menüänderung nötig, Seite wird über die Turnierkarte erreicht)
- Test: `tests/e2e/cloud-live-ui.spec.js`

- [ ] **Step 1: Failing E2E** (Server mit `BETRIEBSMODUS=cloud`-Äquivalent bzw. `CLOUD_LIVE_AKTIV=true` in `playwright.config.js`-Env): Admin öffnet `cloud-live.html?turnierId=…`, Knopf „Turnier live schalten“ → QR (Canvas via `qrcode-generator`) und 6-stelliger Code sichtbar, Gerätetabelle leer; Knopf „Code erneuern“ ändert den Code; „Live beenden“ blendet bei ausstehenden Geräten die Warnung mit Zahl ein und verlangt „Trotzdem beenden“; bereits geholtes Turnier zeigt den Warnhinweis mit Bestätigung.
- [ ] **Step 2:** FAIL → **Step 3:** Seite nach dem Vorbild von `public/client-konfig.html` bauen (Zähler der Instanzen „n von 10“) → **Step 4:** PASS.
- [ ] **Step 5: Commit** „Cloud-Live: Oberfläche zum Live-Schalten“.

### Task 8: Teilnehmer-App aus dem Live-Turnier speisen

**Files:**
- Create: `src/cloudLive/teilnehmerAppFeed.js`
- Modify: `src/live/snapshot.js` (`ladeSnapshots(knexLive, { geheimnis, turnierIds? })`: Option `turnierIds` ersetzt die Filter `live_freigabe`/`urspruengliche_id`), `src/cloudLive/verwalter.js` (Feed starten/stoppen mit der Instanz)
- Test: `tests/unit/cloudLiveTeilnehmerApp.test.js`

**Interfaces:**
- `starteFeed({ knex, geheimnis, turnierId, intervallMs = 5000 }): { stoppe(): void }` — Schleife wie `starteLiveDienst`, ruft `ladeSnapshots(knex, { geheimnis, turnierIds: [turnierId] })` und übergibt jedes Paket direkt an `uebernimmPaket(knex, paket)` aus `src/liveCloud/ingest.js` (ohne HTTP, mit Sequenzzähler je Turnier wie `uplink.js`); beim Beenden Rücknahme wie beim Ingest-Grabstein.
- Das `geheimnis` für Teilnehmer-Schlüssel ist ein fester Cloud-Wert (`LIVE_SCHLUESSEL_GEHEIMNIS` bzw. Fallback aus `cloud_live.geheimnis`).

- [ ] **Step 1: Failing test:** Turnier live starten, Kampf beenden, `starteFeed`-Tick → `live_kampf_positionen`/`live_turniere` enthalten das Turnier, `GET /api/live/turniere/<key>/pools` mit gültigem Zugangscode liefert ihn; nach `beende` ist das Turnier zurückgenommen.
- [ ] **Step 2:** FAIL → **Step 3:** implementieren (`urspruengliche_id` bleibt unberührt, der `turnier_key` kommt aus der Snapshot-Logik) → **Step 4:** PASS; bestehende `tests/unit/live*.test.js` grün.
- [ ] **Step 5: Commit** „Cloud-Live: Teilnehmer-App direkt aus dem Live-Turnier“.

### Task 9: Geräteauswahl Hallen-Server oder Cloud (Node-Client und Desktop)

**Files:**
- Modify: `desktop/main.js` / `desktop/serverSuche.js` (Ablauf), `src/shared/clientKonfig.js` und `src/sync/clientKonfig.js` (gemerkte Cloud-Kopplung), Startfenster des Desktop-Clients, `public/client.html` (Kopplung per Cloud-QR)
- Create: `src/shared/serverAuswahl.js` (rein, ohne Electron)
- Test: `tests/unit/serverAuswahl.test.js`

**Interfaces:**
- `entscheideServer({ hallenServer: string | null, cloudKopplung: { url, secret } | null, cloudBestaetigt: boolean | null }): { aktion: 'hallenserver', url } | { aktion: 'rueckfrage_cloud', url } | { aktion: 'cloud', url, secret } | { aktion: 'koppeln' }` — Hallen-Server gefunden → immer er; keiner gefunden und gekoppelte Cloud vorhanden → `rueckfrage_cloud`; Bestätigung `true` → `cloud`; sonst `koppeln`.
- Kopplung per Cloud-QR: Format aus `src/shared/kopplungsQr.js` (URL mit Pfadpräfix + Code); nach `POST <url>/api/client/koppeln` wird `serverUrl = <url>` und `secret` gespeichert; `clientKern.setzeVerbindung({ serverUrl, secret })` wie heute. Wechselt ein Gerät den Typ (Hallen-Server ↔ Cloud), greift der vorhandene Turnierwechsel (`wechsleInstanz`, sichert Ungesendetes unter `verworfen/`).
- Antwort 410 `beendet` der Cloud: `frageServer` behandelt sie als nicht erreichbar mit Hinweis „Live-Betrieb beendet“ in der Statusleiste (`public/js/syncStatus.js`).

- [ ] **Step 1: Failing Unit-Tests** für `entscheideServer` (alle vier Fälle, zusätzlich: Hallen-Server gefunden **und** Cloud gekoppelt → Hallen-Server ohne Rückfrage).
- [ ] **Step 2:** FAIL → **Step 3:** `serverAuswahl.js` + Einbindung in Desktop-Start und `client.html` → **Step 4:** PASS.
- [ ] **Step 5: Commit** „Clients: Wahl zwischen Hallen-Server und Cloud“.

### Task 10: Android-App — WLAN-Suche und Cloud-Option

**Files:**
- Modify: `mobil/web/js/mobil/boot.js`, `mobil/web/verbinden.html` und zugehöriges Skript, Capacitor-Plugin-Einbindung für mDNS (Auswahl durch den Implementierer, z. B. ein vorhandenes Zeroconf-Plugin; Fallback: Verbindungsversuch auf die zuletzt gekoppelte Hallen-Server-Adresse und `turnier.local`)
- Test: `tests/unit/serverAuswahl.test.js` (Wiederverwendung `entscheideServer`), manueller Geräte-Test dokumentiert in `mobil/README.md`

- [ ] **Step 1:** `entscheideServer` aus Task 9 in die App einbinden; Eingabe „Hallen-Server gefunden“ liefert die WLAN-Suche (mDNS-Dienst `_hajime._tcp` wie `desktop/serverSuche.js`), Eingabe „Cloud bestätigt“ ein Dialog „Kein Turnier-Server gefunden. Mit der Cloud verbinden?“.
- [ ] **Step 2:** Kopplung per QR-Scan unterstützt beide Formate (Hallen-Server-URL und Cloud-URL mit Pfadpräfix); gemerkt wird je Gerät genau eine Verbindung.
- [ ] **Step 3:** Android-Build (`mobil/`-Skript laut `mobil/README.md`) läuft; Unit-Test PASS.
- [ ] **Step 4: Commit** „Android-App: Hallen-Server suchen, sonst Cloud“.

### Task 11: E2E-Suite Cloud-Live

**Files:**
- Create: `tests/e2e-sync/cloud-live.spec.js`; Eintrag in `tests/e2e-sync/shards.js`; Cloud-Knoten in `playwright.sync.config.js`
- Modify: `tests/e2e-sync/test-env.js`

- [ ] **Step 1:** Cloud-Knoten (`BETRIEBSMODUS=cloud`, `CLOUD_LIVE_AKTIV=true`, eigenes PostgreSQL) plus Client-Gerät (`BETRIEBSMODUS=client`, `SYNC_SERVER_URL=<cloud>/turnierlive/<schluessel>`) hochfahren; zwei Turniere gleichzeitig live.
- [ ] **Step 2: Specs:** Waage-Wiegung am Client von Turnier A erscheint nur in A; Kampfergebnis am Scoreboard landet in der Cloud-DB von A; Trennen/Verbinden des Clients repliziert nach; Live beenden → Client sieht „beendet“, Änderungen bleiben unter `verworfen/`.
- [ ] **Step 3:** `npm run test:e2e:sync -- --shard cloud` PASS.
- [ ] **Step 4: Commit** „Cloud-Live: E2E-Suite“.

### Task 12: Dokumentation

**Files:**
- Modify: `CLAUDE.md` (neuer Abschnitt „Cloud-Live-Betrieb“, Variablen `CLOUD_LIVE_AKTIV`, `CLOUD_LIVE_DATENVERZEICHNIS`), `docs/betrieb.md`, `docs/betriebsarten.md`

- [ ] **Step 1:** Abschnitte schreiben (Ablauf, Grenzen, Betriebshinweis zu Datenverzeichnis und Sicherung des Verzeichnisses); Hinweis in `docs/datenschutz/` (Geräte-Geheimnis, Aufbewahrung der Live-DB nur bis „Live beenden“).
- [ ] **Step 2: Commit** „Cloud-Live: Dokumentation“.

---

## Selbstprüfung gegen die Spec

- Abdeckung: Ziele 1–6 → Tasks 3/4 (Live-Führung, Kopplung), 9/10 (Geräteauswahl, Rückfrage, Handys), 5/7 (Live-Schalten durch Admin); Nicht-Ziele → keine Tasks (bewusst); Abschottung → Task 2/4; Mischen-Sperre → Task 5; Live beenden → Task 6; Neustart → Task 3; Teilnehmer-App → Task 8; Video lokal → bleibt unverändert, da die Clips ohnehin lokal aufgenommen werden; die Übertragung zum Server entfällt, weil die Cloud keinen `/api/video`-WebSocket bietet (kein Task, der Client zeigt den Upload als „nicht verfügbar“ — **im Task 9 mit prüfen**).
- Offen für den Implementierer laut Spec: genaue Verwalter-Gestalt, Ressourcenbudget, mDNS-Plugin für Android.
