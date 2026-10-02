#!/usr/bin/env bash
# Integrationstest für deploy/linux/install-cluster.sh: zwei Debian-Container mit systemd (wie zwei Hallen-Server),
# Skript auf beiden ausführen, Replikation und Failover (server1 stoppen -> server2 wird Master, VIP wandert) prüfen.
# Braucht Docker (privilegierte Container); läuft in der CI (Job "cluster-installation"), lokal nur mit Docker-Daemon.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${CLUSTER_TEST_IMAGE:-jrei/systemd-debian:12}"
NETZ=hajime-cluster-test
S1=hajime-test-s1; S2=hajime-test-s2
IP1=172.30.0.11; IP2=172.30.0.12; VIP=172.30.0.10

aufraeumen() { docker rm -f "$S1" "$S2" >/dev/null 2>&1 || true; docker network rm "$NETZ" >/dev/null 2>&1 || true; }
trap aufraeumen EXIT
aufraeumen
docker network create --subnet 172.30.0.0/24 "$NETZ" >/dev/null

starte() { # name ip
    docker run -d --name "$1" --hostname "$1" --privileged --cgroupns=host --network "$NETZ" --ip "$2" \
        -v /sys/fs/cgroup:/sys/fs/cgroup:rw -v "$PWD":/quelle:ro "$IMAGE" >/dev/null
}
starte "$S1" "$IP1"; starte "$S2" "$IP2"
for c in "$S1" "$S2"; do
    for _ in $(seq 1 30); do docker exec "$c" systemctl is-system-running 2>/dev/null | grep -qE 'running|degraded' && break; sleep 1; done
    docker exec "$c" bash -c 'apt-get update -qq && apt-get install -y -qq rsync >/dev/null'
done

installiere() { # container knoten eigene partner
    docker exec "$1" bash /quelle/deploy/linux/install-cluster.sh --knoten "$2" --eigene-ip "$3" --partner-ip "$4" --vip "$VIP" \
        --zeuge "$IP2" --schnittstelle eth0
}
echo "== server1 einrichten"; installiere "$S1" server1 "$IP1" "$IP2"
docker cp "$S1":/root/hajime-cluster-geheimnisse.env - | docker cp - "$S2":/root/
echo "== server2 einrichten"; installiere "$S2" server2 "$IP2" "$IP1"

fehler=0
pruefe() { # beschreibung befehl...
    local b="$1"; shift
    if "$@" >/dev/null 2>&1; then echo "OK      $b"; else echo "FEHLER  $b"; fehler=$((fehler + 1)); fi
}
psql_in() { docker exec "$1" runuser -u postgres -- psql -qtA -d postgres -c "$2"; }
warte() { for _ in $(seq 1 "$1"); do "${@:2}" >/dev/null 2>&1 && return 0; sleep 1; done; return 1; }

pruefe "server1 ist PostgreSQL-Master" bash -c "[ \"\$(docker exec $S1 runuser -u postgres -- psql -qtA -d postgres -c 'select pg_is_in_recovery()')\" = f ]"
pruefe "server2 ist PostgreSQL-Standby" bash -c "[ \"\$(docker exec $S2 runuser -u postgres -- psql -qtA -d postgres -c 'select pg_is_in_recovery()')\" = t ]"
pruefe "Replikation streamt" warte 30 bash -c "[ \"\$(docker exec $S1 runuser -u postgres -- psql -qtA -d postgres -c \"select count(*) from pg_stat_replication where state='streaming'\")\" = 1 ]"
pruefe "VIP liegt auf server1" warte 30 docker exec "$S1" bash -c "ip -o addr | grep -q ' $VIP/'"
pruefe "Schema auf server2 repliziert" warte 30 bash -c "docker exec $S2 runuser -u postgres -- psql -qtA -d hajime -c 'select 1 from vereine limit 1'"
pruefe "App server1 antwortet" warte 60 curl -fs "http://$IP1:3000/api/cluster/status"

echo "== Failover: server1 stoppen"
docker stop "$S1" >/dev/null
pruefe "server2 wird PostgreSQL-Master" warte 60 bash -c "[ \"\$(docker exec $S2 runuser -u postgres -- psql -qtA -d postgres -c 'select pg_is_in_recovery()')\" = f ]"
pruefe "VIP wandert auf server2" warte 60 docker exec "$S2" bash -c "ip -o addr | grep -q ' $VIP/'"
pruefe "App über die VIP erreichbar" warte 60 curl -fs "http://$VIP:3000/api/cluster/status"

if [ "$fehler" -ne 0 ]; then
    echo "--- Logs server2"; docker exec "$S2" journalctl -u hajime-pro -u keepalived --no-pager -n 60 || true
    echo "ERGEBNIS: $fehler Prüfung(en) fehlgeschlagen"; exit 1
fi
echo "ERGEBNIS: alles OK"
