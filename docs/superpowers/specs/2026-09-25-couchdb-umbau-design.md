# CouchDB-Umbau: Offline-sichere Clients und Server-Cluster

**Datum:** 2026-09-25
**Branch:** `feature/couchdb-umbau` (abgezweigt von `feature/mannschaftskaempfe`)
**Status:** Design abgestimmt, bereit für Implementierungsplan

## 1. Ziel

Hajime Pro soll am Wettkampftag ausfallsicher laufen:

1. **Offline-sichere Clients:** Waage und Scoreboard/Mattenleitung laufen auf Notebooks und Tablets
   mit lokalem Node-Server und lokaler PouchDB. Bricht die Verbindung zum Server ab, arbeiten sie
   ohne Unterbrechung weiter. Sobald der Server wieder erreichbar ist, werden alle Daten übertragen.
2. **Server-Cluster:** Zwei identische Linux-Server laufen als Master und Secondary. Fällt der Master
   aus, kann die Turnierleitung den Secondary manuell aktiv setzen, ohne dass bestätigte Daten
   verloren gehen.

Auf Servern und Clients läuft **identische Software**; der Modus wird per `.env` gewählt.

### Architekturgrundsatz (dauerhaft, nicht nur Übergang)

- **Die relationale DB (PostgreSQL) enthält immer das komplette Turnier in aktuellster Form** und ist
  führend.
- **CouchDB/PouchDB dient ausschließlich der sicheren Synchronisierung der Live-Daten** mit
  offline-fähigen Clients: Teilnehmer inkl. Wiegung, Pools, Kampfflächen, Kämpfe. Sie enthält nicht
  das ganze Turnier.
- Fachlogik, die auch auf dem Client laufen muss, liegt DB-frei in `src/shared/`.

### Stufen

- **Stufe 1 (diese Spec):** Sync-Schicht, Offline-Clients für Einzel-Pools, Server-Cluster.
- **Stufe 2:** Mannschafts-Pools offline-fähig (Begegnungs-Engine DB-frei nach `src/shared/`,
  Auswechseln offline).

## 2. Getroffene Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Rolle von CouchDB | Nur Sync-Schicht für Live-Daten; PostgreSQL bleibt dauerhaft führend und vollständig |
| 2 | Ort der Client-PouchDB | Im Node-Prozess auf dem Client (LevelDB), nicht im Browser |
| 3 | Folgekämpfe offline | Client rechnet mit `src/shared/`-Logik weiter; Master rechnet nach und ist maßgeblich |
| 4 | Waage offline | Wiegen und Nachmeldungen (Client-UUIDs, Dubletten-Prüfung beim Sync); Mannschaftszuordnung nur online |
| 5 | Parallele Waagen | Mehrere Stationen, organisatorisch getrennt: „letzter gewinnt“ ohne Konflikt-UI |
| 6 | Netz-Topologie | Server in der Halle; Cloud-Abgleich weiter per bestehendem Turnier-Export/-Import |
| 7 | CouchDB-Implementierung | Eingebettet per `express-pouchdb` im Node-Prozess |
| 8 | Mannschaftskämpfe | Stufe 1 nur Einzel-Pools offline; Mannschaftsdaten werden nur lesend repliziert |
| 9 | Frontend-Datenzugriff | Live-Funktionen schreiben in die Dokument-DB des eigenen Knotens (`/db`) |
| 10 | Turniere pro Server | Immer genau eines; Anlegen/Einlesen löscht alle Turnierdaten (nur Hallen-Server) |
| 11 | Ausfallsicherheit | Zwei identische Server, Master/Secondary, **manuelles** Umschalten |
| 12 | Relationale Replikation | PostgreSQL-Streaming-Replikation, synchron mit automatischem Rückfall auf asynchron |
| 13 | Erreichbarkeit | Virtuelle IP (VIP) per `keepalived`, gesteuert von der App; Clients arbeiten auf `localhost` |
| 14 | Frontend-Aufteilung | Clients: Waage + Scoreboard + Mattenleitung. Server: volles Frontend inkl. Cluster-Status/Umschalten |
| 15 | Berechtigung Umschalten | Nur mit Turnierleitungs-Login |

## 3. Betriebsmodi und Topologie

```
                 http://vip  (hält immer der Master)
                      │
      ┌───────────────┴───────────────┐
  Server 1 (Master)              Server 2 (Secondary)
  Node + PostgreSQL Primary  ──► Node + PostgreSQL Hot Standby   (Streaming-Replikation)
  /db (Live-Dokumente)       ◄─► /db (Live-Dokumente)            (CouchDB-Replikation)
      ▲
      │  PouchDB-Replikation zu http://vip/db
  ┌───┴──────────┬──────────────┐
  Client A       Client B       Client C       (Notebook/Tablet, Browser → http://localhost:3000)
  Node + PouchDB Node + PouchDB Node + PouchDB
```

