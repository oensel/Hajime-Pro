#!/usr/bin/env bash
# Hajime Pro – geführte Einrichtung des Zwei-Server-Clusters (siehe deploy/linux/README.md).
#
# Wird auf JEDEM der beiden Server ausgeführt (Debian 12/13 oder Ubuntu 24.04+, PostgreSQL >= 15, ohne Desktop):
#
#   1. server1:  sudo bash deploy/linux/install-cluster.sh --knoten server1 \
#                    --eigene-ip 192.168.10.11 --partner-ip 192.168.10.12 --vip 192.168.10.10
#      -> legt alle Geheimnisse an und schreibt sie nach /root/hajime-cluster-geheimnisse.env
#   2. Datei auf server2 kopieren:  scp /root/hajime-cluster-geheimnisse.env root@192.168.10.12:/root/
#   3. server2:  sudo bash deploy/linux/install-cluster.sh --knoten server2 \
#                    --eigene-ip 192.168.10.12 --partner-ip 192.168.10.11 --vip 192.168.10.10
#      -> baut PostgreSQL als Standby von server1 auf (server1 muss vorher fertig sein)
#
# Das Skript installiert Node.js, PostgreSQL (Replikation) und keepalived, richtet Rollen, pg_hba, .pgpass,
# /opt/hajime-pro/.env, systemd-Dienst, das Rückstufungs-Skript samt sudoers-Regel, keepalived und die Firewall ein
# und prüft am Ende den Zustand. Eine vorhandene Einzelserver-Installation (install.sh) wird mit Daten und
# Passwörtern zum server1 des Clusters. Wiederholbar: ein erneuter Lauf aktualisiert Code und Datenbankschema
# (Schema nur auf dem Server, dessen PostgreSQL gerade Master ist) und lädt geänderte Konfiguration nur NEU, statt
# PostgreSQL oder keepalived neu zu starten — ein laufender Cluster fällt dabei nicht um.
#
# Optionen:
#   --knoten server1|server2        (Pflicht) dieser Server
#   --eigene-ip IP                  (Pflicht) feste IP dieses Servers im Hallennetz
#   --partner-ip IP                 (Pflicht) feste IP des anderen Servers
#   --vip IP                        (Pflicht) virtuelle IP, die immer der Master hält (Clients: SYNC_SERVER_URL=http://<vip>:3000)
#   --zeuge IP|URL                  Gegenstelle gegen Split-Brain (Hallen-Router); leer = Default-Gateway
#   --schnittstelle NAME            Netzwerkschnittstelle zum Router (Standard: die mit --eigene-ip)
#   --vrrp-id N                     virtual_router_id, im Hallennetz eindeutig (Standard 51)
#   --geheimnisse DATEI             Geheimnis-Datei von server1 (Standard /root/hajime-cluster-geheimnisse.env)
#   --nur-konfig VERZEICHNIS        nur die Konfigurationsdateien erzeugen (zum Prüfen), nichts installieren
#   -h, --help                      diese Hilfe
#
# Umgebungsvariablen: INSTALL_DIR (/opt/hajime-pro), APP_PORT (3000), DB_NAME (hajime), MDNS_NAME (turnier),
# NODE_MAJOR (22), PG_VERSION (Standard: neueste installierte).
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hajime-pro}"
APP_USER="hajime"
APP_PORT="${APP_PORT:-3000}"
DB_NAME="${DB_NAME:-hajime}"
DB_USER="hajime"
REPL_USER="replikator"
MDNS_NAME="${MDNS_NAME:-turnier}"
NODE_MAJOR="${NODE_MAJOR:-22}"
QUELLE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEHEIMNIS_STANDARD="/root/hajime-cluster-geheimnisse.env"
ENV_DATEI="$INSTALL_DIR/.env"
MARKE_ANFANG="# >>> hajime-cluster (automatisch erzeugt, nicht von Hand ändern)"
MARKE_ENDE="# <<< hajime-cluster"

KNOTEN=""; EIGENE_IP=""; PARTNER_IP=""; VIP=""; ZEUGE=""; SCHNITTSTELLE=""; VRRP_ID="51"
GEHEIMNIS_DATEI=""; NUR_KONFIG=""

