// Cluster-Einstellungen eines Hallen-Servers (Spec CouchDB-Umbau, Abschnitt 9). Ohne gültigen
// CLUSTER_KNOTEN ist der Cluster aus: der Server ist dann wie bisher immer Master.
const KNOTEN = ['server1', 'server2'];

export function liesClusterKonfig(env = process.env) {
    const knoten = KNOTEN.includes(env.CLUSTER_KNOTEN) ? env.CLUSTER_KNOTEN : null;
    return {
        aktiv: !!knoten,
        knoten,
        partnerKnoten: knoten ? KNOTEN.find(k => k !== knoten) : null,
        // Feste Adresse des anderen Servers (nicht die VIP), z.B. http://192.168.10.12:3000
        partnerUrl: (env.CLUSTER_PARTNER_URL || '').replace(/\/+$/, ''),
        vip: env.CLUSTER_VIP || '',
        // Zeuge gegen Split-Brain: IP (Ping) oder http(s)-URL (GET). Leer = Default-Gateway.
        zeuge: env.CLUSTER_ZEUGE || '',
        // Baut die eigene PostgreSQL als Standby des Partners neu auf (deploy/linux/hajime-rueckstufen.sh).
        rueckstufenBefehl: env.CLUSTER_RUECKSTUFEN_BEFEHL || 'sudo -n /usr/local/bin/hajime-rueckstufen.sh'
    };
}

// Im Cluster MUSS SYNC_SECRET gesetzt (und auf beiden Servern gleich) sein: ohne erzeugt jeder
// Server in kopplung.json sein eigenes Geheimnis — Partner-Replikation, Übergabe-Ankündigung und
// die Client-Geräte (nach einem Failover) scheitern dann still mit 401. Liefert die Fehlermeldung
// für den Startabbruch oder null.
export function clusterSecretFehler(clusterKonfig, secret) {
    if (!clusterKonfig || !clusterKonfig.aktiv) return null;
    if (String(secret || '').trim()) return null;
    return `[Cluster] SYNC_SECRET fehlt: Im Server-Cluster (CLUSTER_KNOTEN=${clusterKonfig.knoten}) muss SYNC_SECRET in der .env gesetzt und auf beiden Servern gleich sein. Server wird nicht gestartet.`;
}
