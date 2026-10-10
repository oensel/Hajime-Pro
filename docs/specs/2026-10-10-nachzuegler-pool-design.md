# Nachzügler in ausgeloste Altersklassen — Design

Stand: 2026-10-10 (Revision 2: gemeinsamer Sammelpool „Verspätet“) · Ergänzt `2026-10-08-waage-runden-design.md`
(dort war „Nachzügler in eine ausgeloste Altersklasse“ ausdrücklich nicht im Umfang; das wird hiermit umgekehrt).

## Ziel

Ein Teilnehmer, der erst nach der Auslosung seiner Altersklasse angemeldet oder gewogen wird, soll in einen
passenden Pool einrutschen können, solange dort noch kein Kampf begonnen hat. Passt kein Pool, landet er in einem
gemeinsamen Sammelpool „Verspätet“, aus dem die Turnierleitung ihn per Drag&Drop in einen noch nicht begonnenen Pool
zieht. Das Wettkampfsystem des Zielpools passt sich der neuen Teilnehmerzahl an, die Matte plant neu und die
Mattenleitung erfährt davon.

**Erfolgskriterien**

- Anmelden/Einwiegen in eine ausgeloste Altersklasse ist möglich.
- Gesperrt ist je **Pool**, nicht je Altersklasse: ein Pool ist zu, sobald ein Kampf `gestartet`/`beendet` ist.
- Einfügen in einen Pool ist nur möglich, solange dort noch kein Kampf begonnen wurde.
- Passt ein offener Pool, erscheint ein **Vorschlag**, den die Turnierleitung auf der Pools-Seite bestätigt (kein
  stilles Einsortieren).
- Passt kein offener Pool, wird der Teilnehmer automatisch dem Sammelpool „Verspätet“ zugeordnet (pro Turnier genau
  einer, über alle Altersklassen). Die Turnierleitung verschiebt ihn dort per Drag&Drop.
- Der Sammelpool ist nur auf `pools.html` sichtbar: nicht in Siegerliste, Urkunden, Matten, Dashboard,
  Übersicht/Anzeige, Menü-Auswertungen und nicht in „Pools aufteilen“.

**Nicht im Umfang**

- Zusatzkämpfe für Nachzügler in laufende Pools (der vorhandene Zusatzkampf `legeZusatzkampfAn` gilt nur für
  Pool-Mitglieder in Prüfung).
- Nachzügler in Pools mit begonnenen Kämpfen.
- Mannschafts-Pools (bleiben bei ihrem Sperrmodell, `mannschaftsPoolsHabenEchteKaempfe`).
- Abweisen eines Nachzüglers (entfällt; der Sammelpool ist der Weg für alle, die nicht passen).

## Begriffe

- **Nachzügler:** Einzel-Teilnehmer, `status = 'kampfbereit'`, `pool_id IS NULL`, Altersklasse bereits ausgelost
  (es gibt dort mindestens einen Einzel-Pool mit Teilnehmern), kein reines Mannschaftsmitglied.
- **Offener Pool:** Einzel-Pool des Turniers (`typ <> 'mannschaft'`, nicht der Sammelpool) ohne Kämpfe mit Status
  `gestartet`/`beendet`.
- **Passender Pool:** offener Pool mit gleicher Altersklasse, gleichem Geschlecht (bzw. `mixed`) und einer
  Gewichtsspanne, die nach DJB-Regel (`pruefeGewichtsspanne`) mit dem Nachzügler zulässig bleibt und für dessen
  Teilnehmerzahl ein Wettkampfsystem hat.
- **Sammelpool „Verspätet“:** `pools.verspaetet = true`, `bezeichnung = 'Verspätet'`, Altersklasse `Verspätet`,
  Geschlecht `mixed`, Gewichtsklasse `-` (die Spalten sind NOT NULL), Modus `Nicht startbereit`, keine Kämpfe, keine
  Matte, Status `teilnehmer_zugewiesen`. Wird beim ersten Bedarf angelegt, bleibt danach bestehen.

## Entwurf

### 1. Sperre je Pool

`teilnehmerController.js` / `poolController.js`:

- **Anmelden/Importieren** in eine ausgeloste Altersklasse: kein 409 mehr. Der Teilnehmer startet ohne Pool.
  Gastvereine melden weiter nur an, solange das Turnier „veröffentlicht“ ist.