log()    { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
hinweis() { printf '    %s\n' "$*"; }
fehler() { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
zufall() { head -c 96 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "${1:-24}"; }
hilfe()  { sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'; }

# ---------------------------------------------------------------------------------------------
# Argumente
# ---------------------------------------------------------------------------------------------
while [ $# -gt 0 ]; do
    case "$1" in
        --knoten) KNOTEN="${2:-}"; shift 2 ;;
        --eigene-ip) EIGENE_IP="${2:-}"; shift 2 ;;
        --partner-ip) PARTNER_IP="${2:-}"; shift 2 ;;
        --vip) VIP="${2:-}"; shift 2 ;;
        --zeuge) ZEUGE="${2:-}"; shift 2 ;;
        --schnittstelle) SCHNITTSTELLE="${2:-}"; shift 2 ;;
        --vrrp-id) VRRP_ID="${2:-}"; shift 2 ;;
        --geheimnisse) GEHEIMNIS_DATEI="${2:-}"; shift 2 ;;
        --nur-konfig) NUR_KONFIG="${2:-}"; shift 2 ;;
        -h|--help) hilfe; exit 0 ;;
        *) fehler "Unbekannte Option: $1 (Hilfe: --help)" ;;
    esac
done

ist_ipv4() {
    local ip="$1" teil
    [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
    local IFS=.
    for teil in $ip; do [ "$teil" -le 255 ] || return 1; done
}

[ "$KNOTEN" = "server1" ] || [ "$KNOTEN" = "server2" ] || fehler "--knoten server1 oder server2 angeben."
ist_ipv4 "$EIGENE_IP" || fehler "--eigene-ip fehlt oder ist keine IPv4-Adresse."
ist_ipv4 "$PARTNER_IP" || fehler "--partner-ip fehlt oder ist keine IPv4-Adresse."
ist_ipv4 "$VIP" || fehler "--vip fehlt oder ist keine IPv4-Adresse."
[ "$EIGENE_IP" != "$PARTNER_IP" ] || fehler "--eigene-ip und --partner-ip dürfen nicht gleich sein."
[ "$VIP" != "$EIGENE_IP" ] && [ "$VIP" != "$PARTNER_IP" ] || fehler "Die VIP muss eine weitere, freie Adresse sein (nicht die eines Servers)."
[[ "$VRRP_ID" =~ ^[0-9]+$ ]] && [ "$VRRP_ID" -ge 1 ] && [ "$VRRP_ID" -le 255 ] || fehler "--vrrp-id muss zwischen 1 und 255 liegen."

if [ "$KNOTEN" = "server1" ]; then
    ROUTER_ID="HAJIME_SERVER1"; PRIORITAET=150
else
    ROUTER_ID="HAJIME_SERVER2"; PRIORITAET=100
fi

# ---------------------------------------------------------------------------------------------
# Geheimnisse (eine Datei, die von server1 nach server2 kopiert wird)
# ---------------------------------------------------------------------------------------------
GEHEIMNIS_SCHLUESSEL="DB_PASSWORD REPL_PASSWORD SYNC_SECRET JWT_SECRET STEUERUNG_PASSWORD SUPER_ADMIN_INITIAL_PASSWORD VRRP_AUTH"

lies_wert() { # lies_wert DATEI SCHLUESSEL -> Wert oder leer (ohne die Datei auszuführen)
    [ -f "$1" ] || return 0
    grep -m1 "^$2=" "$1" 2>/dev/null | cut -d= -f2- || true
}

laenge_fuer() { case "$1" in VRRP_AUTH) echo 8 ;; DB_PASSWORD|REPL_PASSWORD) echo 28 ;; JWT_SECRET) echo 48 ;; SYNC_SECRET) echo 32 ;; STEUERUNG_PASSWORD) echo 10 ;; *) echo 14 ;; esac; }

lade_geheimnisse() {
    local datei="$1" schluessel wert
    for schluessel in $GEHEIMNIS_SCHLUESSEL; do
        wert="$(lies_wert "$datei" "$schluessel")"
        [ -n "$wert" ] || fehler "In $datei fehlt $schluessel."
        [[ "$wert" =~ ^[A-Za-z0-9]+$ ]] || fehler "$schluessel in $datei darf nur Buchstaben und Ziffern enthalten."
        printf -v "G_$schluessel" '%s' "$wert"
    done
    [ "${#G_VRRP_AUTH}" -le 8 ] || fehler "VRRP_AUTH darf höchstens 8 Zeichen haben (keepalived)."
}

erzeuge_geheimnisse() { # server1: vorhandene Werte (Einzelserver-.env) übernehmen, sonst zufällig
    local datei="$1" schluessel wert vorhanden
    : > "$datei.neu"; chmod 600 "$datei.neu"
    for schluessel in $GEHEIMNIS_SCHLUESSEL; do
        wert=""
        case "$schluessel" in
            DB_PASSWORD|SYNC_SECRET|JWT_SECRET|SUPER_ADMIN_INITIAL_PASSWORD) wert="$(lies_wert "$ENV_DATEI" "$schluessel")" ;;
            STEUERUNG_PASSWORD) wert="$(lies_wert "$ENV_DATEI" STEUERUNG_PASSWORD)" ;;
        esac
        vorhanden="$(lies_wert "$datei" "$schluessel")"
        [ -n "$vorhanden" ] && wert="$vorhanden"
        [ -n "$wert" ] || wert="$(zufall "$(laenge_fuer "$schluessel")")"
        echo "$schluessel=$wert" >> "$datei.neu"
    done
    mv "$datei.neu" "$datei"
}

