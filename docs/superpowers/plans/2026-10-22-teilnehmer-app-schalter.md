# Teilnehmer-App-Schalter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Hallen-Server (allein oder im Cluster) sendet Turnierdaten an die Cloud, sobald der Veranstalter die „Teilnehmer-App“ über ein Kopfleisten-Icon bzw. den Hinweis auf `matten.html` einschaltet. Token kommt beim Holen des Turniers aus der Cloud.

**Architecture:** Neues Modul `src/liveApp/` (reine Zustandslogik + Dienst im Server-Prozess) nutzt `ladeSnapshots`/`erzeugeUplink` aus `src/live/`. Die Cloud stellt beim Export mit `?liveToken=1` ein an das Turnier gebundenes Ingest-Token aus; der Import speichert es am Turnier. Zustand (an/aus, Token, Geheimnis) liegt in `turniere` und repliziert im Cluster; genau ein Knoten sendet (Regel in `entscheideSender`). Frontend: Icon + Dialog (`public/js/teilnehmerApp.js`) und Hinweiskasten in `matten.html`.

**Tech Stack:** Node.js ES-Module, Express, Knex/PostgreSQL, Vanilla-JS, `node:test` (Unit), Playwright (E2E, Fake-Cloud `tests/helpers/fake-cloud.mjs`).

**Spec:** `docs/specs/2026-10-22-teilnehmer-app-schalter-design.md`

## Global Constraints

- Prüfintervall Cloud-Erreichbarkeit: 15 s (`LIVE_APP_PRUEF_MS`, Standard 15000); Uplink-Takt 5 s (`LIVE_APP_TAKT_MS`, Standard 5000); „grün“ nur, wenn der letzte erfolgreiche Versand höchstens 90 s alt ist.
- Farben des Icons: rot `#c62828`, gelb `#f9a825`, grün `#2e7d32`, grau `#9e9e9e`; Material-Icon `phone_iphone`; Icon sitzt direkt links vom Cluster-Icon (`hallenServerBtn`) in `.top-header-actions` von `public/js/menu.js`.
- Texte (Deutsch, exakt): Dialogtitel „Teilnehmer-App“; Schalter „Daten an die Teilnehmer-App senden“; Einschalt-Hinweis „Beim Einschalten werden Namen, Vereine und Paarungen der Teilnehmer in die Cloud gesendet.“; Internet-Hinweis „Braucht eine Internetverbindung an diesem Rechner (z. B. USB-Tethering). Die Verbindung wird regelmäßig geprüft.“; Hinweiskasten „Teilnehmer-App verfügbar“ mit Knöpfen „Aktivieren“ und „Später“; Tooltip rot „Keine Verbindung zur Cloud – die Teilnehmer-App erhält keine Daten“, gelb „Cloud erreichbar, aber es können keine Daten gesendet werden“, grau „Teilnehmer-App ausgeschaltet“.
- Der Dialog nutzt die Theme-Variablen der App (hell und dunkel lesbar), keine festen Text-/Hintergrundfarben.
- Token und Geheimnis stehen nie in API-Antworten, im Turnier-Export des Hallen-Servers, in Sync-Dokumenten oder in Logs.
- Ein neu geholtes/importiertes Turnier startet mit `live_freigabe = false`; nur ein Neustart setzt eine eingeschaltete Funktion fort.
- Die Funktion gibt es nur im Einzelbenutzerbetrieb (`betriebsmodus.istEinzelbenutzerBetrieb()`); der Linux-Weg (`src/live/main.js`, `hajime-live`) bleibt unverändert.
- Die Oberfläche hat keinen Haken „Live freigeben“ (nur die API `PUT /api/turniere/:id/live-freigabe`); nichts in `turnier.html` ist zu entfernen.

## Review Focus

