#!/usr/bin/env bash
# Annahme für die Pipeline (release.yml, Job "cloud-ausrollen"): wird per SSH als erzwungener Befehl (command="…" in
# /root/.ssh/authorized_keys) aufgerufen und ist damit das Einzige, was der Deploy-Schlüssel ausführen darf.
# Aufruf der Pipeline:  ssh root@<Server> <Commit-Hash> < quellstand.tgz   (git archive des getesteten Commits)
# Der Hash kommt in SSH_ORIGINAL_COMMAND an und wird streng geprüft; das Archiv wird entpackt und deploy/cloud/aufspielen.sh
# daraus (als Kopie, weil das Skript beim Tausch des Ordners selbst verschoben würde) ausgeführt.
# Einrichtung: deploy/cloud/README.md. Installation: /usr/local/sbin/hajime-annahme (root, 0755).
set -euo pipefail

commit="${SSH_ORIGINAL_COMMAND:-}"
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Ungültiger Aufruf: erwartet wird der volle Commit-Hash." >&2
    exit 2
fi

eingang=/root/deploy
verzeichnis="$eingang/$commit"
rm -rf "$verzeichnis"
mkdir -p "$verzeichnis"
tar xzf - -C "$verzeichnis" --no-same-owner

if [ ! -f "$verzeichnis/deploy/cloud/aufspielen.sh" ] || [ ! -f "$verzeichnis/package.json" ]; then
    echo "Das Archiv enthält keinen vollständigen Quellstand." >&2
    exit 2
fi

cp "$verzeichnis/deploy/cloud/aufspielen.sh" "$eingang/aufspielen.aktuell.sh"
exec bash "$eingang/aufspielen.aktuell.sh" "$commit" "$verzeichnis"
