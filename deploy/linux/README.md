# Hajime Pro – Server-Cluster in der Halle

Zwei identische Linux-Server (Debian 12/13) laufen als **Master** und **Secondary**. Fällt der
Master aus oder verliert er die Verbindung zum Hallen-Router, übernimmt der Secondary
**automatisch** innerhalb weniger Sekunden – ohne Verlust bestätigter Daten. Die Clients (Waage,
Scoreboard, Mattenleitung) arbeiten in der Zeit offline weiter und synchronisieren danach über
dieselbe virtuelle IP (VIP) mit dem neuen Master.

Hintergrund und Entscheidungen: `docs/specs/2026-09-25-couchdb-umbau-design.md`, Abschnitt 9.

## Schnellstart: einzelner Hallen-Server (ein Befehl)

Frisches Debian 12/13 oder Ubuntu 22.04+ ohne Desktop, Internetzugang für die Installation:

```bash
git clone <repo-url> Hajime-Pro && cd Hajime-Pro && sudo bash deploy/linux/install.sh
```

`install.sh` installiert Node.js 22 und PostgreSQL, legt Systembenutzer `hajime`, Datenbank,
`/opt/hajime-pro/.env` (mit zufälligen Passwörtern/Geheimnissen), Migrationen, systemd-Dienst
(Autostart) und ufw-Regeln an und zeigt am Ende Adresse und Passwörter an. Erneutes Ausführen
nach `git pull` = Update (`.env` und Daten bleiben). CouchDB ist nicht nötig: die Dokument-DB
für die Client-Geräte ist in die App eingebaut. Den Zwei-Server-Cluster richtet das nächste Skript ein.

## Schnellstart: Zwei-Server-Cluster (geführt)

Beide Server: Debian 12/13 oder Ubuntu 24.04+ ohne Desktop, feste IPs, eine freie VIP im selben Netz.

```bash
# server1 (legt alle Geheimnisse an -> /root/hajime-cluster-geheimnisse.env)
sudo bash deploy/linux/install-cluster.sh --knoten server1 --eigene-ip 192.168.10.11 --partner-ip 192.168.10.12 --vip 192.168.10.10
scp /root/hajime-cluster-geheimnisse.env root@192.168.10.12:/root/
# server2 (baut PostgreSQL als Standby von server1 auf; server1 muss fertig sein)
sudo bash deploy/linux/install-cluster.sh --knoten server2 --eigene-ip 192.168.10.12 --partner-ip 192.168.10.11 --vip 192.168.10.10
hajime-cluster-status   # Zustand jederzeit (Rolle, Replikation, VIP, Partner)
```

Das Skript richtet Node.js, PostgreSQL-Replikation, Rollen, `pg_hba`, `.env`, systemd, Rückstufungs-Skript,
keepalived und ufw ein (alle Optionen: `--help`); eine vorhandene Einzelserver-Installation wird zum server1.
Wiederholbar (Update). Die Abschnitte unten beschreiben, was es einrichtet, und die Abnahme in der Halle.
Test: `tests/unit/install-cluster.test.js` (erzeugte Konfiguration), CI-Job `cluster-installation`
(`scripts/test-cluster-install-docker.sh`: zwei systemd-Container, Replikation und Failover).

## Netzplan

```
                    Hallen-Router (192.168.10.1)  ← Zeuge
         ┌──────────────┼───────────────┬──────────── WLAN: Clients
   LAN-Port 1       LAN-Port 2
   server1          server2
   192.168.10.11    192.168.10.12
          └── VIP 192.168.10.10 (hält immer der Master) ──┘
```

- Beide Server hängen an je einem LAN-Port des Hallen-Routers, feste IPs außerhalb des DHCP-Bereichs.
- Die VIP ist eine weitere freie Adresse; **alle Clients** tragen sie ein:
  `SYNC_SERVER_URL=http://192.168.10.10:3000`.
- Das volle Frontend (Turnierleitung, Cluster-Seite) öffnet man über `http://192.168.10.10:3000`.
  Über die feste IP des Secondary ist die Turnieransicht nur lesbar (Hinweis oben auf der Seite).

## 1. Installation (auf beiden Servern)

```bash
apt install postgresql keepalived curl nodejs npm rsync
useradd --system --create-home --home-dir /opt/hajime-pro hajime
# Anwendung nach /opt/hajime-pro kopieren, dann:
cd /opt/hajime-pro && sudo -u hajime npm ci --omit=dev
```

## 2. PostgreSQL

1. `postgresql/hajime-cluster.conf` nach `/etc/postgresql/<version>/main/conf.d/` kopieren,
   `postgresql/pg_hba.conf.ausschnitt` in `pg_hba.conf` übernehmen (IPs anpassen).
