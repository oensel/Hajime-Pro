#!/usr/bin/env bash
# Installiert den Live-Uplink auf dem Slave (Teilnehmer-App Phase 1). Als root ausführen.
#   sudo bash deploy/linux/install-live.sh --cloud-url https://... --cloud-ip 1.2.3.4 --usb-if usb0 [--dns-ip 192.168.178.1]
# Voraussetzung: Hajime Pro liegt unter /opt/hajime-pro, die Migration (Schema "live") ist am Master gelaufen.
set -euo pipefail

CLOUD_URL=""; CLOUD_IP=""; USB_IF=""; DNS_IP="192.168.178.1"
while [ $# -gt 0 ]; do
    case "$1" in
        --cloud-url) CLOUD_URL="$2"; shift 2 ;;
        --cloud-ip)  CLOUD_IP="$2";  shift 2 ;;
        --usb-if)    USB_IF="$2";    shift 2 ;;
        --dns-ip)    DNS_IP="$2";    shift 2 ;;
        *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    esac
done
[ -n "$CLOUD_URL" ] && [ -n "$CLOUD_IP" ] && [ -n "$USB_IF" ] || { echo "Pflicht: --cloud-url --cloud-ip --usb-if" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }

BASIS=/opt/hajime-pro
ENV_DATEI="$BASIS/live.env"

if [ ! -f "$ENV_DATEI" ]; then
    DB_PASSWORT="$(openssl rand -hex 16)"
    SCHLUESSEL="$(openssl rand -hex 32)"
    TOKEN="$(openssl rand -hex 32)"
    umask 077
    cat > "$ENV_DATEI" <<EOT
LIVE_DB_HOST=127.0.0.1
LIVE_DB_PORT=5432
LIVE_DB_NAME=hajime
LIVE_DB_USER=live_ro
LIVE_DB_PASSWORD=$DB_PASSWORT
LIVE_UPLINK_URL=$CLOUD_URL
LIVE_UPLINK_TOKEN=$TOKEN
LIVE_SCHLUESSEL=$SCHLUESSEL
LIVE_INTERVALL_MS=5000
EOT
    chown hajime:hajime "$ENV_DATEI"
    echo "live.env angelegt. LIVE_UPLINK_TOKEN in der Cloud hinterlegen: $TOKEN"
fi

# Die Rolle live_ro entsteht NICHT hier: der Standby ist schreibgeschützt. Sie wird am Master angelegt und
# repliziert zum Slave (Rollen und ihre Einstellungen liegen in den replizierten Systemkatalogen).
. "$ENV_DATEI"
echo "Am MASTER ausführen (mit Administrator-Zugang, z. B. postgres):"
echo "  cd $BASIS && DB_ADMIN_USER=postgres DB_ADMIN_PASSWORD=... LIVE_DB_PASSWORD='$LIVE_DB_PASSWORD' npm run live:rolle"

# Keine Weiterleitung zwischen den Netzen.
echo "net.ipv4.ip_forward=0" > /etc/sysctl.d/90-hajime-live.conf
sysctl -p /etc/sysctl.d/90-hajime-live.conf

# Firewall nur für die Internet-Schnittstelle.
install -d /etc/nftables.d
sed -e "s|@USB_IF@|$USB_IF|g" -e "s|@CLOUD_IP@|$CLOUD_IP|g" -e "s|@DNS_IP@|$DNS_IP|g" \
    "$BASIS/deploy/linux/live/nftables-live.conf" > /etc/nftables.d/hajime-live.conf
nft -f /etc/nftables.d/hajime-live.conf

install -m 0644 "$BASIS/deploy/linux/systemd/hajime-live.service" /etc/systemd/system/hajime-live.service
systemctl daemon-reload
systemctl enable --now hajime-live.service
echo "Live-Uplink läuft: journalctl -u hajime-live -f"