| Knoten | `IS_OFFLINE` | `SYNC_ROLLE` | Datenhaltung |
|---|---|---|---|
| Cloud (Supabase) | `false` | *(leer)* | Postgres wie heute, kein Sync, unverändert |
| Hallen-Server (1 und 2) | `true` | `server` | lokale PostgreSQL + eingebettete Dokument-DB `/db` |
| Client | – | `client` | nur lokale PouchDB (LevelDB); keine relationale DB |

`IS_OFFLINE=true` bedeutet weiterhin „Hallenbetrieb“. Die Wahl der relationalen DB im Hallenbetrieb
wird von `IS_OFFLINE` entkoppelt: `DB_CLIENT=pg|sqlite` (neu, Standard `sqlite` für Entwicklung und
Einzelrechner ohne Cluster; im Cluster zwingend `pg`, weil SQLite keine Server-Replikation kann).

### Neue `.env`-Parameter

| Parameter | Knoten | Bedeutung |
|---|---|---|
| `SYNC_ROLLE` | alle | `server` \| `client` \| leer |
| `DB_CLIENT` | Server | `pg` \| `sqlite` |
| `SYNC_SECRET` | Server + Client | gemeinsames Geheimnis für die Dokument-Replikation |
| `SYNC_DATENVERZEICHNIS` | Server + Client | LevelDB-Ablage, Standard `./data/dokumente` |
| `SYNC_SERVER_URL` | Client | `http://<vip>` |
| `SYNC_MATTE` | Client | optional: vorausgewählte Kampffläche für Scoreboard/Mattenleitung |
| `CLUSTER_KNOTEN` | Server | `server1` \| `server2` (leer = kein Cluster) |
| `CLUSTER_PARTNER_URL` | Server | feste Adresse des anderen Servers, z. B. `http://192.168.10.12:3000` |
| `CLUSTER_VIP` | Server | die virtuelle IP (nur Anzeige und keepalived-Vorlage) |

## 4. Frontend-Aufteilung

### Client (`http://localhost:3000`)

- **Waage** (`waage-modal.js`): Wiegen, QR-Scan, Nachmeldung. Mannschaftszuordnung ist offline
  gesperrt, mit Hinweis.
- **Scoreboard** (`steuerung.html`/`scoreboard.js`) mit allen Funktionen: Ergebnis, Farbe tauschen,
  Reihenfolge tauschen, Kampfuhr/Golden Score, eingebettete Anzeige.
- **Mattenleitung** (`kampf.html`/`kampf.js`): Kampfliste, Matte pausieren, „nicht angetreten“,
  „disqualifizieren“, Ergebnis korrigieren. Ersatzkämpfer auswechseln (Mannschaft) ist offline
  gesperrt (Stufe 2).
- **Anzeige/Overlay** der eigenen Matte.
- Eigener **Sync-Status** in allen Client-Seiten: grün = verbunden, gelb = offline mit n
  ausstehenden Änderungen, rot = Authentifizierungs-/Konfigurationsfehler, blau = Turnierwechsel läuft.
- Alle anderen Seiten (Turnierverwaltung, Teilnehmer, Pools, Mannschaften, Matten, Siegerliste,
  Cluster) sind im Client-Modus nicht erreichbar. Das Menü (`menu.js`) blendet sie aus, der Server
  antwortet auf ihre URLs mit einer Hinweisseite „nur am Server unter http://&lt;vip&gt;“.
- Der Scoreboard-Login prüft das Steuerungs-Passwort gegen den Hash im replizierten Dokument
  `konfig:steuerung`, damit er offline funktioniert.

### Server (`http://<vip>` bzw. feste IP)

- **Master:** komplettes Frontend wie heute, zusätzlich die Seite **Cluster** (`cluster.html`) mit
  Status beider Server und Umschaltfunktion sowie die **Konfliktliste**.
- **Secondary** (nur über seine feste IP erreichbar): Turnieransicht nur lesend (Schreibaktionen
  deaktiviert, Hinweisbanner „Secondary – nur lesend“), Seite **Cluster** mit dem Knopf „Diesen
  Server aktiv setzen“.
- Waage, Scoreboard und Mattenleitung sind auch im Server-Frontend nutzbar und schreiben dort in die
  Dokument-DB des Masters, mit demselben Code wie auf dem Client.

## 5. Komponenten

