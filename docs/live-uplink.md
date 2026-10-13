# Live-Uplink für die Teilnehmer-App (Slave)

Der Live-Prozess läuft **nur auf dem Slave** (Secondary). Er liest den PostgreSQL-Standby mit der Rolle `live_ro`
(nur Views im Schema `live`) und sendet freigegebene Turniere **ausgehend** per HTTPS an die Cloud. Es gibt keinen Rückkanal.
Entwurf: `docs/specs/2026-10-12-teilnehmer-app-design.md`.

## Netz
- Internet per **USB-Tethering** (Android) oder Starlink direkt am Slave; die Fritz!Box hat keinen Internetzugang.
- `net.ipv4.ip_forward=0`, damit der Slave nie als Router dient (setzt `install-live.sh`).
- Das Skript legt den Systembenutzer `hajime-live` an (ohne Zugriff auf die `.env` der App, die auf Modus 600 gesetzt wird),
  lädt die Firewall beim Systemstart (Include in `/etc/nftables.conf`, Dienst `nftables`) und speichert die zuletzt gesendeten
  Turniere unter `/var/lib/hajime-live/` (damit eine Rücknahme einen Neustart übersteht).
- **nftables:** auf der Internet-Schnittstelle ausgehend nur HTTPS zum Cloud-Host, DNS und NTP; eingehend alles verworfen
  (`deploy/linux/live/nftables-live.conf`).
- Automatische OS-Updates laufen über diese Schnittstelle nicht; Updates im Hallennetz oder in einem Wartungsfenster einspielen.

## Installation
1. Die Migration läuft mit dem normalen App-Start am Master und repliziert zum Slave (Schema `live`).
2. Am Slave: `sudo bash deploy/linux/install-live.sh --cloud-url https://<cloud>/api/live/ingest --cloud-ip <IP> --usb-if <Schnittstelle> --dns-ip <DNS-des-USB-Netzes>`.
   `--dns-ip` ist der DNS-Server des Tethering-/Starlink-Netzes (meist dessen Gateway), nicht der der Fritz!Box: die Firewall
   lässt über die Internet-Schnittstelle nur diesen DNS-Server zu.
   Das Skript legt `live.env` an und gibt den Befehl für Schritt 3 aus.
3. **Am Master** die Rolle anlegen (der Standby ist schreibgeschützt; die Rolle repliziert zum Slave):
   `DB_ADMIN_USER=postgres DB_ADMIN_PASSWORD=... LIVE_DB_PASSWORD=<aus live.env> npm run live:rolle`.
4. Den ausgegebenen `LIVE_UPLINK_TOKEN` in der Cloud hinterlegen.
5. Im Turnier die Checkbox „Live freigeben" setzen (nur Turniere aus der Cloud).

## Konfiguration (`/opt/hajime-pro/live.env`)
| Variable | Bedeutung |
|---|---|
| `LIVE_DB_HOST/PORT/NAME/USER/PASSWORD` | Verbindung zur Datenbank mit der Rolle `live_ro` |
| `LIVE_UPLINK_URL` | Ingest-Endpunkt der Cloud (https) |
| `LIVE_UPLINK_TOKEN` | Token, in der Cloud sperrbar |
| `LIVE_SCHLUESSEL` | Geheimnis für die Teilnehmerschlüssel (nicht ändern, sonst ändern sich alle Schlüssel) |
| `LIVE_INTERVALL_MS` | Abfrageintervall, Standard 5000, mindestens 1000 |

## Betrieb
- Status: `systemctl status hajime-live`, Log: `journalctl -u hajime-live -f`.
- Fällt der Slave aus, läuft das Turnier weiter; die Live-Anzeige friert ein und zeigt den Stand von zuletzt.
- Wird der Slave zum Master, liest der Prozess den Primary mit derselben Rolle weiter.

## Cloud-Seite (Phase 2)

Die Cloud (`BETRIEBSMODUS=cloud`) nimmt die Snapshots unter `POST /api/live/ingest` an und liefert die App-API unter
`/api/live/*` sowie die PWA „Hajime Live“ unter `/live/`. Voraussetzung: die Migration
`20261012110000_live_cloud_lesemodell` ist gelaufen (`DB_AUTO_MIGRATE=true` oder manuell, siehe CLAUDE.md).

**Token für den Slave erzeugen** (wird nur einmal angezeigt, in der Datenbank liegt nur der Hash):

    node scripts/live-token.mjs erzeugen --name "Halle Senden"
    # optional an ein Turnier binden: --turnier <urspruengliche_id>
    node scripts/live-token.mjs liste
    node scripts/live-token.mjs sperren <id>

Das Token gehört als `LIVE_UPLINK_TOKEN` in die `live.env` des Slaves, die URL ist `https://<cloud>/api/live/ingest`.

| Variable (Cloud) | Wirkung |
|---|---|
| `LIVE_AUFBEWAHRUNG_TAGE` | Löschfrist nach dem Turnierdatum, Standard 7 |
| `LIVE_PROXY_VERTRAUEN=true` | Absenderadresse für die Ratenbegrenzung aus `X-Forwarded-For` (nur hinter einem eigenen Proxy setzen) |
| `LIVE_PROXY_HOPS` | Anzahl vertrauenswürdiger Proxys in der Kette, vom Ende gezählt (Standard 1) |
| `LIVE_RATE_MAX` | Anfragen je Absender und Minute für die App-API, Standard 1200 (Mobilfunk und Hallen-WLAN bündeln viele Geräte hinter einer Adresse) |
| `LIVE_API_AKTIV=true` | schaltet die Routen außerhalb der Cloud ein (nur für Tests) |

