# CouchDB/PouchDB-Migration — Zielarchitektur

Status: genehmigt (Design), Umsetzung folgt phasenweise
Datum: 2026-09-22
Branch: `Couch-DB`

## Ausgangsproblem

Beim Wiegen (Waage) finden männlicher und weiblicher Wettbewerb zeitgleich an zwei
unterschiedlichen Orten statt, vermutlich ohne WLAN-Verbindung. Mit nur einem
Server-Notebook (heutiges Modell: ein Node-Prozess spricht exklusiv mit genau einer DB,
Postgres online oder SQLite offline) ist das nicht sauber abbildbar.

Darüber hinaus: das Turnier soll grundsätzlich immer mit einem **Technik-Koffer**
(Notebook + WLAN-Router, in der Halle aufgestellt) ausgetragen werden — das ist der
Normalbetrieb, kein Fallback. Alle Kampfflächen-Notebooks arbeiten im Hallen-WLAN gegen
diesen zentralen Server.

## Zielarchitektur — Übersicht

- **Online-CouchDB (Cloud):** dauerhaft erreichbar, wird ausschließlich **vor** dem
  Turniertag (Turnier-Vorbereitung, Anmeldungen, Vereins-/Benutzerdaten) und **nach** dem
  Turniertag (Ergebnis-Archiv, öffentliche Siegerliste) verwendet.
- **Lokale CouchDB (Technik-Koffer):** läuft während des gesamten Turniertags autark ohne
  Internetabhängigkeit, zusammen mit dem WLAN-Router in der Halle.
- **Express-Server:** bleibt bestehen, aber deutlich reduziert. Zuständig für:
  Static-Hosting (`public/`), Online-Login/JWT-Ausstellung (nur online relevant),
  CouchDB-Datenbank-Provisionierung, den Online↔Lokal-Sync-Auslöser, und den zentralen
  Kaskaden-Abgleichsdienst (siehe unten). Sitzt **nicht mehr** im normalen Lese-/Schreibpfad
  der Fachlichkeit.
- **Alle Seiten-Clients** (Kampf, Steuerung, Matten, Pools, Teilnehmer, Mannschaften,
  Waage, Anzeige/Dashboard/Siegerliste): PouchDB im Browser, repliziert kontinuierlich
  gegen die lokale CouchDB, solange WLAN-Verbindung besteht. Waage-Notebooks sind der
  Extremfall: PouchDB arbeitet dort vollständig getrennt vom Netz und repliziert
  opportunistisch bei Gelegenheit.

## Betriebsmodell: ein Turnier pro Technik-Koffer, sequenziell

Der Technik-Koffer trägt zu jedem Zeitpunkt genau **ein** aktives Turnier, nicht mehrere
gleichzeitig:

1. **Vorbereitung (zu Hause, vor dem Turniertag):** Turnier-Daten von Verein X werden per
   CouchDB-Replikation (`_replicate`, one-shot Pull) von der Online-CouchDB auf die lokale
   CouchDB gezogen. Die lokale Turnier-Datenbank wird dabei vollständig neu angelegt (kein
   Merge mit evtl. Altdaten).
2. **Turniertag:** Technik-Koffer wird an Verein X übergeben, läuft komplett autark, kein
   Internet nötig.
3. **Nach dem Turnier:** Ergebnisse werden per one-shot Push von lokal zurück in die
   Online-CouchDB repliziert.
4. **Übergabe an nächstes Turnier (Verein Y):** Die lokale Turnier-Datenbank wird
   gelöscht, Schritt 1 wiederholt sich mit Verein Ys Turnier.

Es gibt **keine dauerhafte bidirektionale Replikation** und damit kein Konfliktrisiko
zwischen Online- und Lokal-Stand — beide Seiten sind nie gleichzeitig aktiv beschrieben.