- Token/Geheimnis dürfen nicht über `GET /api/turniere`, `GET /api/turniere/:id`, den Export des Hallen-Servers oder das Sync-Turnierdokument (`src/sync/abgleich.js`) herauslaufen → Test in Task 1.
- Ein normaler Export-Download in der Cloud (ohne `liveToken=1`) darf ein laufendes Hallen-Token nicht sperren → Test in Task 2.
- Ausschalten muss die Daten in der Cloud auch dann zurücknehmen, wenn der Knoten, der sendet, nicht der Master ist, der ausgeschaltet hat → `live_ruecknahme` + Test in Task 3/5.
- Cloud weg → rot, Cloud erreichbar aber Ingest antwortet 5xx/401 → gelb (nicht rot, nicht grün) → Tests in Task 4/5.
- Beide Cluster-Knoten haben Internet: nur einer sendet; nur der Secondary hat Internet: der Secondary sendet; nach Rollenwechsel sendet weiter genau einer → Test in Task 4 (`entscheideSender`) und 6.

---

### Task 1: Spalten, Token-Import und Geheimhaltung am Hallen-Server

**Files:**
- Create: `migrations/20261022120000_teilnehmer_app_schalter.js`
- Modify: `src/controllers/turnierController.js` (`importiereTurnierDaten` ~Z. 915, `baueTurnierExport` ~Z. 1154)
- Test: `tests/e2e/teilnehmer-app-token.spec.js`

**Interfaces:**
- Produces: Spalten `turniere.live_token` (text, null), `turniere.live_geheimnis` (text, null), `turniere.live_ruecknahme` (boolean, not null, default false); `importiereTurnierDaten` liest `daten.live.token`.

- [ ] **Step 1: Failing E2E-Test** `teilnehmer-app-token.spec.js` (Vorbild `tests/e2e/live-freigabe.spec.js`, `testDbVerbindung` aus `test-env.js`): (a) Import-Datei mit `live: { token: 'hjl_testtoken123' }` über `POST /api/turniere/import` (Base64 wie dort) → in der DB hat das neue Turnier `live_token === 'hjl_testtoken123'`, `live_geheimnis` mit 64 Hex-Zeichen, `live_freigabe === false`, `live_ruecknahme === false`; (b) Import ohne `live` → beide Spalten `null`; (c) `GET /api/turniere`, `GET /api/turniere/:id` und `GET /api/turniere/:id/export` (Turnier vorher auf `status: 'veroeffentlicht'` setzen) enthalten weder `live_token` noch `live_geheimnis` noch `live_ruecknahme` (JSON-String enthält die Schlüsselnamen und den Tokenwert nicht).
- [ ] **Step 2:** `npx playwright test tests/e2e/teilnehmer-app-token.spec.js` → FAIL (Spalten fehlen).
- [ ] **Step 3: Migration** `up`/`down` im Stil von `20261022110000_benutzer_super_admin_modus.js` (`export const config = { transaction: false }`).
- [ ] **Step 4: `importiereTurnierDaten`:** `live_token: gueltigesToken(daten.live?.token)` (String 10–200 Zeichen sonst `null`), `live_geheimnis: token ? crypto.randomBytes(32).toString('hex') : null`; `live_freigabe`/`live_ruecknahme` nicht setzen. `baueTurnierExport`: `live_token`, `live_geheimnis`, `live_ruecknahme` aus dem `turnier`-Objekt entfernen (neben `ausschreibung_pdf`). Prüfen, dass `TURNIER_SPALTEN_OHNE_PDF` (explizite Liste) die neuen Spalten nicht enthält und `GET /api/turniere/:id` keine Zeile mit `select *` liefert; sonst dort ausnehmen.
- [ ] **Step 5:** Test erneut laufen lassen → PASS; `npm run test:unit` bleibt grün.
- [ ] **Step 6: Commit** `feat: Spalten und Token-Import für den Teilnehmer-App-Schalter`

### Task 2: Cloud stellt das Token beim Holen aus

**Files:**
- Modify: `src/liveCloud/token.js`, `src/controllers/turnierController.js` (`exportTurnier`), `src/services/cloudZugriff.js` (`ladeExport`), `src/routes/cloudRoutes.js` (`/turniere/:id/holen`), `tests/helpers/fake-cloud.mjs`
- Test: `tests/unit/liveCloudToken.test.js` (erweitern), `tests/unit/cloudZugriff.test.js` (erweitern), `tests/e2e/export-live-token.spec.js`