| Datei | Modus | Aufgabe |
|---|---|---|
| `src/sync/dokumentDb.js` | server + client | PouchDB/LevelDB starten, `express-pouchdb` unter `/db`, DB `turnier_<instanz_id>` und `hajime_cluster` verwalten, Mango-Indizes anlegen |
| `src/sync/authDb.js` | server + client | Middleware vor `/db`: Replikation per `SYNC_SECRET`, Browser per JWT bzw. Steuerungs-Passwort; Client-`/db` nur von `localhost` |
| `src/sync/replikation.js` | client | Live-Replikation in beide Richtungen zu `SYNC_SERVER_URL/db`, Retry, Uhr-Abgleich, Statusermittlung |
| `src/sync/turnierInstanz.js` | server + client | Server: Zurücksetzen und neue `instanz_id`. Client: Instanzwechsel erkennen und lokale DB neu aufbauen |
| `src/sync/bruecke/index.js` | server (nur Master aktiv) | `_changes`-Feed lesen, nach Dokumenttyp verteilen, Idempotenz über `sync_angewendet` |
| `src/sync/bruecke/teilnehmer.js`, `kampf.js`, `kampfflaeche.js` | server | Je Dokumenttyp: Dokument → Service-Funktion (Fachlogik, PostgreSQL) |
| `src/sync/spiegeln.js` | server | `spiegleNachDokumentDb(tabelle, ids)`: PostgreSQL-Zeilen der Live-Tabellen → Dokumente; No-op ohne `SYNC_ROLLE=server` |
| `src/sync/konflikte.js` | server | `konflikt:`-Dokumente, Auflösung von CouchDB-`_conflicts` |
| `src/sync/kaskadeLokal.js` | client | Offline-Kaskade und Einreihung auf die Kampf-Dokumente der eigenen Matte anwenden |
| `src/cluster/rolle.js` | server | Rollenermittlung beim Start, `bin-ich-master`, Beförderung, Rückstufung, Epoche |
| `src/cluster/pgReplikation.js` | server | Replikationsstatus (`pg_stat_replication`), Umschalten synchron/asynchron, `pg_promote()` |
| `src/cluster/partner.js` | server | Erreichbarkeit und Status des Partners abfragen |
| `src/routes/syncRoutes.js` | server + client | `/api/sync/status`, Konfliktliste, Test-Endpunkte (nur `NODE_ENV=test`) |
| `src/routes/clusterRoutes.js` | server | `/api/cluster/status`, `/api/cluster/bin-ich-master`, `/api/cluster/aktivieren` |
| `src/middleware/nurMaster.js` | server | Weist Schreibzugriffe auf einem Secondary mit 409 ab |
| `src/middleware/clientFrontend.js` | client | Beschränkt ausgelieferte Seiten und `/api`-Routen auf den Client-Umfang |
| `public/js/datenzugriff.js` | Frontend | Einheitlicher Live-Datenzugriff per PouchDB-Browser (HTTP-Adapter) gegen `/db` des eigenen Knotens |
| `public/js/syncStatus.js` | Frontend | Sync-Status-Leiste (Client und Server) |
| `public/cluster.html`, `public/js/cluster.js` | Frontend (Server) | Cluster-Status und Umschalten |
| `deploy/linux/` | Betrieb | PostgreSQL-Replikationskonfiguration, keepalived-Vorlage, Skripte, systemd-Units, Anleitung |

Die REST-Controller (`teilnehmerController.js`, `kampfController.js`, `kampfflaecheController.js`)
werden so umgebaut, dass die fachliche Schreiblogik in Service-Funktionen ohne `req`/`res` liegt.
REST-Route und Brücke rufen dieselbe Funktion auf; die Knex-Logik wird nicht dupliziert.

## 6. Dokumentmodell (Live-Daten)

Genau eine Turnier-DB `turnier_<instanz_id>`; volle Replikation ohne Filter (wenige hundert
Dokumente). Jedes Dokument spiegelt eine Tabellenzeile; **Feldnamen identisch zu den Spalten**, damit
`src/shared/`-Logik Dokumente und Zeilen gleich verarbeiten kann.