# ---------------------------------------------------------------------------------------------
# Konfigurationsdateien (alle rein textuell, damit sie ohne Installation prüfbar sind: --nur-konfig)
# ---------------------------------------------------------------------------------------------
rendere_env() {
    cat <<EOF
# Erzeugt von deploy/linux/install-cluster.sh am $(date -Iseconds) (Knoten $KNOTEN)
PORT=$APP_PORT
BETRIEBSMODUS=server
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$G_DB_PASSWORD
SYNC_DATENVERZEICHNIS=$INSTALL_DIR/data/dokumente
SYNC_SECRET=$G_SYNC_SECRET
CLIENT_DOWNLOADS_VERZEICHNIS=$INSTALL_DIR/data/client-downloads
JWT_SECRET=$G_JWT_SECRET
STEUERUNG_PASSWORD=$G_STEUERUNG_PASSWORD
SUPER_ADMIN_INITIAL_PASSWORD=$G_SUPER_ADMIN_INITIAL_PASSWORD
MDNS_NAME=$MDNS_NAME
${CLIENT_RELEASE_TOKEN:+CLIENT_RELEASE_TOKEN=$CLIENT_RELEASE_TOKEN}
CLUSTER_KNOTEN=$KNOTEN
CLUSTER_PARTNER_URL=http://$PARTNER_IP:$APP_PORT
CLUSTER_VIP=$VIP
CLUSTER_ZEUGE=$ZEUGE
EOF
}

rendere_cluster_env() { # für hajime-rueckstufen.sh
    cat <<EOF
# Erzeugt von deploy/linux/install-cluster.sh (Knoten $KNOTEN)
CLUSTER_KNOTEN=$KNOTEN
PARTNER_PG_HOST=$PARTNER_IP
PG_VERSION=$PG_VERSION
REPL_USER=$REPL_USER
EOF
}

rendere_pg_hba() {
    cat <<EOF
$MARKE_ANFANG
host    replication     $REPL_USER      $EIGENE_IP/32        scram-sha-256
host    replication     $REPL_USER      $PARTNER_IP/32        scram-sha-256
# pg_rewind verbindet sich als $REPL_USER mit einer normalen Datenbank
host    postgres        $REPL_USER      $EIGENE_IP/32        scram-sha-256
host    postgres        $REPL_USER      $PARTNER_IP/32        scram-sha-256
# App (lokal)
host    $DB_NAME          $DB_USER          127.0.0.1/32            scram-sha-256
$MARKE_ENDE
EOF
}

# Idempotent (nur server1 führt es aus): Rollen, Datenbank, Rechte der App und des Replikationsnutzers.
rendere_rechte_sql() {
    cat <<EOF
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN CREATE ROLE $DB_USER LOGIN PASSWORD '$G_DB_PASSWORD';
  ELSE ALTER ROLE $DB_USER LOGIN PASSWORD '$G_DB_PASSWORD'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$REPL_USER') THEN CREATE ROLE $REPL_USER LOGIN REPLICATION PASSWORD '$G_REPL_PASSWORD';
  ELSE ALTER ROLE $REPL_USER LOGIN REPLICATION PASSWORD '$G_REPL_PASSWORD'; END IF;
END \$\$;
GRANT EXECUTE ON FUNCTION pg_promote(boolean, integer) TO $DB_USER;
GRANT EXECUTE ON FUNCTION pg_reload_conf() TO $DB_USER;
GRANT ALTER SYSTEM ON PARAMETER synchronous_standby_names TO $DB_USER;
GRANT pg_monitor TO $DB_USER;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text, boolean, boolean) TO $REPL_USER;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_file(text, boolean) TO $REPL_USER;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text) TO $REPL_USER;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text, bigint, bigint, boolean) TO $REPL_USER;
EOF
}