**Interfaces:**
- Produces: `sperreTokenFuerTurnier(knex, turnierKey: string): Promise<number>` (Anzahl gesperrter aktiver Tokens mit diesem `turnier_key`); `GET /api/turniere/:id/export?liveToken=1` liefert zusätzlich `live: { token: string }`; `cloud.ladeExport(token, turnierId, { liveToken = false } = {})` hängt `?liveToken=1` an; Fake-Cloud liefert bei `liveToken=1` `live: { token: 'hjl_fake-live-token' }` (nicht für Turnier 11).

- [ ] **Step 1: Failing Tests.** Unit `sperreTokenFuerTurnier`: zwei Tokens für Key „7“, eines für „8“ → Aufruf mit „7“ gibt 2 zurück, `pruefeToken` für beide `null`, Token von „8“ gültig. Unit `cloudZugriff`: `ladeExport(..., { liveToken: true })` ruft `/api/turniere/5/export?liveToken=1` auf, ohne Option ohne Query. E2E `export-live-token.spec.js` (Testserver läuft mit `LIVE_API_AKTIV=true`): Turnier mit `status: 'veroeffentlicht'`; Export mit `?liveToken=1` → `live.token` beginnt mit `hjl_`; ein `POST /api/live/ingest` mit `Authorization: Bearer <token>` und Body `{}` antwortet nicht 401; zweiter Export mit `?liveToken=1` → neues, anderes Token, das alte liefert 401; Export **ohne** Parameter → kein `live`-Feld und das zuletzt ausgestellte Token bleibt gültig.
- [ ] **Step 2:** Tests laufen lassen → FAIL.
- [ ] **Step 3: Implementieren.** `sperreTokenFuerTurnier` in `token.js` (Update `gesperrt_am` wo `turnier_key` und `gesperrt_am` null). In `exportTurnier` nach Rechteprüfung, nur wenn `req.query.liveToken === '1'` und (`betriebsmodus.istCloud()` oder `process.env.LIVE_API_AKTIV === 'true'`): Schlüssel `String(turnier.urspruengliche_id ?? turnier.id)`, erst `sperreTokenFuerTurnier`, dann `erzeugeToken(knex, { name: \`Hallen-Server ${turnier.bezeichnung}\`, turnierKey })`, `exportData.live = { token }`. `ladeExport` und `/holen` (nicht die Helferplan-Route) reichen `{ liveToken: true }` durch. Fake-Cloud entsprechend.
- [ ] **Step 4:** Tests → PASS. **Step 5: Commit** `feat: Cloud stellt Live-Token beim Holen des Turniers aus`

### Task 3: Uplink kann Rücknahmen auf Zuruf senden

**Files:**
- Modify: `src/live/uplink.js` (`sende`)
- Test: `tests/unit/liveUplink.test.js` (erweitern)

**Interfaces:**
- Produces: `uplink.sende(snapshots, { zurueckzunehmen = [] } = {})` — für jeden Key in `zurueckzunehmen`, der nicht in den aktuellen Snapshots steht und in diesem Prozess noch nicht zurückgenommen wurde, ein Rücknahme-Paket (`{ version: 1, turnierKey, zurueckgezogen: true }`); nach Erfolg wird der Key gemerkt und aus `gesendet` entfernt; steht der Key später wieder in den Snapshots, wird er vergessen.

- [ ] **Step 1: Failing Tests** (Fake-`fetchFn` wie in den vorhandenen Tests): Rücknahme für „42“ wird genau einmal gesendet, auch bei zwei Aufrufen; Snapshot für „42“ danach → wieder Snapshot gesendet und erneute Rücknahme möglich; bei Fehler (500) wird die Rücknahme beim nächsten Aufruf nach dem Backoff wiederholt.
- [ ] **Step 2:** `node --test tests/unit/liveUplink.test.js` → FAIL. **Step 3:** In `sende` implementieren (Set `zurueckgenommen`). **Step 4:** PASS (alle bisherigen Tests unverändert grün). **Step 5: Commit** `feat: Uplink nimmt Turniere auf Zuruf zurück`