| `_id` | Inhalt | Schreibberechtigt |
|---|---|---|
| `teilnehmer:<schluessel>` | Stammdaten, die Waage/Scoreboard brauchen (Name, Verein, Judopass-ID, Geburtsjahr, Geschlecht, Altersklasse, `pool_id`) + `gewicht`, `gewogen`, `kampfbereit`, `gewogen_am`, `gewogen_station`, `sql_id`, ggf. `dublette_von`, `bruecke_fehler` | Master (Stammdaten), Waage (Wiegefelder, Nachmeldung) |
| `pool:<id>` | Bezeichnung, Modus, Kampfzeit, Golden-Score-Einstellungen, `kampfflaeche_id`, `typ`, Altersklasse | nur Master |
| `kampfflaeche:<id>` | Bezeichnung, Status (pausiert) | Master, Mattenleitung (Pause) |
| `kampf:<id>` | `pool_id`, `kampfflaeche_id`, Slots `kaempfer1_id`/`kaempfer2_id` + `..._quelle_kampf_id`/`..._quelle_typ`, `status`, `sieger_id`, `unterbewertung_kaempfer1/2`, Farbzuordnung, `matte_reihenfolge`, `mannschaftskampf_id`, `mannschaft_gewichtsklasse`, `bearbeitet_von`, ggf. `bruecke_fehler` | Scoreboard/Mattenleitung (Ergebnis, Farbe, Reihenfolge, Status), `kaskadeLokal` (Slots, Reihenfolge), Master (maßgeblich) |
| `mannschaft:<id>`, `mannschaftskampf:<id>` | wie Tabellenzeile | nur Master (Stufe 1) |
| `konfig:steuerung` | Hash des Steuerungs-Passworts, Turnierbezeichnung und -datum | nur Master |
| `konflikt:<uuid>` | `typ`, `prioritaet`, `bezug_id`, `version_lokal`, `version_server`, `erstellt_am`, `erledigt` | Brücke (Anlage), Turnierleitung (`erledigt`) |

Die Cluster-DB `hajime_cluster` wird nur zwischen den beiden Servern repliziert, nicht zu den
Clients, und enthält ein Dokument `cluster:zustand` (siehe Abschnitt 9).

### Schlüssel

- Bestehende Datensätze: PostgreSQL-ID als Schlüssel (`teilnehmer:123`, `kampf:456`).
- Offline-Nachmeldungen: `teilnehmer:u-<uuid>` mit `sql_id: null`. Die Brücke legt den Teilnehmer an
  und trägt `sql_id` nach; die `_id` bleibt unverändert. Verweise (`kaempfer1_id`, `sieger_id`) nutzen
  immer die PostgreSQL-ID; nachgemeldete Teilnehmer werden erst nach dem Sync einem Pool zugelost.
- **Kämpfe entstehen nie auf dem Client.** Die Manager erzeugen beim Anlegen eines Pools alle Kämpfe
  samt Quell-Verknüpfungen; die Offline-Kaskade füllt nur Slots bestehender Dokumente.

### Reihenfolge

Die Reihenfolge steht in `kampf.matte_reihenfolge`; keine eigenen Reihenfolge-Dokumente. Sortierung
per Mango-Index über (`kampfflaeche_id`, `status`, `matte_reihenfolge`). Offline behält die Matte
die zuletzt verteilte Reihenfolge; neu spielbar gewordene Kämpfe hängt `kaskadeLokal` unter
Beachtung von `pausenRegel.js` hinten an. Manuelles Tauschen am Scoreboard ändert
`matte_reihenfolge` der beiden Kampf-Dokumente.

## 7. Datenfluss

### Waage

1. `datenzugriff.js` liest `teilnehmer:*` aus der Dokument-DB des eigenen Knotens; der QR-Scan sucht
   lokal per Judopass-ID.
2. Beim Wiegen werden `gewicht`, `gewogen`, `kampfbereit`, `gewogen_am` (Gerätezeit + Server-Offset)
   und `gewogen_station` gesetzt. Offline bleibt das Dokument lokal, die Replikation überträgt es
   später selbstständig.
3. Eine Nachmeldung erzeugt `teilnehmer:u-<uuid>`.
4. Die Brücke des Masters ruft die Service-Logik auf (Kampfbereit, Anlegen mit Dubletten-Prüfung)
   und spiegelt das Ergebnis zurück.

### Scoreboard und Mattenleitung

1. Ergebnis, „nicht angetreten“, „disqualifizieren“, Farbe, Reihenfolge und Pause werden als
   Dokument-Änderung geschrieben (`bearbeitet_von: matte:<kampfflaecheId>`). Pause betrifft
   `kampfflaeche:<id>`, Disqualifikation/„nicht angetreten“ den Kampf **und** das Teilnehmer-Dokument
   (Feld `status`).
2. **Client:** `kaskadeLokal` reagiert auf den lokalen `_changes`-Feed und füllt Folgekämpfe per
   `kampfProgression.js` (inkl. Freilos bei Disqualifikation/Nichtantreten), reiht neu spielbare
   Kämpfe ein. Bei Mannschafts-Pools rechnet es nicht (Stufe 2).