rendere_keepalived() {
    cat <<EOF
# Erzeugt von deploy/linux/install-cluster.sh (Knoten $KNOTEN). Vorlage und Erläuterungen:
# deploy/linux/keepalived/keepalived.conf.vorlage. Beide Server laufen als BACKUP mit nopreempt: wer die VIP hat,
# behält sie, solange er gesund ist (GET /api/cluster/gesund).
global_defs {
    router_id $ROUTER_ID
    script_user root
    enable_script_security
}

vrrp_script hajime_gesund {
    script "/usr/bin/curl -fs -m 1 http://127.0.0.1:$APP_PORT/api/cluster/gesund -o /dev/null"
    interval 1
    fall 2
    rise 2
}

vrrp_instance HAJIME {
    state BACKUP
    nopreempt
    interface $SCHNITTSTELLE
    virtual_router_id $VRRP_ID
    priority $PRIORITAET
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass $G_VRRP_AUTH
    }
    unicast_src_ip $EIGENE_IP
    unicast_peer {
        $PARTNER_IP
    }
    virtual_ipaddress {
        $VIP/$PRAEFIX dev $SCHNITTSTELLE
    }
    track_script {
        hajime_gesund
    }
    notify_master "/usr/local/bin/hajime-befoerdern.sh"
    notify_backup "/usr/local/bin/hajime-zurueckstufen.sh"
    notify_fault  "/usr/local/bin/hajime-zurueckstufen.sh"
    notify_stop   "/usr/local/bin/hajime-zurueckstufen.sh"
}
EOF
}

# Der Partner schickt VRRP (IP-Protokoll 112); ufw kennt es nicht, deshalb direkt in before.rules.
rendere_ufw_vrrp() {
    printf '%s\n-A ufw-before-input -p 112 -s %s -j ACCEPT\n%s\n' "$MARKE_ANFANG" "$PARTNER_IP" "$MARKE_ENDE"
}

# ---------------------------------------------------------------------------------------------
# Nur Konfiguration erzeugen (Prüfung / Test) — vor allen Systemzugriffen
# ---------------------------------------------------------------------------------------------
if [ -n "$NUR_KONFIG" ]; then
    [ -n "$GEHEIMNIS_DATEI" ] || fehler "--nur-konfig braucht --geheimnisse DATEI."
    lade_geheimnisse "$GEHEIMNIS_DATEI"
    PG_VERSION="${PG_VERSION:-17}"
    PRAEFIX="${PRAEFIX:-24}"
    SCHNITTSTELLE="${SCHNITTSTELLE:-eth0}"
    mkdir -p "$NUR_KONFIG"
    rendere_env > "$NUR_KONFIG/env"
    rendere_cluster_env > "$NUR_KONFIG/cluster.env"
    rendere_pg_hba > "$NUR_KONFIG/pg_hba.conf.ausschnitt"
    rendere_rechte_sql > "$NUR_KONFIG/rechte.sql"
    rendere_keepalived > "$NUR_KONFIG/keepalived.conf"
    rendere_ufw_vrrp > "$NUR_KONFIG/ufw-vrrp.rules"
    echo "Konfigurationsdateien nach $NUR_KONFIG geschrieben."
    exit 0
fi

# ---------------------------------------------------------------------------------------------
# Voraussetzungen
# ---------------------------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || fehler "Bitte als root ausführen: sudo bash $0 ..."
command -v apt-get >/dev/null || fehler "Nur Debian/Ubuntu (apt) wird unterstützt."
[ -f "$QUELLE/package.json" ] && [ -f "$QUELLE/src/app.js" ] || fehler "Quellcode nicht gefunden (erwartet in $QUELLE)."
export DEBIAN_FRONTEND=noninteractive

NEUE_GEHEIMNISSE=0
if [ "$KNOTEN" = "server2" ]; then
    GEHEIMNIS_DATEI="${GEHEIMNIS_DATEI:-$GEHEIMNIS_STANDARD}"
    [ -f "$GEHEIMNIS_DATEI" ] || fehler "Geheimnis-Datei $GEHEIMNIS_DATEI fehlt. Zuerst server1 einrichten und die Datei kopieren:
    scp $GEHEIMNIS_STANDARD root@$EIGENE_IP:/root/"
else
    GEHEIMNIS_DATEI="${GEHEIMNIS_DATEI:-$GEHEIMNIS_STANDARD}"
    if [ ! -f "$GEHEIMNIS_DATEI" ]; then NEUE_GEHEIMNISSE=1; fi
fi

# ---------------------------------------------------------------------------------------------
# 1. Pakete
# ---------------------------------------------------------------------------------------------
log "Systempakete installieren"
apt-get update -qq
apt-get install -y -qq postgresql keepalived curl ca-certificates gnupg rsync openssl sudo iproute2 iputils-ping \
    build-essential python3 >/dev/null

