#!/bin/bash
# keepalived notify_backup/notify_fault/notify_stop: VIP verloren. Die App stoppt Brücke und
# Abgleich und nimmt keine Schreibzugriffe mehr an. PostgreSQL wird erst umgebaut, wenn der
# Partner tatsächlich mit höherer Epoche Master geworden ist (macht die App selbst).
/usr/bin/curl -fs -m 30 -X POST http://127.0.0.1:3000/api/cluster/zurueckstufen || true
logger -t hajime "VIP abgegeben"
