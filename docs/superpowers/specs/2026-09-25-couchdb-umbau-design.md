# CouchDB-Umbau – Stufe 1: Offline-fähige Waage und Scoreboard per Dokument-Replikation

**Datum:** 2026-09-25
**Branch:** `feature/couchdb-umbau` (abgezweigt von `feature/mannschaftskaempfe`)
**Status:** Design abgestimmt, bereit für Implementierungsplan

## 1. Ziel

Waage und Scoreboard sollen bei Verlust der WLAN-Verbindung zum Hallen-Server ohne Unterbrechung
weiterarbeiten. Alle offline erfassten Daten (Wiegungen, Nachmeldungen, Kampfergebnisse) werden bei
Wiederherstellung der Verbindung automatisch übertragen. Der Server berechnet maßgeblich die
Folgekämpfe und deren Reihenfolge und stellt sie den Matten bereit; offline rechnet die Matte mit
derselben Logik vorläufig selbst weiter.

Server und Client laufen mit **identischer Software**. Der einzige Unterschied ist der Modus:
Server-Modus = CouchDB-kompatible Dokument-DB (Replikationsziel), Client-Modus = lokale PouchDB.

### Zielbild und Stufung

- **Stufe 1 (diese Spec):** CouchDB als Sync-Schicht *neben* der relationalen DB. SQLite bleibt auf
  dem Hallen-Server führend; nur Live-Daten (Teilnehmer/Wiegung, Pools, Kampfflächen, Kämpfe)
  werden als Dokumente repliziert. Einzel-Pools vollständig offline-fähig.
- **Stufe 2:** Mannschafts-Pools offline-fähig (Begegnungs-Engine DB-frei nach `src/shared/`).
- **Stufe 3 ff.:** weitere Entitäten wandern nach CouchDB, die Brücke schrumpft entsprechend, bis
  CouchDB führend ist. Jede Stufe erhält eine eigene Spec.

Damit dieser Ausbau ohne Umbau möglich bleibt, gelten ab Stufe 1 drei Leitlinien:

1. Das Dokumentmodell wird so entworfen, als wäre CouchDB bereits führend (ein Dokument pro
   Entität, stabile `_id`, Feldnamen = Spaltennamen).
2. Die Brücke CouchDB ↔ SQLite ist pro Dokumenttyp gekapselt, damit sie typweise entfernt werden
   kann.
3. Fachlogik, die auch auf dem Client laufen muss, liegt DB-frei in `src/shared/`.

## 2. Getroffene Entscheidungen

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Rolle von CouchDB | Sync-Schicht neben SQLite/Postgres, schrittweiser Ausbau Richtung „CouchDB führend“ |
| 2 | Ort der Client-PouchDB | Im Node-Prozess auf dem Notebook (LevelDB), nicht im Browser |
| 3 | Folgekämpfe offline | Client rechnet mit `src/shared/`-Logik weiter, Server rechnet nach und ist maßgeblich |
| 4 | Waage offline | Wiegen **und** Nachmeldungen (Client-UUIDs, Dubletten-Prüfung beim Sync); Mannschaftszuordnung nur online |
| 5 | Parallele Waagen | Mehrere Stationen, organisatorisch getrennt → „letzter gewinnt“ ohne Konflikt-UI |
| 6 | Netz-Topologie | Server lokal in der Halle (heutiger Offline-Modus mit SQLite); Cloud-Abgleich weiter per bestehendem Turnier-Export/-Import |
| 7 | CouchDB-Implementierung | Eingebettet per `express-pouchdb` im Node-Prozess, kein separates Apache CouchDB |
| 8 | Mannschaftskämpfe | Stufe 1 nur Einzel-Pools; Mannschaftsdaten werden lesend repliziert |
| – | Turniere pro Hallen-Server | Immer genau eines; Anlegen/Einlesen löscht alle Turnierdaten in SQLite und Dokument-DB, neue `instanz_id` |
| – | Frontend-Datenzugriff | Waage und Scoreboard schreiben immer in die Dokument-DB des eigenen Knotens (`/db`); keine doppelte REST-Implementierung |

## 3. Architektur und Betriebsmodi

### Konfigurationen

