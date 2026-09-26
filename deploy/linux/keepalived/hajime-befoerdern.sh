#!/bin/bash
# keepalived notify_master: dieser Server hält jetzt die VIP. Die App befördert PostgreSQL
# (pg_promote), erhöht die Epoche, startet Brücke und Abgleich und nimmt Schreibzugriffe an.
# Wiederholt, falls die App gerade startet; lehnt die App ab (veraltet, Rückstufung erforderlich),
# meldet /api/cluster/gesund "ungesund" und keepalived gibt die VIP wieder ab.
for versuch in $(seq 1 30); do
    if /usr/bin/curl -fs -m 90 -X POST http://127.0.0.1:3000/api/cluster/befoerdern; then
        logger -t hajime "Beförderung abgeschlossen"
        exit 0
    fi
    sleep 1
done
logger -t hajime "Beförderung fehlgeschlagen"
exit 1
