# Plan C – Server-Cluster (Master/Secondary mit automatischer Übernahme)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zwei identische Hallen-Server laufen als Master und Secondary. Fällt der Master aus oder
verliert er den Zeugen, übernimmt der Secondary automatisch, ohne dass bestätigte Daten verloren
gehen. Ein zurückkehrender alter Master stuft sich selbst zum Secondary zurück.

**Architecture:** keepalived (VRRP) entscheidet, wer die VIP hält, und ruft die App über
localhost-Endpunkte auf; die App führt die Folgen aus (PostgreSQL befördern, Epoche erhöhen,
Brücke/Abgleich starten, Schreibzugriffe annehmen). PostgreSQL repliziert per Streaming synchron
mit automatischem Rückfall auf asynchron, die Turnier-Dokument-DB repliziert zwischen den Servern
in beide Richtungen. Die Rollenlogik liegt DB- und prozessfrei in `src/cluster/rollenLogik.js`
(Unit-Tests), die Anbindung an PostgreSQL, Partner, Zeuge und Rückstufungs-Befehl ist injiziert.

**Tech Stack:** Node 24 ESM, Express 4, Knex/pg, PouchDB, keepalived (nur Linux-Betrieb),
`embedded-postgres` (nur Tests: PostgreSQL-Binaries für die Cluster-Suite).

**Spec:** `docs/superpowers/specs/2026-09-25-couchdb-umbau-design.md`, Abschnitt 9, 11, 12.

## Global Constraints

- Cluster nur mit `SYNC_ROLLE=server`, `IS_OFFLINE=true`, `DB_CLIENT=pg` und gesetztem `CLUSTER_KNOTEN`.
  Ohne `CLUSTER_KNOTEN` verhält sich der Server exakt wie nach Plan B (Einzelserver, immer Master).
- Neue `.env`: `CLUSTER_KNOTEN` (`server1`|`server2`), `CLUSTER_PARTNER_URL`, `CLUSTER_VIP` (nur Anzeige),
  `CLUSTER_ZEUGE` (IP → Ping, `http(s)://…` → HTTP-GET; Standard: Default-Gateway),
  `CLUSTER_RUECKSTUFEN_BEFEHL` (Standard `sudo -n /usr/local/bin/hajime-rueckstufen.sh`).
- Endpunkte für keepalived (`/api/cluster/gesund`, `/befoerdern`, `/zurueckstufen`) nur von localhost.
- Geplante Übergabe nur mit Turnierleitungs-Berechtigung (Steuerungs-Passwort, wie Scoreboard).
- Die Cluster-Suite muss unter Windows ohne Docker laufen (lokale PostgreSQL-Instanzen aus `embedded-postgres`).

## Abweichungen von der Spec (werden in der Spec nachgezogen)

1. **Kein replizierter `hajime_cluster`:** Jeder Server hält seinen Rollenzustand
   (`epoche`, `master`, `verlauf`) lokal in einer nicht replizierten PouchDB `hajime_cluster`.
   Die Epoche des Partners wird über `GET /api/cluster/status` abgefragt. Das vermeidet
   Replikationskonflikte auf dem Zustandsdokument selbst; die Cluster-Seite zeigt beide Verläufe.
2. **Rückstufung der App bei VIP-Verlust ohne sofortigen PostgreSQL-Umbau:** Verliert der Master die
   VIP (`/zurueckstufen`), stoppt er Brücke und Schreibzugriffe, baut seine PostgreSQL aber erst um,
   wenn der Partner tatsächlich mit höherer Epoche Master geworden ist. So bleibt der bisherige Master
   nach einem kurzen Router-Ausfall ohne Partner weiterhin übernahmefähig.
3. **Cluster-Suite ohne Docker:** Ein Leitstand-Prozess (`tests/e2e-cluster/leitstand.js`) startet zwei
   PostgreSQL-Instanzen, zwei Server und einen Client, simuliert keepalived (Gesundheit abfragen,
   `nopreempt`, VIP-Wechsel), leitet die VIP per HTTP-Proxy weiter und simuliert den Zeugen per HTTP.
   Echtes VRRP und `pg_rewind` werden per Checkliste in `deploy/linux/README.md` abgenommen.

---