### Task 4: Reine Zustandslogik

**Files:**
- Create: `src/liveApp/zustand.js`
- Test: `tests/unit/liveAppZustand.test.js`

**Interfaces:**
- Produces:
  - `entscheideSender({ clusterAktiv: boolean, rolle: 'master'|'secondary', eigenErreichbar: boolean, partner: { rolle: string, cloud_erreichbar: boolean } | null }): 'eigener'|'partner'|'keiner'`
  - `berechneAnzeige({ verfuegbar, aktiv, cloudErreichbar, letzterErfolgMs: number|null, letzterFehler: string|null, jetztMs }): { zustand: 'grau'|'rot'|'gelb'|'gruen', text: string }`
  - Konstante `ERFOLG_MAX_ALTER_MS = 90000`.

- [ ] **Step 1: Failing Tests (Tabellen):** `entscheideSender` — ohne Cluster: erreichbar → `eigener`, sonst `keiner`; Secondary erreichbar → `eigener` (auch wenn der Partner erreichbar ist); Secondary nicht erreichbar, Master erreichbar → `partner`; Secondary nicht erreichbar, Partner unbekannt (`null`) → `keiner`; Master mit erreichbarem Secondary → `partner`; Master, Secondary nicht erreichbar oder `null`, Master erreichbar → `eigener`; beide nicht erreichbar → `keiner`. `berechneAnzeige` — nicht verfügbar oder nicht aktiv → grau mit Text „Teilnehmer-App ausgeschaltet“; aktiv, Cloud nicht erreichbar → rot; erreichbar mit `letzterFehler` → gelb; erreichbar, `letzterErfolgMs` null → gelb; erreichbar, Erfolg vor 91 s → gelb; Erfolg vor 4 s → grün mit Text „Teilnehmer-App läuft – letzter Abgleich vor 4 s“. Die anderen Texte stehen in den Global Constraints.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS. **Step 5: Commit** `feat: Zustandslogik für die Teilnehmer-App`

### Task 5: Dienst, Routen und Anbindung am Einzel-Server

**Files:**
- Create: `src/liveApp/liveAppDienst.js`, `src/routes/liveAppRoutes.js`
- Modify: `src/app.js` (nach Z. ~222 Dienst erzeugen, `app.set('liveApp', …)`, Route bei ~Z. 350 mounten), `tests/e2e/test-env.js` (Testserver-Env: `LIVE_APP_PRUEF_MS: '300'`, `LIVE_APP_TAKT_MS: '300'`), `tests/helpers/fake-cloud.mjs`
- Test: `tests/unit/liveAppDienst.test.js`, `tests/e2e/teilnehmer-app-schalter.spec.js`

**Interfaces:**
- Consumes: `entscheideSender`, `berechneAnzeige` (Task 4); `ladeSnapshots(knex, { geheimnis })`, `erzeugeUplink`, `uplink.sende(snapshots, { zurueckzunehmen })` (Task 3); `cloud.pruefeErreichbar()`, `liesCloudUrl()` aus `src/services/cloudZugriff.js`; Spalten aus Task 1.
- Produces:
  - `starteLiveAppDienst({ knex, cloud, holeCluster = () => null, env = process.env, jetzt = Date.now, erzeugeUplinkFn = erzeugeUplink, ladeSnapshotsFn = ladeSnapshots }): { status({ turnierId }): Promise<StatusAntwort>, schalte({ turnierId, aktiv }): Promise<StatusAntwort>, statusFuerPartner(): { cloud_erreichbar: boolean, sendet: boolean, letzter_erfolg: string|null, letzter_fehler: string|null }, stoppe(): void }`
  - `StatusAntwort = { verfuegbar, grund: null|'cloud_nicht_konfiguriert'|'kein_cloud_turnier'|'kein_token'|'turnier_abgeschlossen'|'kein_turnier', aktiv, zustand, text, poolsVerteilt, cloudErreichbar, sender: 'eigener'|'partner'|'keiner', senderKnoten: string|null, letzterErfolg: string|null, letzterFehler: string|null }`
  - HTTP: `GET /api/live-app/status?turnierId=` und `POST /api/live-app/schalter` mit `{ turnierId, aktiv: boolean }` (400 bei falschem Typ, 409 mit `grund` wenn nicht verfügbar); Mount unter `requireWriteAuth` nur im Einzelbenutzerbetrieb. Fake-Cloud: `POST /api/live/ingest` zählt Aufrufe und merkt Authorization und Body, Test-Endpunkte `GET /test/ingest` (Anzahl, letzter Bearer, letztes Paket), `POST /test/modus { ingest: 'ok'|'fehler', erreichbar: boolean }` (`/api/auth/mode` antwortet 503, wenn nicht erreichbar; Ingest 500 bei `fehler`; 401 bei Bearer ≠ `hjl_fake-live-token`).

