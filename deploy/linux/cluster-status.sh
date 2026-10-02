#!/usr/bin/env bash
# Zeigt den Zustand dieses Cluster-Knotens: App-Rolle, PostgreSQL (Master/Standby, Replikation), keepalived (VIP), Partner.
# Installiert als /usr/local/bin/hajime-cluster-status; aufrufbar auch direkt aus dem Repository.
set -uo pipefail

CLUSTER_ENV="${CLUSTER_ENV:-/etc/hajime/cluster.env}"
ENV_DATEI="${ENV_DATEI:-/opt/hajime-pro/.env}"
# shellcheck source=/dev/null
[ -f "$CLUSTER_ENV" ] && set -a && . "$CLUSTER_ENV" && set +a
lies() { [ -f "$ENV_DATEI" ] && grep -E "^$1=" "$ENV_DATEI" | tail -1 | cut -d= -f2-; }

KNOTEN="${CLUSTER_KNOTEN:-$(lies CLUSTER_KNOTEN)}"
PORT="$(lies PORT)"; PORT="${PORT:-3000}"
VIP="$(lies CLUSTER_VIP)"
PARTNER_URL="$(lies CLUSTER_PARTNER_URL)"
PARTNER_HOST="${PARTNER_PG_HOST:-}"
[ -n "$KNOTEN" ] || { echo "Kein Cluster-Knoten konfiguriert (CLUSTER_KNOTEN fehlt)."; exit 1; }

ok() { printf '  [ OK ] %s\n' "$*"; }
warn() { printf '  [ !! ] %s\n' "$*"; PROBLEME=$((PROBLEME + 1)); }
PROBLEME=0
psql_lokal() { runuser -u postgres -- psql -qtA -d postgres "$@" 2>/dev/null; }

echo "Hajime-Cluster, dieser Knoten: $KNOTEN"

echo "App"
STATUS="$(curl -fsS -m 3 "http://127.0.0.1:$PORT/api/cluster/status?nurEigen=1" 2>/dev/null || true)"
if [ -n "$STATUS" ]; then
    ok "läuft: $(printf '%s' "$STATUS" | tr -d '\n' | cut -c1-200)"
else
    warn "App antwortet nicht auf http://127.0.0.1:$PORT/api/cluster/status (systemctl status hajime-pro)"
fi
if curl -fsS -m 3 "http://127.0.0.1:$PORT/api/cluster/gesund" >/dev/null 2>&1; then ok "Gesundheitscheck (/api/cluster/gesund) ok"; else warn "Gesundheitscheck meldet 'nicht gesund' (PostgreSQL oder Zeuge nicht erreichbar, oder Rückstufung offen)"; fi

echo "PostgreSQL"
if [ "$(id -u)" -ne 0 ]; then
    warn "als root ausführen für den PostgreSQL-Status"
else
    IN_RECOVERY="$(psql_lokal -c 'SELECT pg_is_in_recovery()')"
    case "$IN_RECOVERY" in
        f)
            ok "Rolle: Master"
            ANZAHL="$(psql_lokal -c "SELECT count(*) FROM pg_stat_replication WHERE state = 'streaming'")"
            SYNC="$(psql_lokal -c "SELECT string_agg(application_name || '=' || sync_state, ', ') FROM pg_stat_replication")"
            if [ "${ANZAHL:-0}" -ge 1 ]; then ok "Replikation: $SYNC"; else warn "kein Standby verbunden (Replikation läuft nicht)"; fi
            ;;
        t)
            ok "Rolle: Standby"
            WAL="$(psql_lokal -c 'SELECT status FROM pg_stat_wal_receiver')"
            if [ "$WAL" = "streaming" ]; then ok "folgt dem Master (streaming)"; else warn "Replikation: ${WAL:-keine Verbindung zum Master}"; fi
            ;;
        *) warn "PostgreSQL antwortet nicht" ;;
    esac
fi

echo "keepalived / virtuelle IP${VIP:+ ($VIP)}"
if systemctl is-active --quiet keepalived; then
    ok "keepalived läuft"
    if [ -n "$VIP" ]; then
        if ip -o addr show | grep -q " $VIP/"; then ok "dieser Knoten hält die VIP"; else ok "die VIP liegt auf dem Partner"; fi
    fi
else
    warn "keepalived läuft nicht"
fi

echo "Partner"
if [ -n "$PARTNER_URL" ]; then
    if curl -fsS -m 3 "$PARTNER_URL/api/cluster/status?nurEigen=1" >/dev/null 2>&1; then ok "Partner-App erreichbar ($PARTNER_URL)"; else warn "Partner-App nicht erreichbar ($PARTNER_URL)"; fi
fi
if [ -n "$PARTNER_HOST" ] && command -v pg_isready >/dev/null; then
    if pg_isready -q -h "$PARTNER_HOST" -t 3; then ok "Partner-PostgreSQL erreichbar"; else warn "Partner-PostgreSQL nicht erreichbar ($PARTNER_HOST:5432)"; fi
fi

echo
if [ "$PROBLEME" -eq 0 ]; then echo "Ergebnis: alles in Ordnung."; else echo "Ergebnis: $PROBLEME Auffälligkeit(en)."; fi
exit $((PROBLEME > 0))