node_major() { if command -v node >/dev/null; then node -v | sed 's/^v\([0-9]*\).*/\1/'; else echo 0; fi; }
if [ "$(node_major)" -lt 20 ]; then
    log "Node.js $NODE_MAJOR installieren (NodeSource)"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
fi
echo "Node.js $(node -v), npm $(npm -v)"

PG_VERSION="${PG_VERSION:-$(find /usr/lib/postgresql -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -1)}"
[ -n "$PG_VERSION" ] || fehler "Keine PostgreSQL-Installation gefunden."
[ "${PG_VERSION%%.*}" -ge 15 ] || fehler "Der Cluster braucht PostgreSQL 15 oder neuer (gefunden: $PG_VERSION). Debian 12/13 oder Ubuntu 24.04 verwenden."
PG_DATA="/var/lib/postgresql/$PG_VERSION/main"
PG_ETC="/etc/postgresql/$PG_VERSION/main"
PG_BIN="/usr/lib/postgresql/$PG_VERSION/bin"
PG_DIENST="postgresql@${PG_VERSION}-main"
echo "PostgreSQL $PG_VERSION (Daten: $PG_DATA)"

# Netzwerk: Schnittstelle und Präfix der eigenen IP, VIP im selben Netz
ADRESSZEILE="$(ip -o -4 addr show | awk -v ip="$EIGENE_IP" '{split($4, a, "/"); if (a[1] == ip) {print $2, a[2]; exit}}')"
[ -n "$ADRESSZEILE" ] || fehler "Die IP $EIGENE_IP ist auf diesem Server nicht konfiguriert. Feste IP zuerst einrichten (siehe 'ip -4 addr')."
[ -n "$SCHNITTSTELLE" ] || SCHNITTSTELLE="${ADRESSZEILE%% *}"
PRAEFIX="${ADRESSZEILE##* }"
ip link show "$SCHNITTSTELLE" >/dev/null 2>&1 || fehler "Netzwerkschnittstelle $SCHNITTSTELLE gibt es nicht."

ip_zahl() { local IFS=.; set -- $1; echo $(( ($1 << 24) + ($2 << 16) + ($3 << 8) + $4 )); }
maske() { echo $(( (0xFFFFFFFF << (32 - $1)) & 0xFFFFFFFF )); }
[ $(( $(ip_zahl "$VIP") & $(maske "$PRAEFIX") )) -eq $(( $(ip_zahl "$EIGENE_IP") & $(maske "$PRAEFIX") )) ] \
    || fehler "Die VIP $VIP liegt nicht im Netz von $EIGENE_IP/$PRAEFIX."
[ $(( $(ip_zahl "$PARTNER_IP") & $(maske "$PRAEFIX") )) -eq $(( $(ip_zahl "$EIGENE_IP") & $(maske "$PRAEFIX") )) ] \
    || fehler "Der Partner $PARTNER_IP liegt nicht im Netz von $EIGENE_IP/$PRAEFIX."

# ---------------------------------------------------------------------------------------------
# 2. Systembenutzer + Code
# ---------------------------------------------------------------------------------------------
log "Anwendung nach $INSTALL_DIR kopieren"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
    --exclude '.git' --exclude 'node_modules' --exclude 'data' --exclude '.env' \
    --exclude 'dist-desktop' --exclude 'dist-server' --exclude 'test-results' --exclude 'playwright-report' \
    "$QUELLE"/ "$INSTALL_DIR"/
mkdir -p "$INSTALL_DIR/data/dokumente" "$INSTALL_DIR/data/client-downloads"
chown -R "$APP_USER":"$APP_USER" "$INSTALL_DIR"

log "Node-Abhängigkeiten installieren (dauert einige Minuten)"
runuser -u "$APP_USER" -- bash -c "cd '$INSTALL_DIR' && npm ci --omit=dev --no-audit --no-fund"

# ---------------------------------------------------------------------------------------------
# 3. Geheimnisse
# ---------------------------------------------------------------------------------------------
if [ "$KNOTEN" = "server1" ]; then
    erzeuge_geheimnisse "$GEHEIMNIS_DATEI"
    [ "$NEUE_GEHEIMNISSE" -eq 1 ] && hinweis "Geheimnisse angelegt: $GEHEIMNIS_DATEI (nur root lesbar) – diese Datei auf server2 kopieren."
fi
lade_geheimnisse "$GEHEIMNIS_DATEI"

# ---------------------------------------------------------------------------------------------
# 4. PostgreSQL: Replikationseinstellungen, pg_hba, .pgpass
# ---------------------------------------------------------------------------------------------
log "PostgreSQL für die Replikation einrichten"
mkdir -p /etc/hajime
rendere_cluster_env > /etc/hajime/cluster.env
chmod 644 /etc/hajime/cluster.env

