# shellcheck shell=bash
# Wird von install.sh und install-cluster.sh eingelesen (source): übernimmt den Cloud-Zugang, den holen.sh im Quellordner
# abgelegt hat. Der Geräteschlüssel (Updates ohne Handarbeit, Spec docs/specs/2026-10-24-downloads-ueber-cloud-design.md) kommt nach
# <Installation>/data/release-schluessel, die Cloud-Adresse dient als CLOUD_URL.

# liese_release_url QUELLE -> gibt die Cloud-Adresse aus (leer, wenn es keine gibt)
liese_release_url() {
    if [ -f "$1/.hajime-release-url" ]; then tr -d ' \r\n' < "$1/.hajime-release-url"; fi
}

# uebernehme_release_schluessel QUELLE INSTALL_DIR APP_USER
uebernehme_release_schluessel() {
    local quelle="$1" ziel="$2" benutzer="$3"
    [ -f "$quelle/.hajime-release-schluessel" ] || return 0
    mkdir -p "$ziel/data"
    install -o "$benutzer" -g "$benutzer" -m 600 "$quelle/.hajime-release-schluessel" "$ziel/data/release-schluessel"
}