| Knoten | `IS_OFFLINE` | `SYNC_ROLLE` | Datenhaltung |
|---|---|---|---|
| Cloud (Supabase) | `false` | *(leer)* | Postgres wie heute, kein Sync |
| Hallen-Server | `true` | `server` | SQLite + eingebettete Dokument-DB unter `/db` + Brücke |
| Notebook (Matte/Waage) | – | `client` | nur lokale PouchDB (LevelDB), repliziert zu `SYNC_SERVER_URL` |

Weitere neue `.env`-Parameter:

- `SYNC_SERVER_URL` – Client: Basis-URL des Hallen-Servers, z. B. `http://hallenrechner:3000/db`
- `SYNC_SECRET` – gemeinsames Geheimnis für die Replikation Notebook ↔ Hallen-Server
- `SYNC_DATENVERZEICHNIS` – LevelDB-Ablage, Standard `./data/dokumente`

Eine Turnierauswahl auf dem Client entfällt: Der Hallen-Server trägt immer genau ein Turnier (siehe
Abschnitt 3a), der Client repliziert die aktuell vom Server gemeldete Turnier-Instanz.

### Neue Komponenten

| Datei | Modus | Aufgabe |
|---|---|---|
| `src/sync/dokumentDb.js` | server + client | Startet PouchDB/LevelDB, hängt `express-pouchdb` unter `/db` ein, genau eine DB `turnier_<instanz_id>` für das aktuelle Turnier, legt Mango-Indizes an |
| `src/sync/turnierInstanz.js` | server + client | Server: Zurücksetzen beim Anlegen/Einlesen, neue `instanz_id`. Client: Instanzwechsel erkennen, lokale DB verwerfen und neu aufbauen |
| `src/sync/authDb.js` | server + client | Middleware vor `/db`: Replikation per `SYNC_SECRET`, Browser per JWT bzw. Steuerungs-Passwort |
| `src/sync/replikation.js` | client | Kontinuierliche bidirektionale Live-Replikation mit Retry, Uhr-Abgleich beim Verbinden, Statusmeldung an das Frontend |
| `src/sync/bruecke/index.js` | server | Liest den `_changes`-Feed, verteilt nach Dokumenttyp, verwaltet `_local/bruecke-checkpoint` |
| `src/sync/bruecke/teilnehmer.js`, `kampf.js`, `pool.js`, `kampfflaeche.js`, `mannschaft.js` | server | Je Dokumenttyp: Dokument → SQLite (über Service-Funktionen) und SQLite → Dokument (Spiegelung) |
| `src/sync/spiegeln.js` | server | `spiegleNachDokumentDb(tabelle, ids)` – Hook, den die REST-Controller nach Schreiboperationen aufrufen |
| `src/sync/konflikte.js` | server | Anlegen und Auflösen von `konflikt:`-Dokumenten, Auflösung von CouchDB-`_conflicts` |
| `src/sync/kaskadeLokal.js` | client | Wendet `kampfProgression.js`/`pausenRegel.js` auf die Kampf-Dokumente der eigenen Matte an |
| `src/routes/syncRoutes.js` | server + client | `/api/sync/status`, Konfliktliste, Test-Endpunkte (nur `NODE_ENV=test`) |
| `public/js/datenzugriff.js` | Frontend | Einheitlicher Datenzugriff für Waage, Scoreboard und Anzeigen per PouchDB-Browser (HTTP-Adapter) gegen `/db` des eigenen Knotens |

Die REST-Controller (`teilnehmerController.js`, `kampfController.js`, `kampfflaecheController.js`)
werden so umgebaut, dass die fachliche Schreiblogik in aufrufbaren Service-Funktionen ohne
`req`/`res` liegt. REST-Route und Brücke rufen dieselbe Funktion auf, damit die Knex-Logik nicht
dupliziert wird.

### Client-Modus – Funktionsumfang

- Das Notebook liefert das komplette Frontend aus `public/` aus.
- Voll funktionsfähig: Waage (`waage-modal.js`), Scoreboard (`steuerung.html`/`scoreboard.js`),
  Anzeigen der eigenen Matte (`anzeige`, `overlay`).
- Verwaltungsseiten (`turnier`, `teilnehmer`, `pools`, `mannschaften`, `matten` …) zeigen den Hinweis
  „nur am Hallen-Server verfügbar“.
