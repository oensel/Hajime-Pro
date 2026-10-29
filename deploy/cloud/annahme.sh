#!/usr/bin/env bash
# Annahme für die Pipeline (release.yml, Job "cloud-ausrollen"): wird per SSH als erzwungener Befehl (command="…" in
# /root/.ssh/authorized_keys) aufgerufen und ist damit das Einzige, was der Deploy-Schlüssel ausführen darf.
# Aufruf der Pipeline:  ssh root@<Server> <Commit-Hash> < quellstand.tgz   (git archive des getesteten Commits)
# Der Hash kommt in SSH_ORIGINAL_COMMAND an und wird streng geprüft; das Archiv wird entpackt und danach nicht ein Skript aus dem
# Archiv, sondern das fest installierte, root-eigene /usr/local/sbin/hajime-aufspielen ausgeführt: Der Deploy-Schlüssel führt so
# kein Skript aus, das er selbst mitbringt. Weicht deploy/cloud/aufspielen.sh im Archiv davon ab, steht ein Hinweis im Log; das
# installierte Skript muss dann von Hand erneuert werden (deploy/cloud/README.md).
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

aufspielen=/usr/local/sbin/hajime-aufspielen
if [ ! -x "$aufspielen" ]; then
    echo "Auf dem Server fehlt $aufspielen (Einrichtung: deploy/cloud/README.md)." >&2
    exit 2
fi
if ! cmp -s "$verzeichnis/deploy/cloud/aufspielen.sh" "$aufspielen"; then
    echo "Hinweis: deploy/cloud/aufspielen.sh im Quellstand weicht vom installierten $aufspielen ab; ausgeführt wird das installierte." >&2
fi
exec bash "$aufspielen" "$commit" "$verzeichnis"