**Fallback ohne Internet am Technik-Koffer:** Statt CouchDB-nativer Replikation ein
Datei-Export (JSON-Dump der Quell-DB, `_all_docs?include_docs=true`) und manueller Import
(`_bulk_docs`) auf der Zielseite — funktioniert identisch zum heutigen
Download-Datei/Upload-Datei-Modell, nur ohne Live-Verbindung nötig.

## Lokaler Betrieb: kein Login

Am Technik-Koffer (gesichertes Hallen-WLAN) gibt es **keinen Login**. Zugriffsschutz ist
das WLAN selbst, nicht die Anwendung — analog zum heutigen `IS_OFFLINE`-Verhalten
(`requireAuth` überspringt JWT und arbeitet mit einem impliziten `offline_user`, siehe
[src/middleware/auth.js](../../../src/middleware/auth.js)). Die `accounts`-Datenbank
(Vereine/Benutzer/Login) wird **nicht** auf den Technik-Koffer repliziert — sie bleibt
reine Online-Angelegenheit.

Konsequenz für die Navigation: die heutige Seitenfolge `login → verein_auswahl → turniere`
entfällt am Technik-Koffer vollständig. Die lokale Anwendung startet direkt in der
Verwaltung des einen geladenen Turniers.

## Datenmodell

- **Eine CouchDB-Datenbank pro Turnier** (`turnier_<id>`) statt einer globalen Datenbank
  mit `turnier_id`-Spalte. Passt zum Replikationsmodell: eine ganze Turnier-DB wird als
  Einheit repliziert/exportiert/gelöscht.
- **Eine separate `accounts`-Datenbank** (nur online) für `vereine`/`benutzer`/
  Vereinsmitgliedschaften.
- **Dokumenttypen statt Tabellen:** jede heutige Tabelle (`pools`, `turnier_teilnehmer`,
  `kaempfe`, `mannschaften`, `mannschaft_mitglieder`, `mannschaftskaempfe`,
  `kampfflaechen`) wird ein Dokumenttyp mit präfigierter `_id` (z.B. `kampf:<uuid>`,
  `pool:<uuid>`) für `allDocs`-Bereichsabfragen als Ersatz für "alle Dokumente eines Typs".
- **Beziehungen als Freitext-Referenzen** (`pool_id`, `teilnehmer_id` als Doc-IDs) statt
  SQL-Fremdschlüssel. Referenzielle Integrität und Check-Constraints (z.B. die 6 FKs der
  heutigen `mannschaftskaempfe`-Migration) wandern vollständig in Anwendungscode/
  Validierung.
- **IDs:** UUIDs statt Auto-Increment/Sequenzen.
- **Explizite Sortierfelder** (z.B. `reihenfolge` bei Kämpfen einer Kampffläche) statt
  impliziter Einfüge-Reihenfolge (heute teils von SQLite-Rowid-Reihenfolge abhängig — das
  fällt komplett weg und muss explizit gemacht werden).
- **Sekundäre Indizes:** Mango-Indizes als Ersatz für `WHERE pool_id = X` /
  `WHERE status = 'bereit'`-Abfragen, die heute SQL direkt übernimmt.

## Kaskaden-Logik (Bracket-Progression)

Heute laufen `kampfProgression.js`/`mannschaftsProgression.js` serverseitig im
Express-Controller nach jedem Ergebnis (`triggerPoolUpdate`). Unter PouchDB/CouchDB
könnten mehrere Kampf-Notebooks gleichzeitig denselben Pool fortschreiben wollen —
deshalb zweigleisig:

1. **Lokal auf jedem Kampf-/Steuerung-Notebook:** Der Client berechnet die Kaskade selbst
   aus seiner eigenen PouchDB, mit demselben framework-freien
   [src/shared/kampfProgression.js](../../../src/shared/kampfProgression.js) /
   `mannschaftsProgression.js`, das heute schon client-seitig für die Offline-Anzeige
   läuft. Dadurch bleibt "nächster Kampf laden" auch bei kurzen WLAN-Aussetzern in der
   Halle sofort verfügbar, ohne auf eine zentrale Antwort zu warten.