2. **Nur server1:** `systemctl restart postgresql`, dann `sudo -u postgres psql -f postgresql/rechte.sql`
   (Passwörter anpassen) und die Migrationen ausführen:
   `cd /opt/hajime-pro && sudo -u hajime npx knex migrate:latest --env online`.
3. **Nur server2:** als Standby von server1 aufbauen:
   ```bash
   systemctl stop postgresql
   rm -rf /var/lib/postgresql/<version>/main
   sudo -u postgres pg_basebackup -h 192.168.10.11 -U replikator -D /var/lib/postgresql/<version>/main -X stream -R -P
   echo "primary_conninfo = 'host=192.168.10.11 user=replikator application_name=server2'" | sudo -u postgres tee -a /var/lib/postgresql/<version>/main/postgresql.auto.conf
   systemctl start postgresql
   ```
4. Auf beiden Servern `~postgres/.pgpass` mit dem Passwort von `replikator` für den jeweiligen
   Partner anlegen (Rechte 0600), z. B. `192.168.10.12:5432:*:replikator:<passwort>`.

Die App schaltet die Replikation selbst auf **synchron** (`synchronous_standby_names` = Partner),
sobald der Standby streamt, und nach 5 s ohne Standby auf **asynchron** („ohne Absicherung“).

## 3. Anwendung (`/opt/hajime-pro/.env`)

`BETRIEBSMODUS=server` ersetzt die früheren Variablen `IS_OFFLINE=true`, `DB_CLIENT=pg` und `SYNC_ROLLE=server` (PostgreSQL ist im Modus `server` Standard). Bestehende `.env`-Dateien mit den alten Variablen laufen unverändert weiter.

| Variable | server1 | server2 |
|---|---|---|
| `BETRIEBSMODUS` | `server` | `server` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | `127.0.0.1` / `5432` / `hajime` | gleich |
| `DB_USER` / `DB_PASSWORD` | `hajime` / … | gleich |
| `SYNC_SECRET` | **Pflicht im Cluster (auf beiden Servern gleich)** — gemeinsames Geheimnis, auch für die Desktop-Clients; fehlt es, startet der Server nicht | gleich |
| `SYNC_DATENVERZEICHNIS` | `/opt/hajime-pro/data/dokumente` | gleich |
| `CLUSTER_KNOTEN` | `server1` | `server2` |
| `CLUSTER_PARTNER_URL` | `http://192.168.10.12:3000` | `http://192.168.10.11:3000` |
| `CLUSTER_VIP` | `192.168.10.10` (nur Anzeige) | gleich |
| `CLUSTER_ZEUGE` | leer = Default-Gateway, sonst IP des Routers | gleich |
| `STEUERUNG_PASSWORD` | Turnierleitungs-Passwort (auch für die geplante Übergabe) | gleich |

```bash
cp systemd/hajime-pro.service /etc/systemd/system/ && systemctl enable --now hajime-pro
cp hajime-rueckstufen.sh /usr/local/bin/ && chmod 755 /usr/local/bin/hajime-rueckstufen.sh
cp sudoers.hajime /etc/sudoers.d/hajime && chmod 440 /etc/sudoers.d/hajime && visudo -cf /etc/sudoers.d/hajime
```

`/etc/hajime/cluster.env` für das Rückstufungs-Skript:

```bash
CLUSTER_KNOTEN=server1          # bzw. server2
PARTNER_PG_HOST=192.168.10.12   # bzw. 192.168.10.11
PG_VERSION=17
REPL_USER=replikator
```

## 4. keepalived

```bash
cp keepalived/hajime-befoerdern.sh keepalived/hajime-zurueckstufen.sh /usr/local/bin/
chmod 755 /usr/local/bin/hajime-*.sh
cp keepalived/keepalived.conf.vorlage /etc/keepalived/keepalived.conf   # Werte "ANPASSEN" ändern
systemctl enable --now keepalived
```

server1 bekommt `priority 150`, server2 `priority 100`. Beide laufen mit `nopreempt`: ein
zurückkehrender Server nimmt dem gesunden Master die VIP nicht weg. Zurückwechseln nur über die
geplante Übergabe.

## Erreichbarkeit als turnier.local

Der Hallen-Server kündigt sich per mDNS als `turnier.local` (Dienst `_hajime._tcp`) an, damit
Desktop-Clients und Helfer ihn ohne feste IP finden (`MDNS_NAME`/`MDNS_AKTIV` in der `.env`, siehe
`src/sync/ankuendigung.js`). Dafür müssen zwei Dinge freigegeben sein:

- **mDNS (UDP 5353):** `sudo ufw allow 5353/udp` — sonst lösen Windows/macOS/Linux-Clients
  `turnier.local` nicht auf.
