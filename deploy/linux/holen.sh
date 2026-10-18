#!/usr/bin/env bash
# Hajime Pro – holt das Linux-Dienst-Paket aus dem öffentlichen Release-Repository (kein Git, kein Zugang zum Quellcode nötig).
#
#   curl -fsSL https://github.com/oensel/Hajime-Pro-Releases/releases/latest/download/hajime-holen.sh | sudo bash
#   cd /opt/hajime-quelle && sudo bash deploy/linux/install.sh          # Einzelserver
#   cd /opt/hajime-quelle && sudo bash deploy/linux/install-cluster.sh ...   # Cluster, siehe deploy/linux/README.md
#
# Lädt Hajime-Pro-Dienst-<version>.tar.gz, prüft die SHA-256-Summe aus SHA256SUMS-Server.txt und entpackt das Paket nach
# QUELLE_DIR. Ein vorhandener Ordner wird aktualisiert (ein .git darin bleibt unberührt); die Installation unter
# /opt/hajime-pro ändert erst install.sh. Die Ed25519-Signatur prüft später der Dienst selbst beim Selbst-Update.
#
# Umgebungsvariablen: VERSION (x.y.z, Standard: neuestes Release), QUELLE_DIR (/opt/hajime-quelle),
# CLIENT_RELEASE_REPO (oensel/Hajime-Pro-Releases), CLIENT_RELEASE_TOKEN (nur falls das Repository privat ist).
set -euo pipefail

main() {
    local repo="${CLIENT_RELEASE_REPO:-oensel/Hajime-Pro-Releases}"
    local ziel="${QUELLE_DIR:-/opt/hajime-quelle}"
    local version="${VERSION:-}"
    version="${version#v}"
    local auth=()
    [ -z "${CLIENT_RELEASE_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $CLIENT_RELEASE_TOKEN")

    fehler() { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
    [ "$(id -u)" -eq 0 ] || fehler "Als root ausführen (sudo)."
    for b in curl tar rsync sha256sum; do
        command -v "$b" >/dev/null || { command -v apt-get >/dev/null && apt-get install -y -qq curl ca-certificates tar rsync coreutils >/dev/null; break; }
    done

    if [ -z "$version" ]; then
        local ende
        ende="$(curl -fsSIL "${auth[@]}" -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")" \
            || fehler "Neuestes Release von $repo nicht erreichbar."
        version="${ende##*/v}"
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Kein Release in $repo gefunden."
    fi
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Ungültige Version: $version"

    local basis="https://github.com/$repo/releases/download/v$version"
    local paket="Hajime-Pro-Dienst-$version.tar.gz"
    local tmp
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT

    echo "==> Hajime Pro $version aus $repo holen"
    curl -fsSL "${auth[@]}" -o "$tmp/$paket" "$basis/$paket" || fehler "$paket nicht gefunden ($basis)."
    curl -fsSL "${auth[@]}" -o "$tmp/SHA256SUMS-Server.txt" "$basis/SHA256SUMS-Server.txt" || fehler "SHA256SUMS-Server.txt nicht gefunden."
    local soll ist
    soll="$(awk -v n="$paket" '{ f=$2; sub(/^\*/, "", f); if (f == n) print $1 }' "$tmp/SHA256SUMS-Server.txt")"
    ist="$(sha256sum "$tmp/$paket" | cut -d' ' -f1)"
    [ -n "$soll" ] && [ "$soll" = "$ist" ] || fehler "Prüfsumme von $paket stimmt nicht – Download verworfen."

    mkdir "$tmp/neu"
    tar xzf "$tmp/$paket" -C "$tmp/neu"
    [ -f "$tmp/neu/hajime-pro/package.json" ] || fehler "Unerwarteter Paketinhalt."
    mkdir -p "$ziel"
    rsync -a --delete --exclude '.git' "$tmp/neu/hajime-pro"/ "$ziel"/
    echo "    Version $version liegt in $ziel"
}

main "$@"
exit $?