# Schreibt eine Datei nur bei Änderung; liefert 0, wenn sie neu oder geändert ist.
schreibe_wenn_geaendert() { # schreibe_wenn_geaendert ZIEL MODUS < Inhalt
    local ziel="$1" modus="$2" tmp
    tmp="$(mktemp)"; cat > "$tmp"
    if [ -f "$ziel" ] && cmp -s "$tmp" "$ziel"; then rm -f "$tmp"; return 1; fi
    install -m "$modus" "$tmp" "$ziel"; rm -f "$tmp"; return 0
}

PG_NEU_KONFIGURIERT=0
install -d "$PG_ETC/conf.d"
if schreibe_wenn_geaendert "$PG_ETC/conf.d/hajime-cluster.conf" 644 < "$QUELLE/deploy/linux/postgresql/hajime-cluster.conf"; then PG_NEU_KONFIGURIERT=1; fi
HBA_TMP="$(mktemp)"
sed "/$(printf '%s' "$MARKE_ANFANG" | sed 's/[][\.*^$/]/\\&/g')/,/$(printf '%s' "$MARKE_ENDE" | sed 's/[][\.*^$/]/\\&/g')/d" "$PG_ETC/pg_hba.conf" > "$HBA_TMP"
rendere_pg_hba >> "$HBA_TMP"
if ! cmp -s "$HBA_TMP" "$PG_ETC/pg_hba.conf"; then
    cp "$PG_ETC/pg_hba.conf" "$PG_ETC/pg_hba.conf.vor-hajime"
    install -o postgres -g postgres -m 640 "$HBA_TMP" "$PG_ETC/pg_hba.conf"
    PG_NEU_KONFIGURIERT=1
fi
rm -f "$HBA_TMP"

# ~postgres/.pgpass: Passwort des Replikationsnutzers für den Partner (primary_conninfo, pg_basebackup, pg_rewind)
PG_HOME="$(getent passwd postgres | cut -d: -f6)"
printf '%s:5432:*:%s:%s\n' "$PARTNER_IP" "$REPL_USER" "$G_REPL_PASSWORD" > "$PG_HOME/.pgpass"
chown postgres:postgres "$PG_HOME/.pgpass"; chmod 600 "$PG_HOME/.pgpass"

als_postgres() { runuser -u postgres -- "$@"; }
psql_lokal()   { als_postgres psql -v ON_ERROR_STOP=1 -qtA "$@"; }
pg_laeuft()    { pg_isready -q -h /var/run/postgresql 2>/dev/null || pg_isready -q 2>/dev/null; }
warte_auf_pg() { for _ in $(seq 1 60); do pg_laeuft && return 0; sleep 1; done; return 1; }
ist_standby()  { [ "$(psql_lokal -d postgres -c 'SELECT pg_is_in_recovery()' 2>/dev/null || echo f)" = "t" ]; }

if [ "$KNOTEN" = "server1" ]; then
    # --- server1: Master ---------------------------------------------------------------------
    systemctl enable "$PG_DIENST" >/dev/null 2>&1 || true
    if [ "$PG_NEU_KONFIGURIERT" -eq 1 ]; then
        # listen_addresses/wal_level brauchen einen Neustart (beim ersten Lauf; ein laufender Cluster bekommt nur ein Reload)
        if [ -f "$PG_DATA/standby.signal" ]; then
            systemctl reload "$PG_DIENST" || true
        else
            systemctl restart "$PG_DIENST"
        fi
    else
        systemctl start "$PG_DIENST"
    fi
    warte_auf_pg || fehler "PostgreSQL startet nicht (journalctl -u $PG_DIENST)."
    if ist_standby; then
        hinweis "Dieser PostgreSQL ist derzeit Standby (Failover erfolgt) – Rollen/Schema werden nicht angefasst."
    else
        log "Rollen und Datenbank anlegen"
        rendere_rechte_sql | psql_lokal -d postgres
        [ "$(psql_lokal -d postgres -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'")" = "1" ] \
            || psql_lokal -d postgres -c "CREATE DATABASE $DB_NAME OWNER $DB_USER"
        # Rechte auf Systemfunktionen gelten je Datenbank (pg_proc): die App verbindet sich mit $DB_NAME.
        psql_lokal -d "$DB_NAME" <<SQL
GRANT EXECUTE ON FUNCTION pg_promote(boolean, integer) TO $DB_USER;
GRANT EXECUTE ON FUNCTION pg_reload_conf() TO $DB_USER;
SQL
    fi
