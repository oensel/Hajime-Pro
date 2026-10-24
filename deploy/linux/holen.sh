#!/usr/bin/env bash
# Hajime Pro – holt das Linux-Dienst-Paket (kein Git, kein Zugang zum Quellcode nötig). Quelle ist die Cloud, sobald ein
# Geräteschlüssel vorliegt (RELEASE_URL + RELEASE_SCHLUESSEL, oder bei einer vorhandenen Installation deren data/release-schluessel und
# CLOUD_URL aus der .env); sonst bis zur Umstellung das öffentliche Release-Repository.
#
#   Cloud (den Befehl samt Schlüssel erzeugt die Seite „Downloads“):
#   curl -fsSL -H "Authorization: Bearer <Schlüssel>" <Cloud>/api/releases/v1/assets/<Version>/hajime-holen.sh | sudo RELEASE_URL=<Cloud> RELEASE_SCHLUESSEL=<Schlüssel> bash
#   Bisher (GitHub):
#   curl -fsSL https://github.com/oensel/Hajime-Pro-Releases/releases/latest/download/hajime-holen.sh | sudo bash
#   cd /opt/hajime-quelle && sudo bash deploy/linux/install.sh          # Einzelserver
#   cd /opt/hajime-quelle && sudo bash deploy/linux/install-cluster.sh ...   # Cluster, siehe deploy/linux/README.md
#
# Lädt Hajime-Pro-Dienst-<version>.tar.gz, prüft die SHA-256-Summe aus SHA256SUMS-Server.txt und entpackt das Paket nach
# QUELLE_DIR. Ein vorhandener Ordner wird aktualisiert (ein .git darin bleibt unberührt); die Installation unter
# /opt/hajime-pro ändert erst install.sh. Die Ed25519-Signatur prüft später der Dienst selbst beim Selbst-Update.
#
# Umgebungsvariablen: VERSION (x.y.z, Standard: neuestes Release), QUELLE_DIR (/opt/hajime-quelle),
# CLIENT_RELEASE_REPO (oensel/Hajime-Pro-Releases), CLIENT_RELEASE_TOKEN (nur falls das Repository privat ist),
# RELEASE_URL, RELEASE_SCHLUESSEL (Cloud), INSTALL_DIR (/opt/hajime-pro: dort liegt bei einer Installation der Geräteschlüssel).
set -euo pipefail

tmp=""   # global, damit das trap beim Beenden (nach main) es noch kennt

main() {
    local repo="${CLIENT_RELEASE_REPO:-oensel/Hajime-Pro-Releases}"
    local ziel="${QUELLE_DIR:-/opt/hajime-quelle}"
    local version="${VERSION:-}"
    version="${version#v}"
    local auth=()
    [ -z "${CLIENT_RELEASE_TOKEN:-}" ] || auth=(-H "Authorization: Bearer $CLIENT_RELEASE_TOKEN")
    # Cloud statt GitHub, sobald Adresse und Geräteschlüssel bekannt sind (Umgebung, sonst die vorhandene Installation).
    local installdir="${INSTALL_DIR:-/opt/hajime-pro}" rurl="${RELEASE_URL:-}" rkey="${RELEASE_SCHLUESSEL:-}" cloud=0
    if [ -z "$rkey" ] && [ -f "$installdir/data/release-schluessel" ]; then rkey="$(tr -d ' \r\n' < "$installdir/data/release-schluessel")"; fi
    if [ -z "$rurl" ] && [ -f "$installdir/.env" ]; then rurl="$(grep -E '^(RELEASE_URL|CLOUD_URL)=' "$installdir/.env" | head -n1 | cut -d= -f2- | tr -d '\r' || true)"; fi
    rurl="${rurl%/}"
    if [ -n "$rurl" ] && [ -n "$rkey" ]; then cloud=1; auth=(-H "Authorization: Bearer $rkey"); fi

    fehler() { printf '\033[1;31mFehler: %s\033[0m\n' "$*" >&2; exit 1; }
    [ "$(id -u)" -eq 0 ] || fehler "Als root ausführen (sudo)."
    for b in curl tar sha256sum; do
        command -v "$b" >/dev/null || fehler "$b fehlt (apt-get update && apt-get install -y curl ca-certificates tar coreutils)."
    done

    if [ -z "$version" ] && [ "$cloud" = 1 ]; then
        local json
        json="$(curl -fsSL "${auth[@]}" "$rurl/api/releases/v1/repos/cloud/releases/latest")" \
            || fehler "Neuestes Release von $rurl nicht erreichbar (Geräteschlüssel gültig? Konto noch freigeschaltet?)."
        version="$(printf '%s' "$json" | sed -n 's/.*"tag_name":"v\{0,1\}\([0-9.]*\)".*/\1/p' | head -n1)"
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Kein Release in der Cloud gefunden."
    elif [ -z "$version" ]; then
        local ende
        ende="$(curl -fsSIL "${auth[@]}" -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")" \
            || fehler "Neuestes Release von $repo nicht erreichbar."
        version="${ende##*/v}"
        [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Kein Release in $repo gefunden."
    fi
    [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fehler "Ungültige Version: $version"

    local basis="https://github.com/$repo/releases/download/v$version"
    [ "$cloud" != 1 ] || basis="$rurl/api/releases/v1/assets/$version"
    local paket="Hajime-Pro-Dienst-$version.tar.gz"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT

    echo "==> Hajime Pro $version aus $([ "$cloud" = 1 ] && echo "$rurl" || echo "$repo") holen"
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
    # Alter Inhalt weg (ein .git bleibt), dann das neue Paket darüber: ohne rsync, damit auf einem frischen System nichts nachzuinstallieren ist.
    find "$ziel" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
    cp -a "$tmp/neu/hajime-pro"/. "$ziel"/
    # Cloud-Zugang für install.sh/install-cluster.sh merken (dort wandert er nach <Installation>/data/release-schluessel und in die .env).
    if [ "$cloud" = 1 ]; then
        printf '%s\n' "$rurl" > "$ziel/.hajime-release-url"
        (umask 077; printf '%s\n' "$rkey" > "$ziel/.hajime-release-schluessel")
    fi
    echo "    Version $version liegt in $ziel"
}

main "$@"
exit $?