- **Port 80 (Weiterleitung auf den eigentlichen Port):** läuft über `AmbientCapabilities=CAP_NET_BIND_SERVICE`
  in der systemd-Unit (`deploy/linux/systemd/hajime-pro.service`) — ohne diese Capability kann der
  Node-Prozess als `hajime`-User keinen Port unter 1024 öffnen. Ist Port 80 belegt oder die
  Capability fehlt, loggt `src/sync/port80.js` das nur und die App bleibt unter `:PORT` erreichbar.

Test: `http://turnier.local/download` öffnet ohne Portangabe die Download-Seite.

**Client-Dateien (Windows, macOS, Linux, Android):** Der Server holt sie beim Start selbst aus dem GitHub-Release
zur eigenen Version (`src/sync/clientDateien.js`, Prüfung der Signatur, Wiederholung alle 15 Minuten) — dafür braucht
er Internet. Ist das Repository privat, einmal ein Token mit Leserecht auf Releases mitgeben:
`sudo CLIENT_RELEASE_TOKEN=ghp_… bash deploy/linux/install.sh` (bzw. `install-cluster.sh`; steht danach in der `.env`).
Bis die Dateien da sind, zeigt `/download` den Stand an; `curl http://localhost:3000/api/client/version` liefert
bis dahin 404 samt `status`. Das fertige Server-Paket (Notebook) braucht das nicht: es bringt die Dateien mit.

## Abläufe

**Automatische Übernahme:** Der Master fällt aus oder meldet sich ungesund (PostgreSQL weg, Router
nicht erreichbar). Nach ca. 3 s übernimmt keepalived auf dem Secondary die VIP und ruft
`hajime-befoerdern.sh` → die App führt `pg_promote()` aus, erhöht die Epoche, startet Brücke und
Abgleich und holt alle Client-Änderungen nach, die der alte Master noch nicht verarbeitet hatte.

**Rückkehr des alten Masters:** Er startet als Secondary, sieht beim Partner die höhere Epoche,
meldet sich ungesund („Rückstufung erforderlich“) und ruft `hajime-rueckstufen.sh` auf
(`pg_rewind`, notfalls `pg_basebackup`). Danach ist er gesunder, synchroner Standby.

**Geplante Übergabe (Wartung):** Cluster-Seite des Masters → „Rolle an server2 übergeben“ (nur
wenn der Partner gesund und synchron ist). Schreibzugriffe sind wenige Sekunden gesperrt; der
Master gibt die VIP ab, der Partner wird befördert (`grund: uebergabe`), der alte Master wird
Standby.

**Router fällt aus:** Kein Server ist gesund, alle Clients arbeiten offline. Kommt der Router
zurück, bleibt der bisherige Master Master (höchste Epoche).

## Abnahme-Checkliste (Aufbau in der Halle)

- [ ] Beide Server erreichbar, `http://<vip>:3000/cluster.html` zeigt server1 Master, server2
      Secondary, Replikation „synchron“, Dokument-Replikation „aktuell“.
- [ ] Ein Client (`SYNC_SERVER_URL=http://<vip>:3000`) meldet „verbunden“ und erscheint in der
      Client-Liste der Cluster-Seite mit seiner Matte.
- [ ] Teilnehmer an der Waage wiegen → am Master sichtbar; `http://192.168.10.12:3000` zeigt ihn
      (nur lesend, Hinweis „Secondary“).
- [ ] **Netzkabel von server1 ziehen** → innerhalb von ca. 10 s ist server2 Master (Cluster-Seite
      über die VIP), der Client arbeitet weiter und synchronisiert, ein am Client erfasstes
      Ergebnis ist danach am Master.
- [ ] Kabel wieder stecken → server1 stuft sich zurück (Verlauf: „Zurückgestuft“), Replikation
      wieder synchron, VIP bleibt bei server2.
- [ ] Stromstecker von server2 (jetzt Master) ziehen → server1 übernimmt.
- [ ] server2 wieder einschalten → Standby, synchron.
- [ ] Standby ausschalten → Master zeigt „asynchron – ohne Absicherung“, Arbeiten geht weiter;
      einschalten → wieder synchron.
- [ ] Geplante Übergabe per Knopf → Rollen getauscht, keine Daten verloren.

## Automatisierte Tests

`npm run test:e2e:cluster` spielt diese Abläufe auf einem Entwicklungsrechner durch (auch unter
Windows, ohne Docker): zwei lokale PostgreSQL-Instanzen aus dem Paket `embedded-postgres`, zwei
Server, ein Client; keepalived, VIP und Zeuge simuliert `tests/e2e-cluster/leitstand.js`. Echtes
VRRP, `pg_rewind` und die Skripte hier werden über die Checkliste oben abgenommen.