else
    # --- server2: Standby von server1 ---------------------------------------------------------
    log "server1 erreichbar?"
    PARTNER_OK=0
    for _ in $(seq 1 30); do
        if PGPASSWORD="$G_REPL_PASSWORD" PGCONNECT_TIMEOUT=3 psql -qtA -h "$PARTNER_IP" -U "$REPL_USER" -d postgres -c 'SELECT 1' >/dev/null 2>&1; then PARTNER_OK=1; break; fi
        sleep 2
    done
    [ "$PARTNER_OK" -eq 1 ] || fehler "PostgreSQL auf server1 ($PARTNER_IP) ist als $REPL_USER nicht erreichbar. server1 zuerst fertig einrichten (und Firewall/pg_hba prüfen)."

    STANDBY_OK=0
    if [ -f "$PG_DATA/standby.signal" ] && grep -q "host=$PARTNER_IP" "$PG_DATA/postgresql.auto.conf" 2>/dev/null; then STANDBY_OK=1; fi
    if [ "$STANDBY_OK" -eq 1 ]; then
        log "PostgreSQL ist bereits Standby von $PARTNER_IP"
        if [ "$PG_NEU_KONFIGURIERT" -eq 1 ]; then systemctl reload "$PG_DIENST" || true; else systemctl start "$PG_DIENST"; fi
    else
        log "PostgreSQL als Standby von server1 aufbauen (pg_basebackup)"
        systemctl stop "$PG_DIENST" 2>/dev/null || true
        if [ -d "$PG_DATA" ] && [ -n "$(ls -A "$PG_DATA" 2>/dev/null)" ]; then
            SICHERUNG="${PG_DATA}.vor-cluster-$(date +%Y%m%d-%H%M%S)"
            mv "$PG_DATA" "$SICHERUNG"
            hinweis "Vorhandenes Datenverzeichnis gesichert unter $SICHERUNG (nach erfolgreichem Aufbau löschen)."
        fi
        install -d -o postgres -g postgres -m 700 "$PG_DATA"
        als_postgres "$PG_BIN/pg_basebackup" -h "$PARTNER_IP" -U "$REPL_USER" -D "$PG_DATA" -X stream -R -c fast -P
        # eigener Name als application_name: server1 trägt ihn in synchronous_standby_names ein
        printf "primary_conninfo = 'host=%s user=%s application_name=%s'\n" "$PARTNER_IP" "$REPL_USER" "$KNOTEN" \
            | als_postgres tee -a "$PG_DATA/postgresql.auto.conf" >/dev/null
        systemctl enable "$PG_DIENST" >/dev/null 2>&1 || true
        systemctl start "$PG_DIENST"
    fi
    warte_auf_pg || fehler "PostgreSQL startet nicht (journalctl -u $PG_DIENST)."
    log "Replikation prüfen"
    STREAMING=0
    for _ in $(seq 1 60); do
        if [ "$(psql_lokal -d postgres -c "SELECT status FROM pg_stat_wal_receiver" 2>/dev/null || true)" = "streaming" ]; then STREAMING=1; break; fi
        sleep 1
    done
    [ "$STREAMING" -eq 1 ] || fehler "Der Standby streamt nicht von server1 (SELECT * FROM pg_stat_wal_receiver; journalctl -u $PG_DIENST)."
    hinweis "Standby streamt von $PARTNER_IP."
fi

# ---------------------------------------------------------------------------------------------
# 5. Anwendung: .env, Schema, Dienste
# ---------------------------------------------------------------------------------------------
log "Konfiguration der Anwendung"
if [ -f "$ENV_DATEI" ] && ! grep -q "^CLUSTER_KNOTEN=" "$ENV_DATEI"; then
    cp "$ENV_DATEI" "$ENV_DATEI.vor-cluster-$(date +%Y%m%d-%H%M%S)"
    hinweis "Bisherige .env gesichert (Einzelserver-Konfiguration), Cluster-Konfiguration wird angelegt."
fi
rendere_env | install -o "$APP_USER" -g "$APP_USER" -m 600 /dev/stdin "$ENV_DATEI"

if ist_standby; then
    hinweis "Schema-Migration übersprungen: dieser PostgreSQL ist Standby (das Schema kommt per Replikation)."
else
    log "Datenbank-Migrationen ausführen"
    runuser -u "$APP_USER" -- bash -c "cd '$INSTALL_DIR' && npx knex migrate:latest --knexfile knexfile.cjs --env online"
fi