- **Ändern, Wiegen, Löschen, Zurückziehen** eines Teilnehmers: gesperrt, wenn sein eigener Pool echte Kämpfe hat
  (`ermittleSperrgrund` prüft `athlet.pool_id`, nicht mehr die Altersklasse). Teilnehmer ohne Pool oder im Sammelpool
  sind nie durch Kämpfe gesperrt.
- Wechsel der Altersklasse eines Teilnehmers in einem offenen Pool: er wird aus dem Pool gelöst, der Pool neu
  aufgebaut, und er erscheint als Nachzügler.
- `ermittleAltersklassenPoolZustand` liefert zusätzlich `gesperrtePoolIds` und ignoriert den Sammelpool;
  `gesperrteAltersklassen` bleibt für alte Clients erhalten. `GET /api/pools/vorhanden` und
  `src/shared/clientAntworten.js` rechnen dieselbe Regel (Client-Geräte).
- `teilnehmer.js`: Aktionen sind nur für Teilnehmer in gesperrten Pools deaktiviert; Banner nennt die betroffenen
  Altersklassen.

### 2. Vorschlag, automatische Zuordnung zum Sammelpool

**Server** (`poolController.js`, `services/nachzuegler.js`, `poolRoutes.js`)

- `GET /api/pools/nachzuegler?turnierId=` (lesend, ohne Seiteneffekt) liefert
  `{ nachzuegler: [{ teilnehmerId, name, verein, altersklasse, geschlecht, gewicht, vorschlag }], imSammelpool }`.
  `vorschlag` ist der beste passende offene Pool `{ poolId, bezeichnung, teilnehmerNachher, systemNachher, matteId }`
  (gleiche Gewichtsklasse zuerst, dann kleinster Gewichtsabstand, dann kleinste Teilnehmerzahl) oder `null`.
  `imSammelpool` ist die Zahl der Teilnehmer im Sammelpool.
- `POST /api/pools/nachzuegler/:teilnehmerId/einsortieren` mit `{ poolId }`: prüft den Pool erneut (offen, sonst 409),
  setzt `pool_id`, baut die Kämpfe des Pools neu auf (`regeneriereKampfplanFuerPool`, System aus der Teilnehmerzahl),
  plant die Matte des Pools neu (`planeKaempfeFuerKampfflaeche`, `synchronisiereMattenStatus`).
- `POST /api/pools/nachzuegler/sammeln` mit `{ turnierId }` (idempotent): legt alle Nachzügler **ohne** Vorschlag in
  den Sammelpool (legt ihn bei Bedarf an) und liefert `{ success, anzahl }`.
- Das Einsortieren ist atomar (Transaktion mit Zeilensperre auf den Kämpfen des Pools): beginnt parallel ein Kampf,
  wird mit 409 abgewiesen.

**Verschieben** (`POST /api/pools/verschieben`, vorhanden): Quelle oder Ziel ist der Sammelpool → für ihn wird kein
Kampfplan erzeugt (er hat nie Kämpfe). Für den Zielpool gilt wie bisher: nur ohne begonnene Kämpfe, danach Neuaufbau
und – neu – Neuplanung der Matte.

**Frontend** (`public/pools.html`, `public/js/pools.js`)

- Bereich „Nachzügler“ oberhalb der Pools, nur sichtbar bei Nachzüglern mit Vorschlag. Je Zeile: Name, Klasse, Gewicht,
  Vorschlag („Pool U11 m −30kg: 4 → 5 Teilnehmer, Jeder-gegen-Jeden, Matte 2“) und der Knopf **Übernehmen**.
- Beim Laden der Seite (und nach jeder Aktion) ruft `pools.js` bei Nachzüglern ohne Vorschlag einmal
  `/api/pools/nachzuegler/sammeln` auf und lädt die Pools neu.
- `GET /api/pools/details` blendet den Sammelpool standardmäßig aus; `pools.js` fragt mit `&mitVerspaetet=1` ab und
  rendert ihn als besondere Zeile ganz oben („Verspätet – wartet auf Zuordnung“, keine Systemwahl/Kampfzeit/Kampfplan,
  Teilnehmer per Drag&Drop ziehbar; der Pool bleibt stehen, wenn er leer ist).
- Menüpunkt „Pools“ zeigt einen Zähler (Nachzügler mit Vorschlag + Teilnehmer im Sammelpool).