3. **Master:** Die Brücke wendet die Änderung über die bestehende Logik an (`triggerPoolUpdate`,
   Kaskade, `planeKaempfeFuerKampfflaeche`, Teilnehmer-Aktionen inkl. Abschenken-Verbot) und schreibt
   alle dadurch geänderten Kämpfe mit `bearbeitet_von: server` zurück.
4. Die Master-Version repliziert zur Matte und überschreibt lokal berechnete Slots und Reihenfolge.

### Turnierleitung (REST am Master)

Schreiboperationen laufen wie bisher über die Controller nach PostgreSQL. Betrifft eine Operation
Live-Tabellen, ruft der Controller danach `spiegleNachDokumentDb(tabelle, ids)` auf. Die REST-Antwort
wird erst gesendet, wenn der PostgreSQL-Commit bestätigt (siehe Abschnitt 9) und die Dokumente
geschrieben sind.

### Idempotenz und Schleifenvermeidung

- Die Brücke ignoriert Änderungen mit `bearbeitet_von: server`.
- Verarbeitete Änderungen stehen in der PostgreSQL-Tabelle `sync_angewendet (doc_id, rev,
  angewendet_am)`, geschrieben in derselben Transaktion wie die fachliche Änderung. Die Tabelle wird
  mit dem Turnier nach Server 2 repliziert. Beim Start und nach einer Übernahme liest die Brücke den
  Feed ab Sequenz 0 und überspringt alles, was mit gleicher `rev` bereits angewendet wurde.
- Beim Anlegen/Einlesen eines Turniers wird die Dokument-DB einmalig vollständig aus PostgreSQL
  befüllt.

### Anzeigen

`anzeige`, `overlay` und `dashboard` hören per `changes({ live: true })` auf die Dokument-DB des
eigenen Knotens. `BroadcastChannel` bleibt nur für die Kommunikation innerhalb eines Browsers.

## 8. Ein Turnier pro Hallen-Server

Gilt ausschließlich für `SYNC_ROLLE=server`; der Cloud-Betrieb bleibt unverändert.

### Zurücksetzen beim Anlegen oder Einlesen (nur am Master)

1. Bestätigungsdialog: „Alle Daten des bisherigen Turniers auf diesem Server werden gelöscht.“
2. Brücke anhalten.
3. PostgreSQL: alle Turnierdaten löschen (`turniere`, `kampfflaechen`, `pools`, `turnier_teilnehmer`,
   `kaempfe`, `mannschaften`, `mannschaft_mitglieder`, `mannschaftskaempfe`, `sync_angewendet`).
   `benutzer` und `vereine` bleiben erhalten. Die Löschung erreicht Server 2 über die
   Streaming-Replikation.
4. Neue `instanz_id` (UUID) erzeugen und in `cluster:zustand` sowie am Turnier (neue Spalte,
   Migration) speichern.
5. Alte Dokument-DB löschen, Turnier anlegen bzw. importieren, `turnier_<neue_instanz_id>` anlegen
   und aus PostgreSQL befüllen.
6. Brücke wieder starten.

Der Secondary sieht die neue `instanz_id` über `hajime_cluster`, löscht seine alte Turnier-DB und
repliziert die neue.

### Instanzwechsel auf dem Client

Der DB-Name enthält die `instanz_id`, daher kann ein Client alte Dokumente nie in die neue DB
zurückreplizieren. Bei jedem (Re-)Connect fragt der Client `http://<vip>/api/sync/status` ab:

- **Gleiche Instanz:** normale Replikation.
- **Andere Instanz:** Replikation stoppen. Nicht übertragene Änderungen werden als JSON nach
  `data/verworfen/<alte_instanz_id>_<zeitstempel>.json` geschrieben, mit Warnhinweis. Danach die
  lokale DB löschen, die neue Instanz vollständig replizieren und geöffnete Seiten neu laden.
- **Server hat kein Turnier:** Status gelb „kein Turnier auf dem Server“, lokale DB unverändert.

## 9. Server-Cluster

### Replikationswege

| Weg | Inhalt | Technik |
|---|---|---|
| Server 1 → Server 2 | komplettes Turnier (relational) | PostgreSQL-Streaming-Replikation, Primary → Hot Standby |
| Server 1 ↔ Server 2 | Live-Dokumente + `hajime_cluster` | CouchDB-Replikation in beide Richtungen |
| Clients ↔ Master | Live-Dokumente | PouchDB-Replikation über `http://<vip>/db` |

### Rollen

- **Master:** PostgreSQL ist Primary, die App nimmt Schreibzugriffe an, die Brücke läuft, und der
  Server hält die VIP.
- **Secondary:** PostgreSQL ist Hot Standby (nur lesend), die Brücke ruht, `nurMaster.js` weist
  Schreibzugriffe mit 409 ab, keine VIP.