2. **Zentral auf dem Technik-Koffer-Server:** Ein persistenter `_changes`-Feed-Listener
   (kein Express-Request/Response, sondern ein Hintergrunddienst im selben Prozess)
   reagiert auf jede `kaempfe`-Dokumentänderung, berechnet dieselbe Kaskade und schreibt
   das Ergebnis autoritativ fest. Dient als Abgleich/Konfliktauflösung, falls zwei Matten
   quasi gleichzeitig denselben Folgekampf befüllen — CouchDBs Revisions-Mechanismus macht
   solche Konflikte sichtbar (`_conflicts`), die zentrale Instanz löst sie auf.

Die Waage benötigt diese Kaskaden-Logik nicht: Pools werden erst nach Abschluss des
Wiegens als expliziter, manueller Schritt gebildet (siehe
[CLAUDE.md](../../../CLAUDE.md), Abschnitt "Offline-Modus pro Matte").

## Hochverfügbarkeit: gespiegelter Zweit-Server für den Technik-Koffer

Ein Serverausfall am Turniertag darf den gesamten Betrieb nicht stoppen. Der Technik-Koffer
besteht deshalb aus zwei baugleichen Linux-Notebooks (SSD-Speicher für die CouchDB-
Datenverzeichnisse):

- **Primär-Server:** läuft normal, bedient alle PouchDB-Clients.
- **Sekundär-Server:** reiner Lese-Spiegel, nie direktes Ziel von Client-Schreibzugriffen.
- **Virtuelle IP (VIP) via `keepalived` (VRRP):** beide Notebooks laufen im selben
  Hallen-WLAN und teilen sich eine virtuelle Adresse, die immer zum aktuell aktiven
  ("MASTER")-Server gehört. Alle PouchDB-Clients (und die Replikation selbst) verbinden
  sich ausschließlich über diese VIP, nie über eine der beiden festen Geräte-IPs — dadurch
  merken Clients einen Wechsel automatisch, ohne Rekonfiguration.
- **Kontinuierliche Replikation, gesteuert durch `keepalived`-State-Transitions:** Der
  jeweils passive ("BACKUP")-Server repliziert fortlaufend von der VIP (die zum aktuell
  aktiven Server zeigt) in seine eigene lokale CouchDB. `keepalived`s `notify_backup`-Hook
  startet diese Replikation, `notify_master`-Hook stoppt sie (ein Server repliziert nie von
  sich selbst).
- **Automatische Übernahme, keine manuelle Bestätigung:** Erkennt `keepalived` auf dem
  Sekundär-Server den Ausfall des Primär-Servers (VRRP-Heartbeat bleibt aus), übernimmt er
  automatisch die VIP und wird MASTER — bewusst ohne Rückfrage, da beide Server durch die
  kontinuierliche Replikation ohnehin denselben Datenstand halten und eine fälschliche
  Übernahme (z.B. durch einen kurzen WLAN-Aussetzer statt eines echten Ausfalls) keinen
  Schaden anrichtet.

Dies ist eine reine Infrastruktur-/Deployment-Maßnahme (Netzwerk- und Prozess-Konfiguration
auf den beiden Technik-Koffer-Notebooks) und erfordert keine Änderung an
Anwendungscode/Datenmodell — sie setzt lediglich voraus, dass alle Phase-2-Clients
(PouchDB) und der Phase-3-Kaskadendienst grundsätzlich gegen einen konfigurierbaren
Hostnamen/eine IP arbeiten statt eine Adresse fest zu verdrahten.

## Betroffene Umfänge (heutiger Stand, zur Einordnung der Größe)

- 293 direkte `knex(...)`-Aufrufe über je 9 Dateien in `src/controllers/` und
  `src/services/` — keine Repository-Abstraktion vorhanden, jede Stelle muss einzeln auf
  den neuen Datenzugriff umgestellt werden.