- Der Scoreboard-Login prüft das Steuerungs-Passwort gegen den Hash im replizierten Dokument
  `konfig:steuerung`, damit er offline funktioniert.
- Im Client-Modus gibt es keine Knex-/SQLite-Instanz.

## 3a. Ein Turnier pro Hallen-Server

Auf dem Hallen-Server wird immer genau ein Turnier ausgetragen.

### Zurücksetzen beim Anlegen oder Einlesen

Gilt ausschließlich für `SYNC_ROLLE=server`. Der Cloud-Betrieb (Postgres, Turniere aller Vereine)
bleibt unverändert.

Beim Anlegen eines neuen Turniers und beim Einlesen einer Turnierdatei (bestehender
Turnier-Import) passiert in dieser Reihenfolge:

1. Bestätigungsdialog in der Oberfläche: „Alle Daten des bisherigen Turniers auf diesem Server
   werden gelöscht.“
2. Brücke und `_changes`-Verarbeitung anhalten.
3. SQLite: alle Turnierdaten löschen (`turniere`, `kampfflaechen`, `pools`, `turnier_teilnehmer`,
   `kaempfe`, `mannschaften`, `mannschaft_mitglieder`, `mannschaftskaempfe`). `benutzer` und
   `vereine` bleiben erhalten, damit der Login am Hallen-Server weiter funktioniert.
4. Die bisherige Dokument-DB `turnier_<alte_instanz_id>` löschen (`destroy`).
5. Neue `instanz_id` (UUID) erzeugen, Turnier anlegen bzw. importieren, neue DB
   `turnier_<neue_instanz_id>` anlegen und vollständig aus SQLite befüllen.
6. Brücke wieder starten.

Die `instanz_id` wird in SQLite am Turnier gespeichert (neue Spalte, Migration) und über
`/api/sync/status` ausgeliefert.

### Instanzwechsel auf dem Client

Der Name der Dokument-DB enthält die `instanz_id`. Ein Notebook kann alte Dokumente deshalb nie in
die neue Server-DB zurückreplizieren, denn es repliziert immer nur zwischen gleichnamigen DBs.

Beim Verbinden (und bei jedem Reconnect) fragt der Client `/api/sync/status` ab:

- **Gleiche Instanz:** normale Replikation.
- **Andere Instanz:** Replikation stoppen. Hat die lokale DB noch nicht übertragene Änderungen, werden
  diese als JSON nach `data/verworfen/<alte_instanz_id>_<zeitstempel>.json` geschrieben, und Waage
  bzw. Scoreboard zeigen einen Warnhinweis. Danach wird die lokale DB gelöscht und die neue Instanz
  vollständig repliziert. Geöffnete Seiten laden sich neu.
- **Server hat kein Turnier:** Status gelb „kein Turnier auf dem Server“, lokale DB bleibt unverändert.

## 4. Dokumentmodell

Genau eine Datenbank für das aktuelle Turnier: `turnier_<instanz_id>` (siehe Abschnitt 3a). Bei
wenigen hundert Dokumenten wird vollständig repliziert, ohne Filter.

Jedes Dokument spiegelt genau eine Zeile der relationalen Tabelle, **Feldnamen identisch zu den
Spalten**, damit `src/shared/`-Logik Dokumente und DB-Zeilen gleichermaßen verarbeiten kann.