- `cluster:zustand` in `hajime_cluster`: `{ master: 'server1' | 'server2', epoche: <Zahl>,
  instanz_id, geaendert_am, geaendert_von }`.

### Start

**Jeder Server startet als Secondary.** Er verbindet sich mit dem Partner und gleicht
`hajime_cluster` ab.

- Laut `cluster:zustand` bin ich Master, der Partner ist erreichbar und bestätigt das, und meine
  PostgreSQL ist Primary: Ich werde Master.
- Der Partner meldet eine höhere Epoche mit sich selbst als Master: Ich bleibe Secondary. Ist meine
  PostgreSQL noch Primary (ich war früher Master), meldet die Cluster-Seite „Rückstufung
  erforderlich“ und das Skript `deploy/linux/hajime-rueckstufen.sh` setzt meine PostgreSQL per
  `pg_rewind` (Rückfall: neue Basissicherung) als Standby des neuen Masters neu auf.
- Der Partner ist nicht erreichbar: Ich bleibe Secondary und warte auf manuelle Aktivierung.
- Allererster Start (kein `cluster:zustand` vorhanden): `server1` wird Master mit Epoche 1.

### Manuelles Umschalten

Auf der Cluster-Seite des Secondary (erreichbar über dessen feste IP) gibt es den Knopf „Diesen
Server aktiv setzen“. Er ist nur mit Turnierleitungs-Login bedienbar und nur aktiv, wenn der Master
vom Secondary aus nicht erreichbar ist. Ein zweiter Bestätigungsdialog nennt die Folgen.

1. `pg_promote()`: PostgreSQL des Secondary wird Primary.
2. `cluster:zustand`: `master` auf sich selbst setzen, `epoche + 1`.
3. Brücke starten: Sie verarbeitet den Feed ab 0 und holt über `sync_angewendet` alles nach, was
   der alte Master noch nicht angewendet hatte.
4. `bin-ich-master` liefert `ja`, keepalived übernimmt die VIP, und die Clients replizieren über die
   gleiche Adresse weiter.

Das Zurückschalten auf den ursprünglichen Server erfolgt auf dieselbe Weise, sobald dieser als
Secondary vollständig synchron ist.

### Kein Verlust bestätigter Daten

- **PostgreSQL synchron:** `synchronous_commit = on` mit `synchronous_standby_names` auf den Partner.
  Ein REST-Schreibvorgang gilt erst als bestätigt, wenn der Standby ihn hat.
- **Automatischer Rückfall:** `pgReplikation.js` prüft alle 2 s `pg_stat_replication`. Ist der
  Standby länger als 5 s nicht verbunden, setzt es `synchronous_standby_names = ''`
  (`ALTER SYSTEM` + `pg_reload_conf()`), damit der Master weiterarbeitet, und die Cluster-Seite und
  Statusleiste zeigen gelb „ohne Absicherung“. Ist der Standby wieder synchron, wird synchron
  wieder aktiviert.
- **Client-Daten** liegen in beiden CouchDBs und werden über `sync_angewendet` idempotent nachgeholt.
  Eine Waage- oder Ergebnis-Änderung gilt für den Client als übertragen, sobald sie in der
  Dokument-DB des Masters steht.
- **Restrisiko:** Im Modus „ohne Absicherung“ können REST-Änderungen der letzten Sekunden bei einem
  Ausfall des Masters verloren gehen. Das wird sichtbar angezeigt.

### Netztrennung statt Ausfall

Wird Server 2 aktiv gesetzt, obwohl Server 1 nur vom Netz getrennt war, und hat Server 1
zwischenzeitlich weitergerechnet:

- Server 1 hat keine VIP mehr, sobald er die höhere Epoche sieht. Bis dahin erreicht ihn kein
  Client, der die VIP nutzt. Konkurrierende VIP-Ansprüche im selben Netz löst VRRP über die Priorität.
- Seine PostgreSQL-Änderungen nach dem Umschalten gehen beim Rückstufen verloren (`pg_rewind`).
  Betroffen sind nur Aktionen, die in dieser Zeit direkt über seine feste IP gemacht wurden.
- Dokumente, die er in dieser Zeit mit `bearbeitet_von: server` geschrieben hat, führen zu
  CouchDB-Konflikten. Die Revision des aktuellen Masters gewinnt, und die Brücke legt
  `konflikt:`-Dokumente an.

### Virtuelle IP

`keepalived` (VRRP) auf beiden Servern. Das Prüfskript `curl -fs http://localhost:3000/api/cluster/bin-ich-master`
entscheidet: Nur der Server, dessen App „ja“ meldet, hält die VIP. keepalived trifft keine eigene
Failover-Entscheidung.