### Task C1: Cluster-Konfiguration und Rollenlogik (rein, Unit-Tests)

**Files:** Create `src/cluster/konfig.js`, `src/cluster/rollenLogik.js`, `tests/unit/cluster-rollenLogik.test.js`

**Interfaces:**
- `liesClusterKonfig(env)` → `{ aktiv, knoten, partnerKnoten, partnerUrl, vip, zeuge, rueckstufenBefehl }`
- `entscheideStart({ knoten, eigenerZustand, partner, pgRolle })` → `{ zustand, aktion: 'keine'|'rueckstufen' }`
- `entscheideBefoerderung({ knoten, eigenerZustand, partner, pgRolle, grund, jetzt })` →
  `{ zustand, pgPromote: bool, epocheErhoeht: bool }` oder wirft, wenn Rückstufung erforderlich
- `pruefePartner({ knoten, eigenerZustand, partner })` → `'ok' | 'rueckstufen'` (höhere Epoche,
  bei Gleichstand gewinnt der Knoten, der laut Zustand zuerst Master war; letzter Ausweg `server1`)
- Zustand: `{ epoche, master, geaendert_am, grund, rueckstufung_erforderlich }`

- [ ] Tests für: Erststart server1 (Epoche 1, `grund: 'erststart'`), Erststart server2 (Secondary),
  Partner mit höherer Epoche → rückstufen, Beförderung aus Standby erhöht Epoche und fordert
  `pg_promote`, erneute Beförderung des bisherigen Masters (PG Primary, keine höhere Partner-Epoche)
  ohne Epochen-Sprung, Beförderung mit `rueckstufung_erforderlich` verweigert, Gleichstand-Regel.
- [ ] Implementieren, `npm run test:unit` grün.

### Task C2: Cluster-Dienst im Server (Rollen, Gesundheit, Endpunkte, nurMaster)

**Files:** Create `src/cluster/clusterDienst.js`, `src/cluster/pgReplikation.js`, `src/cluster/zeuge.js`,
`src/routes/clusterRoutes.js`, `src/middleware/nurMaster.js`; Modify `src/app.js`, `src/sync/syncDienst.js`

- `pgReplikation(knex, { partnerKnoten })`: `rolle()` (`pg_is_in_recovery`), `befoerdere()` (`pg_promote(true, 60)`),
  `status()` (`pg_stat_replication` + aktuelles `synchronous_standby_names`), `setzeSynchron(bool)`
  (`ALTER SYSTEM` + `pg_reload_conf()`), Wächter alle 2 s: Standby >5 s nicht `streaming` → asynchron,
  wieder `streaming` → synchron (nur auf dem Master).
- `zeuge.erreichbar()`: HTTP-GET (Timeout 1 s) oder `ping` (Windows `-n 1 -w 1000`, sonst `-c 1 -W 1`).
- `clusterDienst`: Start im Secondary-Modus → `entscheideStart`; Partner-Schleife alle 2 s
  (`pruefePartner` → ggf. `rueckstufen`: Brücke aus, `CLUSTER_RUECKSTUFEN_BEFEHL` ausführen, danach
  Zustand übernehmen, Flag löschen); `gesund()` = PG erreichbar ∧ Zeuge ∧ ¬Rückstufung ∧ ¬Übergabe;
  `befoerdern(grund)`; `zurueckstufen()`; `status()` (eigene Daten + Partner abgefragt).
- Sync-Dienst bekommt `alsMaster()` / `alsSecondary()`: Master = Abgleich + Brücke + Instanz schreiben;
  Secondary = nur Dokument-DB öffnen (Instanz aus der Standby-DB lesen, alle 2 s auf Instanzwechsel
  prüfen), keine Brücke, kein Abgleich. Beide: Pull-Replikation vom Partner (`/db/<name>`, Secret, live, retry).
- `nurMaster`: auf dem Secondary alle nicht-GET `/api`-Anfragen außer `/api/cluster/*` und `/api/auth/*`
  mit 409 `{ error: 'Secondary – nur lesend' }`; Browser-Schreibzugriffe auf `/db` ebenfalls 409.