| `_id` | Inhalt | Schreibberechtigt |
|---|---|---|
| `teilnehmer:<schluessel>` | Stammdaten + `gewicht`, `gewogen`, `kampfbereit`, `gewogen_am`, `gewogen_station`, `sql_id`, ggf. `dublette_von`, `bruecke_fehler` | Server (Stammdaten), Waage (Wiegefelder, Nachmeldung) |
| `pool:<id>` | Modus, Kampfzeit, Golden-Score-Einstellungen, `kampfflaeche_id`, `typ` | nur Server |
| `kampfflaeche:<id>` | Bezeichnung, Status (z. B. pausiert) | Server, Scoreboard (Pause) |
| `kampf:<id>` | `pool_id`, `kampfflaeche_id`, `kaempfer1_id`/`kaempfer2_id`, `kaempfer1/2_quelle_kampf_id`/`_quelle_typ`, `status`, `sieger_id`, `unterbewertung_kaempfer1/2`, `matte_reihenfolge`, `mannschaftskampf_id`, `mannschaft_gewichtsklasse`, `bearbeitet_von`, ggf. `bruecke_fehler` | Scoreboard (Ergebnis), `kaskadeLokal` (Slots, Reihenfolge), Server (maßgeblich) |
| `mannschaft:<id>`, `mannschaftskampf:<id>` | wie Tabellenzeile | nur Server (Stufe 1) |
| `konfig:steuerung` | Hash des Steuerungs-Passworts, Turnier-Basisdaten (Bezeichnung, Datum) | nur Server |
| `konflikt:<uuid>` | `typ`, `prioritaet`, `bezug_id`, `version_lokal`, `version_server`, `erstellt_am`, `erledigt` | Brücke (Anlage), Turnierleitung (`erledigt`) |
| `_local/bruecke-checkpoint` | zuletzt verarbeitete `_changes`-Sequenz (wird nicht repliziert) | Brücke |

### Schlüssel

- Bestehende Datensätze: SQLite-ID als Schlüssel (`teilnehmer:123`, `kampf:456`).
- Offline-Nachmeldungen: `teilnehmer:u-<uuid>` mit `sql_id: null`. Die Brücke legt den Teilnehmer
  in SQLite an und trägt `sql_id` nach; die `_id` bleibt unverändert, weil eine Umbenennung die
  Replikation stören würde. Verweise aus anderen Dokumenten (`kaempfer1_id`, `sieger_id`) nutzen stets
  die SQLite-ID; ein offline nachgemeldeter Teilnehmer kann erst nach dem Sync einem Pool zugelost
  werden, sodass solche Verweise nie auf eine UUID zeigen müssen.
- **Kämpfe entstehen nie auf dem Client.** Die Manager erzeugen beim Anlegen eines Pools bereits alle
  Kämpfe samt Quell-Verknüpfungen; die Offline-Kaskade füllt nur Slots bestehender Dokumente.

### Reihenfolge

Keine separaten Reihenfolge-Dokumente: Die Reihenfolge steht in `kampf.matte_reihenfolge`. Das
Scoreboard sortiert per Mango-Index über (`kampfflaeche_id`, `status`, `matte_reihenfolge`).
Offline behält die Matte die zuletzt vom Server verteilte Reihenfolge; neu spielbar gewordene Kämpfe
hängt `kaskadeLokal` unter Beachtung von `pausenRegel.js` hinten an.

## 5. Datenfluss

### Waage (identisch auf Notebook und Hallen-Server)

1. `datenzugriff.js` liest `teilnehmer:*`; der QR-Scan sucht lokal über die Judopass-ID.
2. Beim Wiegen werden `gewicht`, `gewogen`, `kampfbereit`, `gewogen_am` (Gerätezeit + Server-Offset)
   und `gewogen_station` gesetzt und das Dokument gespeichert. Offline bleibt es in der lokalen
   PouchDB, die Replikation überträgt es später selbstständig.
3. Eine Nachmeldung erzeugt ein neues Dokument `teilnehmer:u-<uuid>`.
4. Die Brücke ruft auf dem Server die bestehende Service-Logik auf (Kampfbereit setzen, Anlegen mit
   Dubletten-Prüfung) und spiegelt das Ergebnis zurück.
5. Mannschaftszuordnung aus der Waage heraus bleibt ein REST-Aufruf und ist offline deaktiviert, mit
   Hinweis in der Oberfläche.

### Scoreboard (Ergebnis-Eintrag)

1. Das Scoreboard schreibt das Ergebnis in `kampf:<id>` (`sieger_id`, `status`, Unterbewertungen,
   `bearbeitet_von: matte:<kampfflaecheId>`).
2. **Client-Modus:** `kaskadeLokal` reagiert auf den lokalen `_changes`-Feed, füllt die Slots der
   Folgekämpfe per `kampfProgression.js` und reiht neu spielbare Kämpfe ein. Das Scoreboard sieht den
   nächsten Kampf sofort, auch offline. Bei Kämpfen aus Mannschafts-Pools rechnet `kaskadeLokal`
   nicht (Stufe 2); die Matte wartet auf den Server.
