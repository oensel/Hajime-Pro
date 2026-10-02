// Gemeinsame Konfiguration der Cluster-Suite (Spec Abschnitt 12, ohne Docker): zwei lokale
// PostgreSQL-Instanzen (Binaries aus embedded-postgres), zwei Hallen-Server, ein Client-Gerät und
// der Leitstand (leitstand.js), der keepalived, die VIP (HTTP-Proxy) und den Zeugen simuliert.
import path from 'path';
import { fileURLToPath } from 'url';

export const PROJEKT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BASIS = path.join(PROJEKT, 'data', 'test-cluster');
export const SECRET = 'cluster-test-geheimnis';

export const LEITSTAND_PORT = 3309;
export const LEITSTAND_URL = `http://127.0.0.1:${LEITSTAND_PORT}`;
export const VIP_PORT = 3310;
export const VIP_URL = `http://127.0.0.1:${VIP_PORT}`;
export const CLIENT_PORT = 3313;
export const CLIENT_URL = `http://127.0.0.1:${CLIENT_PORT}`;

export const KNOTEN = {
    server1: { name: 'server1', partner: 'server2', appPort: 3311, pgPort: 5511, prioritaet: 150 },
    server2: { name: 'server2', partner: 'server1', appPort: 3312, pgPort: 5512, prioritaet: 100 }
};
for (const k of Object.values(KNOTEN)) {
    k.url = `http://127.0.0.1:${k.appPort}`;
    k.pgDir = path.join(BASIS, `pg-${k.name}`);
    k.dokumente = path.join(BASIS, `dokumente-${k.name}`);
}

export const DB_NAME = 'hajime';

export function serverEnv(name) {
    const k = KNOTEN[name];
    const p = KNOTEN[k.partner];
    return {
        ...process.env,
        BETRIEBSMODUS: 'server',
        IS_OFFLINE: '',
        DB_CLIENT: 'pg',
        DB_HOST: '127.0.0.1',
        DB_PORT: String(k.pgPort),
        DB_USER: 'postgres',
        DB_PASSWORD: 'unbenutzt', // pg_hba: trust
        DB_NAME,
        PORT: String(k.appPort),
        SYNC_ROLLE: '',
        SYNC_DATENVERZEICHNIS: k.dokumente,
        SYNC_SECRET: SECRET,
        MDNS_AKTIV: 'false',
        PORT80_WEITERLEITUNG: 'false',
        NODE_ENV: 'test',
        CLUSTER_KNOTEN: name,
        CLUSTER_PARTNER_URL: p.url,
        CLUSTER_VIP: VIP_URL,
        CLUSTER_ZEUGE: `${LEITSTAND_URL}/zeuge/${name}`,
        CLUSTER_RUECKSTUFEN_BEFEHL: `node "${path.join(PROJEKT, 'tests', 'e2e-cluster', 'rueckstufen.js')}" ${name}`,
        STEUERUNG_PASSWORD: '',
        SMTP_HOST: ''
    };
}

export function clientEnv() {
    return {
        ...process.env,
        BETRIEBSMODUS: 'client',
        IS_OFFLINE: '',
        PORT: String(CLIENT_PORT),
        SYNC_ROLLE: '',
        SYNC_SERVER_URL: VIP_URL,
        SYNC_SECRET: SECRET,
        SYNC_DATENVERZEICHNIS: path.join(BASIS, 'dokumente-client'),
        NODE_ENV: 'test',
        STEUERUNG_PASSWORD: '',
        SMTP_HOST: ''
    };
}
