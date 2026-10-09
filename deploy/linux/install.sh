#!/usr/bin/env bash
# Hajime Pro – Ein-Befehl-Installation eines einzelnen Hallen-Servers (Debian 12/13, Ubuntu 22.04+).
#
#   git clone <repo-url> && cd Hajime-Pro && sudo bash deploy/linux/install.sh
#
# Installiert Node.js, PostgreSQL und alle Abhängigkeiten, legt Datenbank, Systembenutzer,
# .env (mit zufälligen Geheimnissen), systemd-Dienst und Firewall-Regeln an und startet die App.
# Danach startet alles beim Hochfahren automatisch. Das Skript ist wiederholbar: bei einem
# erneuten Lauf (Update) werden Code und Datenbankschema aktualisiert, .env und Daten bleiben.
#
# Die Dokument-DB für die Client-Geräte (PouchDB) ist in die App eingebaut — CouchDB wird NICHT
# benötigt. Für den Zwei-Server-Cluster (keepalived, Replikation) siehe deploy/linux/README.md.
#
# Optionale Umgebungsvariablen: INSTALL_DIR (/opt/hajime-pro), APP_PORT (3000), DB_NAME (hajime),
# MDNS_NAME (turnier), NODE_MAJOR (22), CLIENT_RELEASE_TOKEN.
#
# Client-Dateien (Windows/macOS/Linux/Android für /download): Der Server holt sie beim Start selbst aus dem
# GitHub-Release zur Version (src/sync/clientDateien.js). Ist das Repository privat, dafür einmal ein
# Token mit Leserecht mitgeben: sudo CLIENT_RELEASE_TOKEN=ghp_... bash deploy/linux/install.sh (steht dann in .env).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hajime-pro}"
APP_USER="hajime"
APP_PORT="${APP_PORT:-3000}"
DB_NAME="${DB_NAME:-hajime}"
DB_USER="hajime"
MDNS_NAME="${MDNS_NAME:-turnier}"
NODE_MAJOR="${NODE_MAJOR:-22}"
QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

log()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
fehler() { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
zufall() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-24}"; }

[ "$(id -u)" -eq 0 ] || fehler "Bitte als root ausführen: sudo bash $0"
command -v apt-get >/dev/null || fehler "Nur Debian/Ubuntu (apt) wird unterstützt."
[ -f "$QUELLE/package.json" ] && [ -f "$QUELLE/src/app.js" ] || fehler "Quellcode nicht gefunden (erwartet in $QUELLE)."
export DEBIAN_FRONTEND=noninteractive

# --- 1. Pakete ---------------------------------------------------------------------------------
log "Systempakete installieren"
apt-get update -qq
apt-get install -y -qq postgresql curl ca-certificates gnupg rsync openssl build-essential python3 alsa-utils >/dev/null

node_major() { command -v node >/dev/null && node -v | sed 's/^v\([0-9]*\).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ]; then
    log "Node.js $NODE_MAJOR installieren (NodeSource)"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v), npm $(npm -v)"

systemctl enable --now postgresql >/dev/null
# pg_isready abwarten, damit der erste psql-Aufruf nicht ins Leere läuft
for _ in $(seq 1 30); do pg_isready -q && break; sleep 1; done
pg_isready -q || fehler "PostgreSQL startet nicht."

# --- 2. Systembenutzer + Code ------------------------------------------------------------------
log "Anwendung nach $INSTALL_DIR kopieren"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'data' --exclude '.env' --exclude '.update' \
    --exclude 'dist-desktop' --exclude 'test-results' --exclude 'playwright-report' \
    "$QUELLE"/ "$INSTALL_DIR"/
mkdir -p "$INSTALL_DIR/data/dokumente" "$INSTALL_DIR/data/client-downloads"
chown -R "$APP_USER":"$APP_USER" "$INSTALL_DIR"

log "Node-Abhängigkeiten installieren (dauert einige Minuten)"
sudo -u "$APP_USER" -H bash -c "cd '$INSTALL_DIR' && npm ci --omit=dev --no-audit --no-fund"

# --- 3. .env (nur beim ersten Lauf) --------------------------------------------------------------
ENV_DATEI="$INSTALL_DIR/.env"
NEUE_INSTALLATION=0
if [ -f "$ENV_DATEI" ]; then
    log ".env existiert bereits – bleibt unverändert"
    DB_PASSWORD="$(grep '^DB_PASSWORD=' "$ENV_DATEI" | head -1 | cut -d= -f2-)"
    [ -n "$DB_PASSWORD" ] || fehler "DB_PASSWORD fehlt in $ENV_DATEI"