Die App-API ist je Absender auf `LIVE_RATE_MAX` Anfragen/Minute begrenzt (Standard 1200), falsche Token am Ingest auf 30/Minute. Kommt ein veraltetes Paket an (die Cloud hat schon einen neueren Stand, z. B. wegen einer zurückgesprungenen Uhr des Slaves), antwortet der Ingest mit 409; der Uplink loggt das und sendet mit Backoff erneut. Fällt die Halle aus,
zeigt die App „Halle nicht verbunden“, sobald seit 3 Minuten kein Paket ankam. Die Geräte sind zustandslos: Sterne und
Glocken liegen im Browser, die Übersicht schickt die Schlüsselliste bei jeder Anfrage mit.

### Phase 2b: Pools, Kämpfe, Turnierbaum, Dashboard

Der Snapshot enthält zusätzlich die optionalen Felder `pools` (Einzel-Pools ohne Sammelpool „Verspätet“, mit Modus, Status,
Matte und Farbe von Kämpfer 2) und `kaempfe` (alle Einzelkämpfe dieser Pools mit Kampfnummer, Status, Paarung, Sieger und
Punkten); Voraussetzung am Hallen-Server ist die Migration `20261013100000_live_views_farbe`, in der Cloud
`20261013110000_live_cloud_pools_kaempfe`. Zusätzliche Endpunkte der App-API:

| Endpunkt | Inhalt |
|---|---|
| `GET /api/live/turniere/:key` | zusätzlich `klassen` (Altersklasse/Geschlecht mit ihren Pools) |
| `GET /api/live/turniere/:key/pools` | alle Pools mit Matte, Teilnehmerzahl und Fortschritt |
| `GET /api/live/turniere/:key/pools/:poolId` | zusätzlich `pool.modus`, `kaempfe` mit aufgelösten Kämpfern und Abstand |
| `GET /api/live/turniere/:key/dashboard` | Matten mit laufendem Kampf, nächsten drei Kämpfen, Pools; Warteschlange ohne Matte |

Ein älterer Live-Prozess ohne diese Felder funktioniert weiter: Suche und Übersicht laufen wie bisher, Pools, Turnier und
Baum zeigen „Noch keine Kampfdaten von der Halle“. Der Live-Prozess in der Halle muss für Pools und Kämpfe aktualisiert werden.

### Phase 3: Push-Nachrichten

Geräte, die in der App die Glocke gesetzt haben, bekommen eine Push-Nachricht 3 Kämpfe vor dem Pool-Start und 3 Kämpfe vor dem
Kampf des Gefolgten (auch „Glocke für alle“ eines Vereins, inklusive später gemeldeter Mitglieder). Es ist Standard-Web-Push
(VAPID): Android, Desktop und das iPhone (iOS ab 16.4, die App muss zum Home-Bildschirm hinzugefügt sein).

**Einrichtung in der Cloud** (ohne diese Variablen ist Push aus, die App arbeitet wie bisher):

```bash
node scripts/live-push-schluessel.mjs   # erzeugt das VAPID-Schlüsselpaar
```

| Variable | Bedeutung |
|---|---|
| `LIVE_PUSH_VAPID_PUBLIC` / `LIVE_PUSH_VAPID_PRIVATE` | Schlüsselpaar (der private Schlüssel nur in der Cloud-Umgebung) |
| `LIVE_PUSH_BETREFF` | Kontakt für die Push-Dienste, `mailto:…` oder `https://…` |
| `LIVE_PUSH_AUFBEWAHRUNG_TAGE` | Löschung der Anmeldungen nach dem Turnier-Datum, Standard 3 |
| `LIVE_PUSH_MAX_ABOS` | höchstens so viele Anmeldungen je Turnier, Standard 5000 |

Voraussetzung ist HTTPS. Die Migration `20261013120000_live_push` legt `live_push_abos`, `live_push_glocken` und
`live_push_gesendet` an. Gespeichert werden nur Push-Endpunkt und -Schlüssel des Geräts, die Turnier-Kennung und die
Glockenliste (keine Namen, keine IP). Die Anmeldungen werden 3 Tage nach dem Turnier-Datum, bei Abmeldung, bei Abmeldung
durch den Push-Dienst (404/410) und mit der Rücknahme des Turniers gelöscht; im Datenschutztext der App ergänzen.

Endpunkte: `GET /api/live/push/schluessel`, `PUT /api/live/turniere/:key/push`, `DELETE /api/live/turniere/:key/push`.
Die Cloud sendet nur an bekannte Push-Dienste (Google, Mozilla, Microsoft, Apple).

**Prüfliste am echten Gerät** (der Versand lässt sich nur so prüfen): Android Chrome, iPhone mit Home-Bildschirm-App,
Desktop-Browser: Glocke setzen, Berechtigung erteilen, in der Halle einen Kampf bis auf 3 Positionen vorrücken lassen,
Nachricht und Antippen (öffnet die Übersicht) prüfen, danach Glocke aus und prüfen, dass nichts mehr kommt.