log "Dienst, Rückstufungs-Skript und sudoers-Regel einrichten"
install -m 644 "$QUELLE/deploy/linux/systemd/hajime-pro.service" /etc/systemd/system/hajime-pro.service
install -m 755 "$QUELLE/deploy/linux/hajime-rueckstufen.sh" /usr/local/bin/hajime-rueckstufen.sh
install -m 755 "$QUELLE/deploy/linux/keepalived/hajime-befoerdern.sh" /usr/local/bin/hajime-befoerdern.sh
install -m 755 "$QUELLE/deploy/linux/keepalived/hajime-zurueckstufen.sh" /usr/local/bin/hajime-zurueckstufen.sh
install -m 755 "$QUELLE/deploy/linux/cluster-status.sh" /usr/local/bin/hajime-cluster-status
install -m 440 "$QUELLE/deploy/linux/sudoers.hajime" /etc/sudoers.d/hajime
visudo -cf /etc/sudoers.d/hajime >/dev/null || { rm -f /etc/sudoers.d/hajime; fehler "sudoers-Regel ungültig."; }
systemctl daemon-reload
systemctl enable hajime-pro >/dev/null
systemctl restart hajime-pro

# ---------------------------------------------------------------------------------------------
# 6. keepalived
# ---------------------------------------------------------------------------------------------
log "keepalived einrichten"
install -d /etc/keepalived
KEEPALIVED_NEU=0
if rendere_keepalived | schreibe_wenn_geaendert /etc/keepalived/keepalived.conf 600; then KEEPALIVED_NEU=1; fi
systemctl enable keepalived >/dev/null 2>&1
if systemctl is-active --quiet keepalived; then
    # Läuft bereits (Update): nur neu laden, ein Neustart würde die VIP kurz freigeben und einen Failover auslösen.
    [ "$KEEPALIVED_NEU" -eq 1 ] && systemctl reload keepalived || true
else
    systemctl start keepalived
fi

# ---------------------------------------------------------------------------------------------
# 7. Firewall (nur wenn ufw aktiv ist)
# ---------------------------------------------------------------------------------------------
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    log "Firewall-Regeln (ufw)"
    ufw allow "$APP_PORT"/tcp >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 5353/udp >/dev/null
    ufw allow from "$PARTNER_IP" to any port 5432 proto tcp >/dev/null
    BEFORE=/etc/ufw/before.rules
    if ! grep -qF "$MARKE_ANFANG" "$BEFORE"; then
        # Vor der abschließenden COMMIT-Zeile des filter-Blocks einfügen
        TMP="$(mktemp)"
        awk -v block="$(rendere_ufw_vrrp)" '/^COMMIT$/ && !fertig {print block; fertig=1} {print}' "$BEFORE" > "$TMP"
        cp "$BEFORE" "$BEFORE.vor-hajime"; install -m 640 "$TMP" "$BEFORE"; rm -f "$TMP"
        ufw reload >/dev/null || true
    fi
fi

# ---------------------------------------------------------------------------------------------
# 8. Prüfen
# ---------------------------------------------------------------------------------------------
log "Warte auf den Start der Anwendung"
OK=0
for _ in $(seq 1 90); do
    if curl -fs -m 2 "http://127.0.0.1:$APP_PORT/api/cluster/status" -o /dev/null; then OK=1; break; fi
    sleep 1
done
if [ "$OK" -ne 1 ]; then
    journalctl -u hajime-pro -n 40 --no-pager || true
    fehler "Die App antwortet nicht. Log: journalctl -u hajime-pro -e"
fi

printf '\n\033[1;32m✔ %s ist eingerichtet.\033[0m\n' "$KNOTEN"
bash "$QUELLE/deploy/linux/cluster-status.sh" || true
if [ "$KNOTEN" = "server1" ]; then
    cat <<EOF

  Nächster Schritt – server2 einrichten:
    scp $GEHEIMNIS_DATEI root@$PARTNER_IP:/root/
    (auf server2, im Repository)  sudo bash deploy/linux/install-cluster.sh --knoten server2 \\
        --eigene-ip $PARTNER_IP --partner-ip $EIGENE_IP --vip $VIP${ZEUGE:+ --zeuge $ZEUGE}

  Clients tragen die VIP ein:  SYNC_SERVER_URL=http://$VIP:$APP_PORT
  Turnierleitung öffnet:       http://$VIP:$APP_PORT   (Cluster-Seite: /cluster.html)
  Passwörter und Geheimnisse:  $GEHEIMNIS_DATEI  und  $ENV_DATEI
  Turnierleitungs-Passwort:    $G_STEUERUNG_PASSWORD
EOF
else
    cat <<EOF

  Abnahme (Checkliste in deploy/linux/README.md): Cluster-Seite http://$VIP:$APP_PORT/cluster.html,
  Zustand jederzeit mit:  hajime-cluster-status
EOF
fi
echo