else
    log ".env mit zufälligen Geheimnissen anlegen"
    NEUE_INSTALLATION=1
    DB_PASSWORD="$(zufall 28)"
    ADMIN_PASSWORT="$(zufall 14)"
    STEUERUNG_PASSWORT="$(zufall 10)"
    cat > "$ENV_DATEI" <<EOF
# Erzeugt von deploy/linux/install.sh am $(date -Iseconds)
PORT=$APP_PORT
BETRIEBSMODUS=server
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
SYNC_DATENVERZEICHNIS=$INSTALL_DIR/data/dokumente
SYNC_SECRET=$(zufall 32)
CLIENT_DOWNLOADS_VERZEICHNIS=$INSTALL_DIR/data/client-downloads
JWT_SECRET=$(zufall 48)
STEUERUNG_PASSWORD=$STEUERUNG_PASSWORT
SUPER_ADMIN_INITIAL_PASSWORD=$ADMIN_PASSWORT
MDNS_NAME=$MDNS_NAME
${CLIENT_RELEASE_TOKEN:+CLIENT_RELEASE_TOKEN=$CLIENT_RELEASE_TOKEN}
EOF
    chown "$APP_USER":"$APP_USER" "$ENV_DATEI"
    chmod 600 "$ENV_DATEI"
fi

# --- 4. PostgreSQL: Benutzer + Datenbank ----------------------------------------------------------
log "PostgreSQL-Datenbank '$DB_NAME' einrichten"
psql_admin() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qtA "$@"; }
if [ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'")" = "1" ]; then
    psql_admin -c "ALTER ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'"
else
    psql_admin -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD'"
fi
if [ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" != "1" ]; then
    psql_admin -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
fi

# --- 5. Datenbankschema ----------------------------------------------------------------------------
log "Datenbank-Migrationen ausführen"
sudo -u "$APP_USER" -H bash -c "cd '$INSTALL_DIR' && npx knex migrate:latest --knexfile knexfile.cjs --env online"

# --- 6. systemd -----------------------------------------------------------------------------------
log "Dienst einrichten (Autostart beim Booten)"
install -m 644 "$QUELLE/deploy/linux/systemd/hajime-pro.service" /etc/systemd/system/hajime-pro.service
systemctl daemon-reload
systemctl enable hajime-pro >/dev/null
systemctl restart hajime-pro

# --- 7. Firewall (nur wenn ufw aktiv ist) -------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    log "Firewall-Regeln (ufw)"
    ufw allow "$APP_PORT"/tcp >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 5353/udp >/dev/null
fi

# --- 8. Prüfen ------------------------------------------------------------------------------------
log "Warte auf den Start der Anwendung"
OK=0
for _ in $(seq 1 60); do
    if curl -fs -m 2 "http://127.0.0.1:$APP_PORT/" -o /dev/null; then OK=1; break; fi
    sleep 1
done
if [ "$OK" -ne 1 ]; then
    journalctl -u hajime-pro -n 40 --no-pager || true
    fehler "Die App antwortet nicht. Log: journalctl -u hajime-pro -e"
fi

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
printf '\n\033[1;32m✔ Hajime Pro läuft und startet künftig automatisch beim Booten.\033[0m\n'
cat <<EOF

  Erreichbar unter:   http://${IP:-<server-ip>}:$APP_PORT
                      http://$MDNS_NAME.local   (mDNS, Port 80)
  Client-Download:    http://${IP:-<server-ip>}:$APP_PORT/download
  Konfiguration:      $ENV_DATEI  (enthält alle Passwörter, nur für root/$APP_USER lesbar)
  Logs / Status:      journalctl -u hajime-pro -f   |   systemctl status hajime-pro
  Update:             Repository aktualisieren (git pull), dann dieses Skript erneut ausführen
EOF
if [ "$NEUE_INSTALLATION" -eq 1 ]; then
    cat <<EOF

  Erst-Anmeldung (Super-Admin): siehe SUPER_ADMIN_INITIAL_PASSWORD in $ENV_DATEI
  Turnierleitungs-Passwort:     $STEUERUNG_PASSWORT
  (Wird nur beim ersten Lauf angezeigt – sonst in der .env nachlesen.)
EOF
fi
echo
echo "Tipp: dem Server im Router eine feste IP geben (DHCP-Reservierung)."