- [ ] **Step 1: Failing Unit-Test `liveAppDienst`** (Fake-Cloud-Objekt, Fake-Uplink, Test-Datenbank über `tests/helpers/testPostgres.js`): `schalte aktiv:true` setzt `live_freigabe=true, live_ruecknahme=false`; `aktiv:false` setzt `live_freigabe=false, live_ruecknahme=true`; Einschalten ohne `urspruengliche_id` → Fehler `kein_cloud_turnier`, ohne Token → `kein_token`, abgeschlossenes Turnier → `turnier_abgeschlossen`; `poolsVerteilt` ist `true` nur, wenn ein Pool (nicht „Verspätet“) eine `kampfflaeche_id` hat; ein Tick sendet Snapshots mit dem Token/Geheimnis des Turniers an `<CLOUD_URL>/api/live/ingest`, wenn der Sender `eigener` ist, sonst nichts; `zurueckzunehmen` enthält `String(urspruengliche_id)` aller Turniere mit `live_ruecknahme=true`; Neustart (neue Dienstinstanz) mit `live_freigabe=true` sendet ohne weiteres Zutun.
- [ ] **Step 2: Failing E2E `teilnehmer-app-schalter.spec.js`** (Vorbild `turnier-aus-cloud-holen.spec.js`): Turnier 12 aus der Fake-Cloud holen (`/api/cloud/turniere`, `/holen`) → Status `verfuegbar: true`, `aktiv: false`, `zustand: 'grau'`, `poolsVerteilt: false`; Pool mit Matte per DB anlegen → `poolsVerteilt: true`; `POST /schalter {aktiv:true}` → innerhalb von 5 s Ingest-Aufruf mit Bearer `hjl_fake-live-token`, Status `grün`; `POST /test/modus {ingest:'fehler'}` → `gelb`; `{erreichbar:false}` → `rot`; wieder ok → `grün`; `aktiv:false` → Fake-Cloud erhält ein Paket mit `zurueckgezogen: true`, Status `grau`. Ein lokal angelegtes Turnier (ohne Cloud-Herkunft) liefert `grund: 'kein_cloud_turnier'`.
- [ ] **Step 3:** Beide FAIL. **Step 4: Dienst implementieren:** zwei Timer (Prüfung `LIVE_APP_PRUEF_MS`, Takt `LIVE_APP_TAKT_MS`), Timer `unref()`; Ziel-URL `liesCloudUrl(env) + '/api/live/ingest'` (nur https oder lokaler Host, wie `liesLiveKonfig`); ein Uplink je Token (neu erzeugt, wenn sich das Token ändert; Zustandsdatei `live-app-gesendet.json` im `SYNC_DATENVERZEICHNIS`, Standard `./data/dokumente`); Token/Geheimnis nur im Speicher und im Uplink, nie in `StatusAntwort`/Logs; `letzterFehler` ist eine kurze deutsche Meldung ohne Token. **Routen** und `app.js`-Anbindung (`holeCluster: () => app.get('cluster')`).
- [ ] **Step 5:** Unit- und E2E-Tests → PASS; `npx playwright test tests/e2e/live-freigabe.spec.js tests/e2e/turnier-aus-cloud-holen.spec.js` bleibt grün. **Step 6: Commit** `feat: Teilnehmer-App-Dienst und API am Hallen-Server`

