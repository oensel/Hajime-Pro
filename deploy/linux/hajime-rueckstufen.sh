#!/bin/bash
# Baut die lokale PostgreSQL als Standby des Partner-Servers neu auf (Rückstufung eines veralteten
# Masters, Spec CouchDB-Umbau Abschnitt 9). Aufgerufen von der App (CLUSTER_RUECKSTUFEN_BEFEHL,
# Standard "sudo -n /usr/local/bin/hajime-rueckstufen.sh"), wenn der Partner mit höherer Epoche
# Master ist. Erst pg_rewind (schnell, nur die abweichenden Blöcke), bei Fehlschlag pg_basebackup.
#
# Konfiguration: /etc/hajime/cluster.env (siehe README.md)
#   CLUSTER_KNOTEN=server1|server2      eigener Name = application_name im Standby
#   PARTNER_PG_HOST=192.168.10.12       feste IP des Partners
#   PG_VERSION=17                       Debian-Paketversion
#   REPL_USER=replikator                Replikationsnutzer (Passwort in ~postgres/.pgpass)
set -euo pipefail

source /etc/hajime/cluster.env
PG_VERSION="${PG_VERSION:-17}"
REPL_USER="${REPL_USER:-replikator}"
PGDATA="/var/lib/postgresql/${PG_VERSION}/main"
PGBIN="/usr/lib/postgresql/${PG_VERSION}/bin"
QUELLE="host=${PARTNER_PG_HOST} port=5432 user=${REPL_USER} dbname=postgres"
CONNINFO="host=${PARTNER_PG_HOST} port=5432 user=${REPL_USER} application_name=${CLUSTER_KNOTEN}"

als_postgres() { runuser -u postgres -- "$@"; }

echo "[rueckstufen] PostgreSQL ${PG_VERSION} wird gestoppt"
systemctl stop "postgresql@${PG_VERSION}-main"

echo "[rueckstufen] pg_rewind gegen ${PARTNER_PG_HOST}"
if ! als_postgres "${PGBIN}/pg_rewind" --target-pgdata="${PGDATA}" --source-server="${QUELLE}" --progress; then
    echo "[rueckstufen] pg_rewind fehlgeschlagen – vollständiger Neuaufbau per pg_basebackup"
    SICHERUNG="${PGDATA}.alt-$(date +%Y%m%d-%H%M%S)"
    mv "${PGDATA}" "${SICHERUNG}"
    als_postgres "${PGBIN}/pg_basebackup" -h "${PARTNER_PG_HOST}" -U "${REPL_USER}" -D "${PGDATA}" -X stream -c fast -P
    echo "[rueckstufen] altes Datenverzeichnis gesichert unter ${SICHERUNG}"
fi

# Standby-Konfiguration: dem Partner folgen, eigene Synchron-Einstellung verwerfen (sie kann vom
# früheren Master stammen und auf mich selbst zeigen).
als_postgres touch "${PGDATA}/standby.signal"
als_postgres bash -c "cat > '${PGDATA}/postgresql.auto.conf'" <<EOF
# Von hajime-rueckstufen.sh geschrieben ($(date -Iseconds))
primary_conninfo = '${CONNINFO}'
recovery_target_timeline = 'latest'
synchronous_standby_names = ''
EOF

echo "[rueckstufen] PostgreSQL startet als Standby von ${PARTNER_PG_HOST}"
systemctl start "postgresql@${PG_VERSION}-main"
echo "[rueckstufen] fertig"
