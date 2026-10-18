#!/usr/bin/env bash
# Hajime Pro – Update eines Hallen-Servers (Linux, Dienst unter /opt/hajime-pro) auf den Stand des Klons.
#
# Aufruf im Quellordner (Standard /opt/hajime-quelle, angelegt von deploy/linux/holen.sh) auf dem jeweiligen Server, als root:
#     sudo bash update.sh
#
# Was das Skript tut:
#   1. holt das Dienst-Paket des Releases aus dem öffentlichen Release-Repository (deploy/linux/holen.sh, mit Prüfsumme)
#   2. sichert die Datenbank nach /root/sicherung/ (pg_dump)
#   3. spielt das Update ein: im Cluster install-cluster.sh mit den Angaben der vorhandenen .env
#      (Knoten, Partner, VIP, Zeuge), auf einem Einzelserver install.sh; .env und Daten bleiben,
#      Migrationen laufen mit. Ein laufender Cluster wird nur neu geladen, nicht neu gestartet.
#
# Cluster: erst den Standby aktualisieren, dann über cluster.html die geplante Übergabe auslösen und
# danach den anderen Server aktualisieren. Währenddessen sollte kein Turnier laufen.
#
# Optionen (Umgebungsvariablen):
#   VERSION   Version statt des neuesten Releases (z. B. VERSION=1.0.18)
#   OHNE_PULL=1   nichts herunterladen (der Quellordner ist schon auf dem gewünschten Stand)
#   OHNE_SICHERUNG=1   keine Datenbanksicherung
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/hajime-pro}"
ENV_DATEI="$INSTALL_DIR/.env"
DB_NAME="${DB_NAME:-hajime}"
# Das Skript wechselt während des Laufs die Version des Klons und würde sich dabei selbst ändern (oder verschwinden,
# wenn ein älterer Tag es nicht enthält): daher einmal als Kopie neu starten.
if [ -z "${HAJIME_UPDATE_KOPIE:-}" ]; then
    KOPIE="$(mktemp /tmp/hajime-update.XXXXXX)"
    cp "${BASH_SOURCE[0]}" "$KOPIE"
    HAJIME_UPDATE_KOPIE=1 HAJIME_UPDATE_KLON="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" exec bash "$KOPIE" "$@"
fi
KLON="$HAJIME_UPDATE_KLON"
VERSION="${VERSION:-}"

log()     { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
hinweis() { printf '    %s\n' "$*"; }
fehler()  { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
lies()    { [ -f "$ENV_DATEI" ] && grep -m1 "^$1=" "$ENV_DATEI" | cut -d= -f2- || true; }

[ "$(id -u)" -eq 0 ] || fehler "Als root ausführen: sudo bash update.sh"
[ -f "$KLON/package.json" ] || fehler "$KLON enthält keinen Quellstand (erst deploy/linux/holen.sh ausführen)."
[ -f "$ENV_DATEI" ] || fehler "$ENV_DATEI fehlt – dieser Server ist noch nicht installiert (deploy/linux/install.sh bzw. install-cluster.sh)."

VORHER="$(grep -m1 '"version"' "$INSTALL_DIR/package.json" 2>/dev/null | cut -d'"' -f4 || true)"
if [ "${OHNE_PULL:-0}" != "1" ]; then
    log "Release holen (${VERSION:-neuestes})"
    [ -f "$KLON/deploy/linux/holen.sh" ] || fehler "$KLON/deploy/linux/holen.sh fehlt – einmalig von Hand holen: curl -fsSL https://github.com/oensel/Hajime-Pro-Releases/releases/latest/download/hajime-holen.sh | QUELLE_DIR=$KLON bash"
    QUELLE_DIR="$KLON" VERSION="$VERSION" bash "$KLON/deploy/linux/holen.sh"
fi
STAND_VERSION="$(node -p "require('$KLON/package.json').version" 2>/dev/null || grep -m1 '"version"' "$KLON/package.json" | cut -d'"' -f4)"
hinweis "Quellstand: Version $STAND_VERSION"

if [ "${OHNE_SICHERUNG:-0}" != "1" ]; then
    log "Datenbank sichern"
    mkdir -p /root/sicherung
    SICHERUNG="/root/sicherung/hajime-vor-update-$(date +%Y%m%d-%H%M%S).dump"
    if sudo -u postgres pg_dump -Fc "$DB_NAME" > "$SICHERUNG" 2>/dev/null; then
        chmod 600 "$SICHERUNG"
        hinweis "Sicherung: $SICHERUNG"
    else
        rm -f "$SICHERUNG"
        hinweis "WARNUNG: Sicherung nicht möglich (eingebettetes PostgreSQL oder Datenbank '$DB_NAME' nicht gefunden) – weiter ohne."
    fi
fi

KNOTEN="$(lies CLUSTER_KNOTEN)"
if [ -n "$KNOTEN" ]; then
    PARTNER_URL="$(lies CLUSTER_PARTNER_URL)"
    PARTNER_IP="${PARTNER_URL#http://}"; PARTNER_IP="${PARTNER_IP%%[:/]*}"
    VIP="$(lies CLUSTER_VIP)"
    ZEUGE="$(lies CLUSTER_ZEUGE)"
    [ -n "$PARTNER_IP" ] && [ -n "$VIP" ] || fehler "CLUSTER_PARTNER_URL/CLUSTER_VIP fehlen in $ENV_DATEI."
    ARGS=(--knoten "$KNOTEN" --partner-ip "$PARTNER_IP" --vip "$VIP")
    [ -z "$ZEUGE" ] || ARGS+=(--zeuge "$ZEUGE")
    log "Cluster-Update ($KNOTEN, Partner $PARTNER_IP, VIP $VIP)"
    bash "$KLON/deploy/linux/install-cluster.sh" "${ARGS[@]}"
else
    log "Einzelserver-Update"
    bash "$KLON/deploy/linux/install.sh"
fi

log "Prüfung"
sleep 3
systemctl is-active --quiet hajime-pro && hinweis "Dienst hajime-pro: aktiv" || hinweis "WARNUNG: Dienst hajime-pro ist nicht aktiv (journalctl -u hajime-pro -n 50)"
if command -v curl >/dev/null; then
    curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT:-3000}/api/cluster/gesund" 2>/dev/null && echo || hinweis "Gesundheitscheck nicht erreichbar (Einzelserver oder Dienst startet noch)."
fi
printf '\nFertig. Version im Quellordner: %s (vorher: %s)\n' "$STAND_VERSION" "${VORHER:-unbekannt}"
