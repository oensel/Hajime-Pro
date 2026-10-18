#!/bin/bash
# Volles Update dieses Cluster-Servers auf ein Release (Cluster-Seite, Spec 2026-10-14-cluster-update-design.md).
# Aufgerufen von der App (CLUSTER_UPDATE_BEFEHL, Standard "sudo -n /usr/local/bin/hajime-update.sh <x.y.z>").
# Das eigentliche Update (update.sh im Quellordner, VERSION=<x.y.z>) läuft losgelöst als systemd-Einheit, weil es den
# Dienst neu startet, der dieses Skript aufgerufen hat. Fortschritt: /var/lib/hajime/update-status.json, Log:
# /var/log/hajime-update.log.
set -euo pipefail

STATUS=/var/lib/hajime/update-status.json
LOG=/var/log/hajime-update.log
ZIEL=""

schreibe() { # zustand meldung
    mkdir -p "$(dirname "$STATUS")"
    printf '{"zustand":"%s","ziel":"%s","meldung":"%s","zeit":"%s"}\n' "$1" "$ZIEL" "$2" "$(date -Is)" > "$STATUS.tmp"
    mv "$STATUS.tmp" "$STATUS"
}

if [ "${1:-}" = "--lauf" ]; then
    ZIEL="${2:-}"
    [[ "$ZIEL" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
    # shellcheck disable=SC1091
    source /etc/hajime/cluster.env
    if VERSION="$ZIEL" bash "$KLON/update.sh" >> "$LOG" 2>&1; then
        schreibe fertig "Update auf $ZIEL abgeschlossen"
    else
        schreibe fehler "Update auf $ZIEL fehlgeschlagen (siehe $LOG)"
        exit 1
    fi
    exit 0
fi

ZIEL="${1:-}"
[[ "$ZIEL" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Ungültige Version: $ZIEL" >&2; exit 2; }
# shellcheck disable=SC1091
source /etc/hajime/cluster.env
[ -n "${KLON:-}" ] && [ -f "$KLON/update.sh" ] || { echo "Quellordner mit update.sh nicht gefunden (KLON in /etc/hajime/cluster.env)." >&2; exit 2; }

schreibe laeuft "Update auf $ZIEL gestartet"
systemd-run --unit="hajime-update-$ZIEL-$(date +%s)" --collect --quiet /bin/bash "$0" --lauf "$ZIEL"
echo "Update auf $ZIEL gestartet"