### Task 6: Cluster-Anbindung

**Files:**
- Modify: `src/cluster/clusterDienst.js` (`starteClusterDienst`, `eigenerStatus` ~Z. 388, Rückgabeobjekt ~Z. 436), `src/app.js` (Aufruf Z. 221), `src/liveApp/liveAppDienst.js`
- Test: `tests/unit/liveAppDienst.test.js` (erweitern)

**Interfaces:**
- Produces: `starteClusterDienst({ …, holeLiveAppStatus = () => null })`; `eigenerStatus()` enthält `live_app: holeLiveAppStatus()`; Cluster-Objekt hat `partnerLetzter(): object|null` (Partnerstatus des letzten Prüfzyklus). Der Dienst nutzt `holeCluster()` mit `rolle()`, `knoten`, `partnerLetzter()`.

- [ ] **Step 1: Failing Unit-Tests** mit Fake-Cluster-Objekt: Secondary mit Internet sendet, Master (Partner meldet `live_app.cloud_erreichbar: true`, Rolle `secondary`) sendet nicht und zeigt `sender: 'partner'` und `senderKnoten` = Partnerknoten; Status am Master übernimmt `letzter_erfolg`/`letzter_fehler` des Partners für die Anzeige (gelb/grün); Rollenwechsel (Fake-Cluster liefert danach `master`) lässt genau einen Knoten senden; `statusFuerPartner()` meldet `sendet: true` nur beim sendenden Knoten.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren (Spätbindung in `app.js`: `holeLiveAppStatus: () => app.get('liveApp')?.statusFuerPartner() ?? null`). **Step 4:** PASS; `npm run test:unit` grün. **Step 5: Commit** `feat: Teilnehmer-App im Cluster (Sender-Wahl)`
- [ ] **Step 6 (Hinweis, nicht automatisierbar):** Das Zusammenspiel zweier echter Knoten ist nur durch diese Unit-Tests abgedeckt; Cluster-Suite `npm run test:e2e:cluster` zur Regression laufen lassen und im Abschlussbericht vermerken, dass der Sender-Wechsel nicht im Leitstand getestet wurde.

### Task 7: Kopfleisten-Icon und Dialog

**Files:**
- Create: `public/js/teilnehmerApp.js`
- Modify: `public/js/menu.js` (Markup bei Z. ~454 vor `hallenServerBtn`, Aufruf nach dem Aufbau des Menüs, `MENUE_AKTIVE_SEITEN` unberührt), `public/css/common.css` (nur Dialogstile mit Theme-Variablen)
- Test: `tests/e2e/teilnehmer-app-icon.spec.js`

**Interfaces:**
- Consumes: `GET /api/live-app/status?turnierId=`, `POST /api/live-app/schalter` (Task 5).
- Produces: `window.TeilnehmerApp = { init({ turnierId }), oeffneDialog({ einschalten = false } = {}), letzterStatus() }`; Button `#teilnehmerAppBtn` (Material-Icon `phone_iphone`, Farbe nach `zustand`, `title` = `text`); Dialog `#teilnehmerAppDialog`.