3. **Server:** Die Brücke wendet das Ergebnis über die bestehende Kampf-Update-Logik an
   (`triggerPoolUpdate`, Kaskade, `planeKaempfeFuerKampfflaeche`) und schreibt **alle** dadurch
   geänderten Kämpfe mit `bearbeitet_von: server` zurück, inklusive maßgeblicher Reihenfolge.
4. Die Server-Version repliziert zur Matte und überschreibt lokal berechnete Slots und Reihenfolge.
   Im Normalfall sind sie identisch, weil beide Seiten dieselbe `src/shared/`-Logik verwenden.

### Turnierleitung (REST am Hallen-Server)

Korrekturen, Umplanungen und Disqualifikationen laufen wie bisher über die REST-Controller nach
SQLite. Am Ende jeder relevanten Schreiboperation ruft der Controller
`spiegleNachDokumentDb(tabelle, ids)` auf, das die betroffenen Dokumente mit
`bearbeitet_von: server` aktualisiert. Im Cloud-Modus (kein `SYNC_ROLLE`) ist der Hook ein No-op.

### Schleifenvermeidung

- Die Brücke ignoriert Änderungen mit `bearbeitet_von: server`.
- Die zuletzt verarbeitete Sequenz steht in `_local/bruecke-checkpoint`; nach einem Neustart setzt
  die Brücke genau dort fort.
- Beim Serverstart mit leerer Dokument-DB wird der Ist-Stand des Turniers einmalig vollständig aus
  SQLite gespiegelt.

### Anzeigen

`anzeige`, `overlay` und `dashboard` hören per `changes({ live: true })` auf die Dokument-DB des
eigenen Knotens. `BroadcastChannel` bleibt nur für die Kommunikation innerhalb eines Browsers
bestehen (Scoreboard → Overlay im selben Browser).

## 6. Konflikte und Fehlerbehandlung

**Grundsatz:** Der Hallen-Server ist maßgeblich. Jede fachlich relevante automatische Auflösung wird
als `konflikt:`-Dokument protokolliert.

| Fall | Auflösung |
|---|---|
| Zwei Wiegungen desselben Judoka (CouchDB-`_conflicts`) | Jüngerer `gewogen_am` gewinnt, die Brücke entfernt die unterlegene Revision. Kein Konflikt-Dokument. |
| Offline-Nachmeldung ist Dublette | Nicht anlegen; UUID-Dokument per `sql_id` und `dublette_von` mit dem vorhandenen Teilnehmer verknüpfen, Wiegedaten „letzter gewinnt“ übernehmen; Konflikt-Dokument (Info). |
| Server lehnt Mattenergebnis ab (Kampf umgeplant, Teilnehmer disqualifiziert, Ergebnis von der Turnierleitung anders gesetzt) | Server-Version gewinnt und überschreibt; Konflikt-Dokument mit beiden Versionen. |
| Offline-Kaskade weicht ab, Kampf noch nicht gespielt | Server-Version überschreibt stillschweigend. |
| Offline-Kaskade weicht ab, Kampf offline bereits mit anderer Paarung gespielt | Keine automatische Lösung: Kampfstatus `klaerung`, Konflikt-Dokument mit hoher Priorität, Turnierleitung entscheidet manuell. |
| Brücke scheitert an einer Änderung (Exception) | `bruecke_fehler` am Dokument + Konflikt-Dokument; der Feed läuft weiter. Erneuter Versuch bei der nächsten Änderung des Dokuments oder per Knopf in der Konfliktliste. |
| Replikation scheitert an der Authentifizierung | Replikation stoppt, Status rot, keine automatischen Wiederholungen bis zur Korrektur der Konfiguration. |

**Neuer Kampfstatus:** `klaerung` wird dem bestehenden Status-Lifecycle der Kämpfe hinzugefügt
(Migration). Kämpfe in `klaerung` werden vom Scoreboard nicht aufgerufen.

### Sichtbarkeit

- **Sync-Status** in Waage und Scoreboard: grün = verbunden, gelb = offline mit n ausstehenden
  Änderungen, rot = Authentifizierungs- oder Konfigurationsfehler.
- **Konfliktliste** in der Turnierleitung (`matten.html`): offene Konflikte mit beiden Versionen,
  Knopf „erledigt“, bei Brückenfehlern Knopf „erneut versuchen“.

