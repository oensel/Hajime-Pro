# Cloud-Server ausrollen (Docker, netcup)

Am Ende jedes Releases (`release.yml`, Job `cloud-ausrollen`) spielt die Pipeline den getesteten Commit auf den Cloud-Server. Der Server liegt in `/opt/hajime-pro` (Docker Compose, **kein Git-Checkout**); nur dort vorhanden sind `.env.cloud`, `.env.db`, `docker-compose.prod.yml`, `Caddyfile` und `.commit`.

## Ablauf

1. Die Pipeline packt den Commit (`git archive`) und streamt ihn per SSH an den Server: `ssh root@<Server> <Commit-Hash> < quellstand.tgz`.
2. Der Deploy-Schlüssel darf auf dem Server **nur** `/usr/local/sbin/hajime-annahme` ausführen (erzwungener Befehl, `annahme.sh`). Die Annahme prüft den Hash, entpackt das Archiv nach `/root/deploy/<Commit>` und startet `aufspielen.sh` daraus.
3. `aufspielen.sh`: Datenbank sichern (`/root/sicherung/hajime-vor-deploy-*.dump`, die letzten 10 bleiben) → neuen Stand an die Stelle von `/opt/hajime-pro` setzen (der alte bleibt als `/opt/hajime-pro.alt`, die Dateien nur dieses Servers ziehen um) → `docker compose build app` und `up -d app` → auf `healthy` und eine Antwort von `/api/config` warten → `.commit` schreiben.
4. Schlägt ein Schritt nach dem Tausch fehl, kommen Ordner und Image (`hajime-pro-app:vorher`) zurück und der Lauf endet rot. **Datenbank-Migrationen** laufen beim Start der App und sind nicht umkehrbar: war der neue Stand schon migriert, die Sicherung von Hand zurückspielen (`pg_restore`).
5. Zum Schluss prüft der Job die öffentliche Adresse (`vars.CLOUD_URL`).

Der Release ist zu diesem Zeitpunkt schon veröffentlicht; ein roter Ausroll-Job macht ihn nicht rückgängig. Er läuft nur, wenn die Variable `CLOUD_SSH_HOST` gesetzt ist.

## Einmalige Einrichtung

**Auf dem Server (als root):**

```bash
install -m 755 deploy/cloud/annahme.sh /usr/local/sbin/hajime-annahme
mkdir -p /root/deploy /root/sicherung
# Öffentlichen Schlüssel des Deploy-Paares eintragen (ein erzwungener Befehl, sonst nichts erlaubt):
echo 'command="/usr/local/sbin/hajime-annahme",restrict ssh-ed25519 AAAA… github-deploy' >> /root/.ssh/authorized_keys
```

Die Annahme ändert sich praktisch nie; `aufspielen.sh` kommt bei jedem Lauf aus dem Archiv und ist damit immer so aktuell wie der Release.

**In GitHub (Settings → Secrets and variables → Actions):**

| Name | Art | Inhalt |
|---|---|---|
| `CLOUD_DEPLOY_SCHLUESSEL` | Secret | privater Schlüssel des Deploy-Paares (OpenSSH-Format) |
| `CLOUD_SSH_HOST` | Variable | IP oder Name des Servers |
| `CLOUD_SSH_KNOWN_HOSTS` | Variable | `known_hosts`-Zeile des Servers (`ssh-keyscan -t ed25519 <Host>`), prüft die Identität des Servers |
| `CLOUD_URL` | Variable | öffentliche Adresse für die Abschlussprüfung (gibt es schon) |

Schlüsselpaar anlegen: `ssh-keygen -t ed25519 -N "" -C github-deploy -f cloud-deploy`. Den privaten Schlüssel nur als Secret ablegen und die Datei danach löschen.

## Von Hand ausrollen (Notfall)

Ohne GitHub: Archiv packen, mit dem eigenen Schlüssel an die Annahme schicken. Als Administrator mit vollem Zugang geht auch direkt `bash aufspielen.sh <Commit> <entpacktes Verzeichnis>`.