- [ ] **Step 1: Failing E2E:** Seite `matten.html?turnierId=<geholtes Turnier>` zeigt `#teilnehmerAppBtn`; Farbe (`getComputedStyle(...).color` des Icons) passt zu grau/grün/gelb/rot passend zum Fake-Cloud-Modus (Zustandsfolge wie in Task 5); Klick öffnet den Dialog mit den Texten aus den Global Constraints; Einschalten verlangt eine zweite Bestätigung („Einschalten“) nach dem Hinweis; Ausschalten schaltet sofort; in beiden Themes (`page.emulateMedia({ colorScheme })` bzw. Theme-Umschalter) unterscheidet sich die Textfarbe im Dialog von der Hintergrundfarbe (Kontrastverhältnis ≥ 4,5); Seiten ohne `turnierId` und Server ohne `CLOUD_URL` (Status `cloud_nicht_konfiguriert` bzw. 404) zeigen den Button nicht.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren: Abfrage alle 5 s (wie `holeClusterStatus`), Dialog mit Status, Grund-Klartext aus `grund` (z. B. `kein_cloud_turnier` → „Dieses Turnier wurde nicht aus der Cloud geholt, die Teilnehmer-App ist nicht verfügbar“), Button im Cluster-Fall mit Zeile „Sendet: <senderKnoten>“. **Step 4:** PASS. **Step 5: Commit** `feat: Teilnehmer-App-Icon und Dialog in der Kopfleiste`

### Task 8: Hinweiskasten auf der Mattenseite

**Files:**
- Modify: `public/matten.html` (Container `#teilnehmerAppHinweis` zwischen Titelzeile und `#mattenContainer`), `public/js/matten.js`, `public/css/matten.css`
- Test: `tests/e2e/teilnehmer-app-hinweis.spec.js`

**Interfaces:**
- Consumes: `window.TeilnehmerApp.oeffneDialog({ einschalten: true })`, `GET /api/live-app/status` (Task 5/7).

- [ ] **Step 1: Failing E2E:** Hinweis „Teilnehmer-App verfügbar“ erscheint nur bei `verfuegbar && !aktiv && cloudErreichbar && poolsVerteilt`; fehlt bei fehlender Matten-Verteilung, bei nicht erreichbarer Cloud und bei eingeschalteter Funktion; „Aktivieren“ öffnet den Dialog im Einschalt-Schritt; „Später“ blendet ihn aus und merkt es unter `localStorage['teilnehmerAppSpaeter:<turnierId>']` (nach Reload bleibt er weg, ein anderes Turnier ist unberührt); Text und Kasten sind in hellem und dunklem Theme lesbar.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren (Abfrage beim Laden und beim periodischen Aktualisieren von `matten.js`, Theme-Variablen). **Step 4:** PASS; vorhandene Matten-Specs (`npx playwright test tests/e2e/matten*.spec.js`) bleiben grün. **Step 5: Commit** `feat: Hinweis zur Teilnehmer-App auf der Mattenseite`

### Task 9: Dokumentation und Gesamtlauf

**Files:**
- Modify: `CLAUDE.md` (Eintrag „Live-Uplink für die Teilnehmer-App“ und „Domänenmodell/Seitenstruktur“: neuer Schalter, `LIVE_APP_PRUEF_MS`/`LIVE_APP_TAKT_MS`, Spalten, Routen `/api/live-app`; Korrektur: es gibt in der Oberfläche keinen Haken „Live freigeben“), `docs/live-uplink.md` (neuer Abschnitt „Teilnehmer-App am Hallen-Server“: Ablauf, Cluster-Regel, `hajime-live` nicht parallel betreiben)

- [ ] **Step 1:** Dokumentation ergänzen (kurz, im Stil der vorhandenen Einträge). **Step 2:** Gesamtlauf `npm run test:unit` und `npx playwright test` (volle Suite) → grün; `npm run test:e2e:cluster` laufen lassen. **Step 3: Commit** `docs: Teilnehmer-App-Schalter dokumentiert`

---

## Selbstprüfung

- Spec-Abdeckung: Haken entfällt (Global Constraints, Task 9) · Matten-Hinweis (Task 8) · Icon/Farben/Dialog (Task 7) · Token beim Holen (Task 2) · Import/Geheimhaltung (Task 1) · Uplink im Server-Prozess (Task 5) · Wiederaufnahme nach Neustart (Task 5 Unit-Test) · Rücknahme beim Ausschalten (Task 3/5) · Cluster-Regel (Task 4/6) · Dokumentation (Task 9).
- Bekannte Lücke: Sender-Wechsel mit zwei echten Knoten nur per Unit-Test abgedeckt (Task 6, Step 6).