- 39 Migrationsdateien / ca. 1396 Zeilen Schema, u.a. `mannschaftskaempfe` mit 6
  Fremdschlüsseln in einer einzigen Tabelle — das dichteste Beziehungsgeflecht.
- Der heutige Offline-Export/Import (`src/controllers/offlineController.js`) ist ein
  blindes Pro-Kampf-Overwrite ohne Konflikterkennung — wird durch den oben beschriebenen
  CouchDB-Replikations-Workflow vollständig ersetzt.
- E2E-Suite (`tests/e2e/`, `tests/e2e-vollablauf/`) setzt heute vor jedem Lauf eine SQLite-
  Testdatenbank per Knex-Migration zurück — braucht ein CouchDB-Äquivalent.

## Rollout in Phasen

Der Umbau ist zu groß für einen einzelnen Umsetzungsplan. Jede Phase bekommt später ihren
eigenen Umsetzungsplan (`writing-plans`); nur Phase 1 wird im Anschluss an diese Spec
direkt geplant.

1. **Persistenz-Swap (Server):** Knex/Postgres/SQLite → CouchDB (`nano`) hinter der
   bestehenden Express-REST-API. Verhalten bleibt für alle Seiten unverändert (noch keine
   PouchDB-Clients), nur der Speicher darunter wechselt. Legt das Dokumentmodell (Typen,
   IDs, Mango-Indizes) als Fundament für alle Folgephasen fest. E2E-Suite läuft danach
   gegen eine lokale CouchDB-Testinstanz statt SQLite. Höchstes Risiko dieser Migration.
2. **PouchDB-Clients:** Jede Seite bekommt PouchDB + Replikation gegen die lokale CouchDB
   statt REST-Fetch, beginnend mit Waage (eigentlicher Auslöser der Migration), danach
   Kampf/Steuerung, dann Pools/Teilnehmer/Mannschaften/Matten/Anzeige/Dashboard/
   Siegerliste. Inklusive Navigations-Vereinfachung (kein Login/Auswahl-Seiten lokal).
3. **Kaskaden-Logik:** Client-seitige Progression auf Kampf-/Steuerung-Notebooks plus
   zentraler `_changes`-Abgleichsdienst auf dem Technik-Koffer-Server.
4. **Online↔Lokal-Sync-Werkzeug:** One-shot Pull/Wipe/Push-Replikation plus
   Datei-Export/Import-Fallback, inklusive Turnier-Übergabe-Workflow ("Turnier X auf
   Technik-Koffer laden" / "Ergebnisse hochladen & Speicher freigeben").
5. **Hochverfügbarkeit Technik-Koffer:** `keepalived`/VRRP-Konfiguration auf den zwei
   baugleichen Linux-Notebooks, virtuelle IP, kontinuierliche Primär→Sekundär-Replikation
   mit automatischer Übernahme bei Ausfall (siehe Abschnitt "Hochverfügbarkeit" oben). Reine
   Infrastruktur-Phase, unabhängig von Phase 1–3 planbar, muss aber vor dem produktiven
   Einsatz von Phase 2 (PouchDB-Clients) stehen, da diese von Anfang an gegen die VIP statt
   eine feste Geräte-IP konfiguriert werden.

## Offene Punkte für spätere Phasen (bewusst hier nicht entschieden)

- Genaues Format/Tooling für den Datei-Export/Import-Fallback (Phase 4).
- Wie der zentrale `_changes`-Listener-Dienst im Node-Prozess technisch eingebettet wird
  (Phase 3).
- Ob/wie eine einzelne Person (Geräteverantwortlicher) für Support-Zwecke am Technik-Koffer
  identifiziert werden soll, ohne einen echten Login einzuführen — aktuell nicht
  gewünscht, könnte aber bei Bedarf später ergänzt werden.
- Genaue `keepalived`-Konfigurationsdetails (VRRP-Router-ID, Heartbeat-Intervalle,
  Netzwerkschnittstelle) und das genaue Shell-Skript für die `notify_master`/
  `notify_backup`-Hooks (Phase 5).