### Cluster-Seite (`cluster.html`, nur Server-Frontend)

Für Server 1 und 2 jeweils: erreichbar ja/nein, Rolle, Epoche, PostgreSQL-Rolle, Replikationsmodus
(synchron/asynchron), relationaler Rückstand (Bytes/Sekunden), Dokument-Replikationsrückstand,
verbundene Clients (letzter Kontakt je Client). Dazu der Knopf „Diesen Server aktiv setzen“ und der
Hinweis „Rückstufung erforderlich“.

## 10. Konflikte und Fehlerbehandlung

**Grundsatz:** Der Master ist maßgeblich. Jede fachlich relevante automatische Auflösung wird als
`konflikt:`-Dokument protokolliert und in der Konfliktliste (Server-Frontend) angezeigt.

| Fall | Auflösung |
|---|---|
| Zwei Wiegungen desselben Judoka (`_conflicts`) | Jüngerer `gewogen_am` gewinnt; unterlegene Revision entfernen; kein Konflikt-Dokument |
| Offline-Nachmeldung ist Dublette | Nicht anlegen; per `sql_id`/`dublette_von` verknüpfen, Wiegedaten „letzter gewinnt“; Konflikt-Dokument (Info) |
| Master lehnt Mattenaktion ab (umgeplant, disqualifiziert, Ergebnis von Turnierleitung anders gesetzt) | Master-Version gewinnt; Konflikt-Dokument mit beiden Versionen |
| Offline-Kaskade weicht ab, Kampf noch nicht gespielt | Master-Version überschreibt stillschweigend |
| Offline-Kaskade weicht ab, Kampf offline bereits mit anderer Paarung gespielt | Status `klaerung`, Konflikt-Dokument mit hoher Priorität, Turnierleitung entscheidet |
| Dokumente beider Server nach Netztrennung (`_conflicts`) | Revision mit `bearbeitet_von: server` der höheren Epoche gewinnt; Konflikt-Dokument |
| Brücke scheitert (Exception) | `bruecke_fehler` am Dokument + Konflikt-Dokument; Feed läuft weiter; Wiederholung bei nächster Änderung oder per Knopf |
| Replikation scheitert an Authentifizierung | Replikation stoppt, Status rot |

Neuer Kampfstatus `klaerung` (Migration); solche Kämpfe werden vom Scoreboard nicht aufgerufen.
Kampf-Dokumente, die der Master schreibt, tragen zusätzlich `epoche`.

**Geräte-Uhr:** Beim Verbinden ermittelt der Client den Offset zur Server-Uhr und speichert
`gewogen_am` korrigiert. Eine vor dem ersten Verbinden falsch gehende Uhr bleibt ein Restrisiko,
entschärft durch die organisatorische Trennung der Waage-Stationen.

## 11. Betrieb (`deploy/linux/`)

- `README.md`: Installationsanleitung für zwei Debian-Server (Node, PostgreSQL, keepalived),
  Netzplan mit VIP, Einrichtung der Streaming-Replikation, Ablauf „Umschalten“ und „Rückstufen“.
- `postgresql/`: Konfigurationsausschnitte für Primary und Standby (`wal_level`, `max_wal_senders`,
  `hot_standby`, `primary_conninfo`, Replikationsnutzer, `pg_hba.conf`).
- `keepalived/keepalived.conf.vorlage` mit Prüfskript.
- `hajime-rueckstufen.sh`: stoppt PostgreSQL, `pg_rewind` gegen den neuen Master (Rückfall
  `pg_basebackup`), setzt `standby.signal`, startet PostgreSQL.
- `systemd/hajime-pro.service`, Start nach PostgreSQL.
- Die App benötigt für `pg_promote()` und `ALTER SYSTEM` einen PostgreSQL-Nutzer mit den
  entsprechenden Rechten; die Rückstufung läuft als Skript unter dem Systemnutzer `postgres` und wird
  über einen eng begrenzten `sudo`-Eintrag von der App angestoßen.

## 12. Tests

Playwright bleibt die einzige automatisierte Suite.

### Sync-Suite `tests/e2e-sync/` (Windows-tauglich)

- Eigene Config `playwright.sync.config.js`, Script `test:e2e:sync`.
- Ein Server (SQLite, Port 3100) und ein Client (Port 3101, LevelDB unter `data/test-client/`),
  Rücksetzen im `globalSetup`.
- Verbindungsabbruch per `/api/sync/test/trennen` bzw. `/api/sync/test/verbinden` (nur
  `NODE_ENV=test`).
