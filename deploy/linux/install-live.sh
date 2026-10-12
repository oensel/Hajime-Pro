#!/usr/bin/env bash
# Installiert den Live-Uplink auf dem Slave (Teilnehmer-App Phase 1). Als root ausführen.
#   sudo bash deploy/linux/install-live.sh --cloud-url https://... --cloud-ip 1.2.3.4 --usb-if usb0 --dns-ip 192.168.42.129
# --dns-ip: der DNS-Server, den das USB-/Starlink-Netz vergibt (nicht der der Fritz!Box im LAN), z. B. das Gateway des
# Tethering-Geräts; die Firewall lässt über die Internet-Schnittstelle nur diesen DNS-Server zu.
# Voraussetzung: Hajime Pro liegt unter /opt/hajime-pro, die Migration (Schema "live") ist am Master gelaufen.
set -euo pipefail

CLOUD_URL=""; CLOUD_IP=""; USB_IF=""; DNS_IP=""
while [ $# -gt 0 ]; do
    case "$1" in
        --cloud-url) CLOUD_URL="$2"; shift 2 ;;
        --cloud-ip)  CLOUD_IP="$2";  shift 2 ;;
        --usb-if)    USB_IF="$2";    shift 2 ;;
        --dns-ip)    DNS_IP="$2";    shift 2 ;;
        *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
    esac
done
[ -n "$CLOUD_URL" ] && [ -n "$CLOUD_IP" ] && [ -n "$USB_IF" ] && [ -n "$DNS_IP" ] \
    || { echo "Pflicht: --cloud-url --cloud-ip --usb-if --dns-ip" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen." >&2; exit 1; }

BASIS=/opt/hajime-pro
ENV_DATEI="$BASIS/live.env"

# Eigener Systembenutzer: der internetseitige Prozess darf die .env der App (Datenbank-Admin, Steuerungs-Passwort,
# SYNC_SECRET) nicht lesen können.
id hajime-live >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin hajime-live
[ -f "$BASIS/.env" ] && chmod 600 "$BASIS/.env"

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
LIVE_ZUSTAND_DATEI=/var/lib/hajime-live/gesendet.json
EOT
    chown hajime-live:hajime-live "$ENV_DATEI"
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

# Firewall nur für die Internet-Schnittstelle; wird beim Systemstart geladen (nftables-Dienst + Include).
install -d /etc/nftables.d
sed -e "s|@USB_IF@|$USB_IF|g" -e "s|@CLOUD_IP@|$CLOUD_IP|g" -e "s|@DNS_IP@|$DNS_IP|g" \
    "$BASIS/deploy/linux/live/nftables-live.conf" > /etc/nftables.d/hajime-live.conf
touch /etc/nftables.conf
grep -q '^include "/etc/nftables.d/\*.conf"' /etc/nftables.conf \
    || echo 'include "/etc/nftables.d/*.conf"' >> /etc/nftables.conf
systemctl enable nftables
nft -f /etc/nftables.d/hajime-live.conf

install -m 0644 "$BASIS/deploy/linux/systemd/hajime-live.service" /etc/systemd/system/hajime-live.service
systemctl daemon-reload
systemctl enable --now hajime-live.service
echo "Live-Uplink läuft: journalctl -u hajime-live -f"