- Routen: `GET /api/cluster/status`, `GET /api/cluster/gesund` (200/503, localhost),
  `POST /api/cluster/befoerdern` und `/zurueckstufen` (localhost), `POST /api/cluster/uebergeben`
  (Steuerungs-Passwort; Partner gesund und synchron; Brücke stoppen, Leerlauf, Übergabe-Flag → ungesund,
  Partner per `POST /api/cluster/uebergabe-ankuendigen` informieren, damit er `grund: 'uebergabe'` einträgt).
- Abgleich schreibt `epoche` in Server-Dokumente; Konfliktauflösung wählt unter reinen
  Server-Revisionen die höhere `epoche`.

### Task C3: Cluster-Suite (Leitstand + Tests)

**Files:** Create `tests/e2e-cluster/{pgInstanz.js,leitstand.js,rueckstufen.js,test-env.js,helpers.js,cluster.spec.js}`,
`playwright.cluster.config.js`; Modify `package.json` (`test:e2e:cluster`, devDependency `embedded-postgres`)

- `pgInstanz.js`: `initdb`/`pg_ctl` aus `@embedded-postgres/<plattform>`, Standby-Aufbau per
  `pg_backup_start` + Dateikopie + `pg_backup_stop` (ersetzt `pg_basebackup`/`pg_rewind` im Test).
- `leitstand.js` (webServer der Suite, Steuer-API auf Port 3309): PG1 (5511) initialisieren, migrieren,
  PG2 (5512) als Standby; Server1 (3311), Server2 (3312), Client (3313, `SYNC_SERVER_URL` = VIP-Proxy 3310);
  keepalived-Simulation alle 500 ms (VIP bei gesundem Halter behalten, sonst nach 3 s an den gesunden
  Partner: `zurueckstufen` beim alten, `befoerdern` beim neuen; `nopreempt`); Zeuge `GET /zeuge/:knoten`;
  Steuerung `POST /knoten/:k/stoppen|starten`, `POST /zeuge/:k/trennen|verbinden`, `GET /status`.
- `rueckstufen.js <knoten>`: eigene PG stoppen, Datenverzeichnis vom Partner neu aufbauen, als Standby starten.
- Tests (seriell, Spec Abschnitt 12):
  1. REST-Änderung am Master → sofort im Standby lesbar, Replikation `sync`.
  2. Master stoppen → Server 2 übernimmt innerhalb 15 s, alle bestätigten Daten vorhanden, Client
     repliziert über die VIP weiter, ein während der Übernahme offline erfasstes Ergebnis kommt an.
  3. Alter Master startet neu → stuft sich zurück, wird synchroner Standby, VIP bleibt.
  4. Master vom Zeugen trennen → ungesund, VIP wandert, Rückstufung nach Wiederverbindung.
  5. Standby stoppen → Master asynchron („ohne Absicherung“), Standby zurück → synchron.
  6. Geplante Übergabe → Rollen getauscht, keine Daten verloren, Secondary lehnt Schreibzugriffe ab.

### Task C4: Cluster-Seite und Secondary-Hinweis im Frontend

**Files:** Create `public/cluster.html`, `public/js/cluster.js`; Modify `public/js/menu.js`
- Status beider Server (erreichbar, gesund + Grund, Rolle, Epoche, PG-Rolle, Absicherung, Rückstand),
  Verlauf, Client-Liste (Heartbeat-Dokumente), Übergabe-Knopf (nur Master). Menüpunkt nur, wenn
  `/api/cluster/status` `aktiv: true` liefert; Banner „Secondary – nur lesend“ auf dem Secondary.
- Playwright-Test in der Cluster-Suite: Cluster-Seite zeigt beide Server, Übergabe per Knopf.

### Task C5: Betrieb `deploy/linux/` und Doku

**Files:** Create `deploy/linux/README.md`, `deploy/linux/postgresql/{primary.conf,standby.conf,pg_hba.conf.ausschnitt}`,
`deploy/linux/keepalived/{keepalived.conf.vorlage,hajime-befoerdern.sh,hajime-zurueckstufen.sh}`,
`deploy/linux/hajime-rueckstufen.sh`, `deploy/linux/systemd/hajime-pro.service`, `deploy/linux/sudoers.hajime`;
Modify `CLAUDE.md`, Spec (Abweichungen oben).

- [ ] Commit nach jedem Task; Haupt-, Sync- und Unit-Suite bleiben grün.