- Tests:
  1. Die Waage wiegt offline 5 Judoka und legt 1 Nachmeldung an → nach dem Reconnect alles in der DB,
     die Nachmeldung genau einmal.
  2. DK8-Pool offline komplett am Client-Scoreboard → Ergebnisse, Kaskade und Siegerliste identisch
     zum Online-Durchlauf.
  3. Mattenleitung offline: Disqualifikation und „nicht angetreten“ → Freilos-Kaskade lokal, nach dem
     Sync identisch am Server.
  4. Je ein Test pro Konfliktfall aus Abschnitt 10 (ohne Netztrennungsfall).
  5. Neustart des Servers mit ausstehenden Änderungen → nichts doppelt angewendet.
  6. Turnierwechsel, während ein Client offline mit ausstehenden Änderungen ist → keine alten
     Dokumente in der neuen DB, verworfene Änderungen in `data/verworfen/`.
  7. Client-Frontend: Verwaltungsseiten sind nicht erreichbar, Waage, Scoreboard und Mattenleitung
     schon.
- Die vier bestehenden `tests/e2e/steuerung-*-online-vs-offline.spec.js` werden auf den Sync-Pfad
  umgestellt und in diese Suite verschoben.

### Cluster-Suite `tests/e2e-cluster/` (Docker)

- `docker compose` mit zwei Server-Containern (je Node + PostgreSQL), einem Client-Container und
  einem kleinen VIP-Proxy-Container, der die VIP-Rolle simuliert: Er leitet an den Server weiter,
  dessen `bin-ich-master` „ja“ meldet. Script `test:e2e:cluster`.
- Tests:
  1. REST-Änderung am Master → sofort im Standby lesbar (synchron).
  2. Master stoppen → Umschalten per Knopf auf Server 2 → alle bestätigten REST-Änderungen und alle
     Client-Dokumente vorhanden, Brücke holt Ausstehendes nach, Client repliziert über die VIP weiter.
  3. Alter Master startet neu → erkennt höhere Epoche, bleibt Secondary, Rückstufung → wieder
     synchroner Standby.
  4. Standby stoppen → Master schaltet auf asynchron, Statusanzeige gelb; Standby zurück → synchron.
  5. Netztrennung mit Doppelberechnung → Konflikt-Dokumente, Revision der höheren Epoche gewinnt.
- Das echte keepalived-Verhalten wird nicht automatisiert getestet, sondern per Checkliste in
  `deploy/linux/README.md` abgenommen.

## 13. Ablösung des alten Offline-Mechanismus

Letzter Schritt von Stufe 1, erst wenn die Sync-Suite grün ist.

**Entfällt:** JSON-Export/-Import pro Matte (`offlineController.js`, `offlineRoutes.js`,
`/api/offline/*`, Buttons in `kampf.js`) sowie `offlineState`/`isOfflineMode` in `scoreboard.js`.

**Bleibt:** Turnier-Transfer Cloud ↔ Hallen-Server (Turnier-Export/-Import mit `urspruengliche_id`),
Suite `tests/e2e-vollablauf/`, Cloud-Betrieb.

`CLAUDE.md` wird um Modi, `.env`-Parameter, `src/sync/`, `src/cluster/`, `deploy/linux/` und die
neuen Suites ergänzt.

## 14. Umsetzungsreihenfolge

Die Spec wird in drei Implementierungspläne zerlegt, die jeweils für sich lauffähige Software
liefern:

1. **Plan A – Sync-Kern:** Service-Extraktion aus den Controllern, Dokument-DB, Brücke, Spiegelung,
   `datenzugriff.js`, Umstellung von Waage, Scoreboard und Mattenleitung (zunächst im
   Server-Frontend), Turnier-Instanz/Zurücksetzen, `DB_CLIENT`-Entkopplung.
2. **Plan B – Offline-Clients:** Client-Modus, Replikation, `kaskadeLokal`, eingeschränktes
   Frontend, Sync-Status, Konfliktfälle, Instanzwechsel am Client, Sync-Suite, Ablösung des alten
   Mechanismus.
3. **Plan C – Cluster:** Rollen, Epoche, PostgreSQL-Replikation, Umschalten, Rückstufung, VIP,
   Cluster-Seite, `deploy/linux/`, Cluster-Suite.

## 15. Außerhalb des Umfangs

- Offline-Berechnung von Mannschaftsbegegnungen und Auswechseln offline (Stufe 2)
- Mannschaftszuordnung an der Waage im Offline-Zustand
- Automatisches Failover ohne manuelle Bestätigung
- Mehr als zwei Server im Cluster
- Replikation direkt zwischen Clients
- Direkte Replikation Hallen-Server ↔ Cloud (weiter per Turnier-Datei-Transfer)
- Apache CouchDB als externer Dienst