### Restrisiko Geräte-Uhr

„Letzter gewinnt“ hängt an Zeitstempeln. Beim Verbinden ermittelt der Client den Offset zur
Server-Uhr und speichert `gewogen_am` korrigiert. Eine bereits vor dem ersten Verbinden falsch
gehende Uhr bleibt ein Risiko, das durch die organisatorische Trennung der Waage-Stationen
entschärft ist.

## 7. Tests

Playwright bleibt die einzige automatisierte Suite.

### Neue Suite `tests/e2e-sync/`

- Eigene Config `playwright.sync.config.js`, npm-Script `test:e2e:sync`.
- Startet zwei Knoten: Hallen-Server (Port 3100, SQLite `data/test.sqlite`, `/db`) und Client
  (Port 3101, `SYNC_ROLLE=client`, LevelDB unter `data/test-client/`). Beide Datenverzeichnisse
  werden im `globalSetup` zurückgesetzt.
- Verbindungsabbruch per Test-Endpunkt `/api/sync/test/trennen` bzw. `/api/sync/test/verbinden`
  (nur bei `NODE_ENV=test`), statt echter Netzwerk-Manipulation.

### Kerntests

1. Die Waage wiegt offline 5 Judoka und legt 1 Nachmeldung an → nach dem Reconnect stehen alle Daten
   in SQLite, die Nachmeldung existiert genau einmal.
2. Das Scoreboard spielt einen DK8-Pool offline komplett durch → nach dem Reconnect sind die
   SQLite-Ergebnisse, die Kaskade und die Siegerliste identisch zum Online-Durchlauf.
3. Je ein Test pro Zeile der Konflikttabelle (Abschnitt 6).
4. Neustart des Hallen-Servers während ausstehender Änderungen → die Brücke setzt am Checkpoint fort,
   nichts wird doppelt angewendet.
5. Ein neues Turnier wird eingelesen, während ein Client mit ausstehenden Änderungen offline ist →
   nach dem Reconnect enthält die Server-DB keine Dokumente des alten Turniers, der Client hat die
   neue Instanz, und die verworfenen Änderungen liegen in `data/verworfen/`.

### Wiederverwendung

Die vier bestehenden `tests/e2e/steuerung-*-online-vs-offline.spec.js` (JGJ, DK8, DK16,
Gruppen-Überkreuz) vergleichen bereits den Online- mit dem Offline-Pfad. Sie werden auf den neuen
Sync-Pfad umgestellt und in die Sync-Suite verschoben; sie dienen als Orakel für die
Offline-Kaskade.

Neue oder erweiterte `src/shared/`-Funktionen werden über die E2E-Pfade in beiden Modi abgedeckt
(kein Unit-Test-Setup vorhanden).

## 8. Ablösung des alten Offline-Mechanismus

Letzter Schritt von Stufe 1, erst wenn die Sync-Suite grün ist. Bis dahin existieren beide
Mechanismen parallel.

**Entfällt:**

- JSON-Export/-Import pro Matte: `src/controllers/offlineController.js`, `src/routes/offlineRoutes.js`,
  `/api/offline/*`, die zugehörigen Buttons in `public/js/kampf.js`
- `offlineState` und `isOfflineMode` im `localStorage` von `public/js/scoreboard.js`

**Bleibt unverändert:**

- Turnier-Transfer Cloud ↔ Hallen-Server (Turnier-Export/-Import mit `urspruengliche_id` in
  `turnierController.js`)
- Suite `tests/e2e-vollablauf/`
- Cloud-Betrieb mit Postgres (kein Sync)

`CLAUDE.md` wird um die neuen Modi, `.env`-Parameter, `src/sync/` und die Sync-Suite ergänzt.

## 9. Außerhalb des Umfangs von Stufe 1

- Offline-Berechnung von Mannschaftsbegegnungen (Stufe 2)
- Mannschaftszuordnung an der Waage im Offline-Zustand
- Verwaltungsseiten im Client-Modus
- Replikation direkt zwischen Notebooks (nur Stern-Topologie zum Hallen-Server)
- Direkte Replikation Hallen-Server ↔ Cloud (weiter per Turnier-Datei-Transfer)
- Apache CouchDB als externer Dienst
