#!/usr/bin/env bash
# Spielt einen entpackten Quellstand auf diesen Cloud-Server (Docker Compose in /opt/hajime-pro, kein Git-Checkout).
# Aufruf: aufspielen.sh <Commit> <Verzeichnis des entpackten Quellstands>   (durch annahme.sh, siehe README.md)
# Läuft als root-eigene Kopie /usr/local/sbin/hajime-aufspielen, nicht aus dem hochgeladenen Archiv.
#
# Ablauf: Datenbank sichern -> neuen Stand an die Stelle von /opt/hajime-pro setzen (den alten als /opt/hajime-pro.alt behalten,
# die Dateien nur dieses Servers ziehen um) -> Image bauen, App neu starten -> auf "healthy" und eine Antwort der API warten.
# Schlägt eines davon fehl, kommt der alte Stand (Ordner und Image) zurück und das Skript endet mit Fehler. Datenbank-
# Migrationen laufen beim Start der App (DB_AUTO_MIGRATE) und sind nicht umkehrbar: war schon migriert, stellt man die
# Sicherung (/root/sicherung/*.dump) von Hand wieder her.
set -euo pipefail

COMMIT="${1:?Commit fehlt}"
NEU="${2:?Verzeichnis fehlt}"
ZIEL=/opt/hajime-pro
ALT=/opt/hajime-pro.alt
SICHERUNG=/root/sicherung
BEHALTE_SICHERUNGEN=10
APP=hajime-pro-app-1
DB=hajime-pro-db-1
IMAGE=hajime-pro-app
# Nur auf dem Server vorhandene Dateien (nicht im Repository): sie bleiben beim Austausch erhalten.
SERVER_DATEIEN=(.env.cloud .env.db docker-compose.prod.yml Caddyfile .commit)
COMPOSE=(docker compose -f docker-compose.prod.yml)

exec 9>/var/lock/hajime-deploy.lock
flock -n 9 || { echo "Es läuft bereits ein Ausrollen."; exit 1; }

schritt() { echo; echo "== $*"; }

warte_auf_gesund() {
    local status=""
    for _ in $(seq 1 36); do
        status=$(docker inspect -f '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo "fehlt")
        [ "$status" = "healthy" ] && return 0
        sleep 5
    done
    echo "App nicht gesund (Status: $status)"
    return 1
}

# Die App ist auf diesem Server nicht an den Host gebunden (nur Caddy erreicht sie über das Docker-Netz), daher fragt die Prüfung
# im Container.
pruefe_antwort() {
    for _ in $(seq 1 12); do
        docker exec "$APP" node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && return 0
        sleep 5
    done
    echo "Keine Antwort von /api/config"
    return 1
}

schritt "Vorprüfung"
for datei in "${SERVER_DATEIEN[@]}"; do
    # .commit entsteht erst nach dem ersten erfolgreichen Ausrollen
    if [ "$datei" != ".commit" ] && [ ! -f "$ZIEL/$datei" ]; then
        echo "Auf dem Server fehlt $ZIEL/$datei"
        exit 1
    fi
done
test -f "$NEU/package.json" && test -f "$NEU/Dockerfile" || { echo "Quellstand unvollständig"; exit 1; }
echo "Aktueller Stand: $(cat "$ZIEL/.commit" 2>/dev/null || echo unbekannt)  ->  neu: $COMMIT"

schritt "Datenbank sichern"
mkdir -p "$SICHERUNG"
chmod 700 "$SICHERUNG"
dump="$SICHERUNG/hajime-vor-deploy-$(date +%Y%m%d-%H%M%S)-${COMMIT:0:7}.dump"
docker exec "$DB" sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$dump"
test -s "$dump" || { echo "Sicherung ist leer"; rm -f "$dump"; exit 1; }
echo "Gesichert: $dump ($(du -h "$dump" | cut -f1))"

rueckrollen() {
    trap - ERR
    echo
    echo "!! Fehler, stelle den alten Stand wieder her."
    cd /
    if [ -d "$ALT" ]; then
        for datei in "${SERVER_DATEIEN[@]}"; do
            if [ -e "$ZIEL/$datei" ]; then mv "$ZIEL/$datei" "$ALT/$datei"; fi
        done
        rm -rf "$ZIEL.fehlgeschlagen"
        mv "$ZIEL" "$ZIEL.fehlgeschlagen"
        mv "$ALT" "$ZIEL"
    fi
    if docker image inspect "$IMAGE:vorher" > /dev/null 2>&1; then
        docker tag "$IMAGE:vorher" "$IMAGE:latest"
    fi
    cd "$ZIEL"
    "${COMPOSE[@]}" up -d --no-build app || true
    if warte_auf_gesund; then
        echo "Alter Stand läuft wieder."
    else
        echo "Auch der alte Stand ist nicht gesund, bitte von Hand prüfen."
    fi
    echo "Hinweis: Datenbank-Migrationen des neuen Stands wurden womöglich schon ausgeführt. Sicherung: $dump"
    exit 1
}

schritt "Neuen Stand einsetzen"
docker tag "$IMAGE:latest" "$IMAGE:vorher" 2>/dev/null || true
rm -rf "$ALT" "$ZIEL.fehlgeschlagen"
mv "$ZIEL" "$ALT"
mv "$NEU" "$ZIEL"
for datei in "${SERVER_DATEIEN[@]}"; do
    if [ -e "$ALT/$datei" ]; then mv "$ALT/$datei" "$ZIEL/$datei"; fi
done
# Dateien, die es nur im alten Stand gab, aber nicht aus dem Repository stammen: sichtbar machen statt stillschweigend zu verlieren.
(cd "$ALT" && find . -type f | sort) > /tmp/hajime-alt.liste
(cd "$ZIEL" && find . -type f | sort) > /tmp/hajime-neu.liste
fehlend=$(comm -23 /tmp/hajime-alt.liste /tmp/hajime-neu.liste | head -20 || true)
if [ -n "$fehlend" ]; then
    echo "Nur im alten Stand (liegen in $ALT, nicht übernommen):"
    echo "$fehlend"
fi
rm -f /tmp/hajime-alt.liste /tmp/hajime-neu.liste

cd "$ZIEL"
trap rueckrollen ERR
set -E

schritt "Image bauen"
"${COMPOSE[@]}" build app

schritt "App neu starten"
"${COMPOSE[@]}" up -d app
warte_auf_gesund
pruefe_antwort
if "${COMPOSE[@]}" logs app --since 5m 2>&1 | grep -q "Schema aktuell"; then
    echo "Datenbankschema ist aktuell."
fi

trap - ERR
echo "$COMMIT" > "$ZIEL/.commit"

schritt "Aufräumen"
ls -1t "$SICHERUNG"/hajime-vor-deploy-*.dump 2>/dev/null | tail -n +"$((BEHALTE_SICHERUNGEN + 1))" | xargs -r rm -f
docker image prune -f > /dev/null
docker builder prune -f --filter until=168h > /dev/null
rm -rf /root/deploy/*/ 2>/dev/null || true

echo
echo "Fertig: $COMMIT läuft."