### 3. Matte

- Nach dem Einsortieren bzw. Verschieben plant der Server die Matte neu (löst die bisherige Lücke von
  `verschiebeTeilnehmer`, das die Kämpfe neu erzeugt, aber die Matte nicht neu plant).
- Der Sync-Abgleich spiegelt Kämpfe und Teilnehmer wie bei jeder anderen Änderung; Client-Geräte bekommen sie über
  die Replikation.
- Die Mattenleitung (`steuerung.html`) zeigt einen Hinweis „Pool {Bezeichnung} wurde geändert: Kämpfe neu
  aufgebaut“, sobald sich die Kämpfe eines noch nicht begonnenen Pools der gewählten Matte ändern. Ein bereits
  geladener, aber nicht gestarteter Kampf dieses Pools wird dabei verworfen und die Ansicht neu aufgebaut; die
  Meldung nennt das ausdrücklich.

### 4. Sammelpool nur auf `pools.html`

Der Sammelpool (`verspaetet = true`) wird serverseitig überall ausgeblendet, wo Pools aufgelistet oder verwendet
werden; `pools.html` ist der einzige Ort mit `mitVerspaetet=1`:

- `GET /api/pools/details` (Standard ausgeblendet; damit auch Siegerliste, Menü-Auswertungen, Druckansicht),
  `GET /api/pools/kampfflaechen` (Matten, „unzugeordnet“), `GET /api/pools/dashboard`, `GET /api/pools/uebersicht`.
- `verteilePools` („Pools aufteilen“, beide Modi): nie verteilen.
- Urkunden (`urkundenDaten.js`): keine Urkunden, keine Auswahl.
- Pool-Zustand (`ermittleAltersklassenPoolZustand`): zählt nicht als ausgeloste Altersklasse.
- Auf Client-Geräten ist er unsichtbar, weil er keine Matte und keine Kämpfe hat (Mattenansicht entsteht aus Kämpfen).

## Tests

- **Unit:** Vorschlagsberechnung (passender Pool, Gewichtsspanne, Mixed, kein Vorschlag, Systemgrenzen, Pool ohne
  Platz); Sperrlogik je Pool in `clientAntworten.js`; Ausblendung in `urkundenDaten.js`.
- **E2E (`tests/e2e/nachzuegler-pool.spec.js`):** Pool einer Altersklasse ausgelost und auf der Matte. Nachmeldung in
  die ausgeloste Klasse wird angenommen; Liste zeigt den Vorschlag; Übernehmen baut den Pool neu (System, Kämpfe,
  Mattenreihenfolge); nach dem ersten echten Kampf: Einsortieren → 409 und Teilnehmer landet über `sammeln` im
  Sammelpool „Verspätet“; Drag&Drop (`/api/pools/verschieben`) aus dem Sammelpool in einen offenen Pool; Sammelpool
  fehlt in `/api/pools/details` (Standard), Siegerliste, Urkunden, Matten und „Pools aufteilen“.
- **Sync-Suite:** Nachmeldung am Client-Gerät in ausgeloste Klasse wird nicht mehr abgelehnt; der Nachzügler
  erscheint am Server in der Liste. Bestehende Specs zur Altersklassen-Sperre (`waage-runden.spec.js`) werden auf die
  Pool-Sperre umgestellt.

## Risiken

- **Zwei Sperrberechnungen** (Server und `clientAntworten.js`) müssen identisch bleiben; der Sync-Test prüft das.
- **Geladener Kampf an der Matte:** der Server kennt den Ladezustand des Scoreboards nicht, deshalb der Hinweis statt
  einer Sperre.
- **Pool wechselt Wettkampfsystem** (5 → 6: Gruppen-Überkreuz, 8 → 9: Doppel-KO-16): Kämpfe werden komplett neu
  erzeugt; die Vorschau nennt das System vorab.
- **Sentinel-Werte im Sammelpool** (Altersklasse `Verspätet`): überall dort, wo Pools nach Altersklasse gruppiert
  werden, muss er ausgefiltert sein (siehe Abschnitt 4); der Test deckt die Auflistungen ab.
- **Drag&Drop prüft kein Gewicht** (bestehendes Verhalten): die Turnierleitung entscheidet.

## Offene Punkte

- Keine.
