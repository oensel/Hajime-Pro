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
