// Gemeinsame Konfiguration der Sync-Suite (Hallen-Server mit SYNC_ROLLE=server). Eigener Port, eigenes
// eingebettetes PostgreSQL (der Server startet es selbst, BETRIEBSMODUS=server ohne DB_HOST) und eigenes
// Dokument-Verzeichnis, damit sie neben npm run test:e2e und einem Dev-Server laufen kann.
//
// Shards: mit HAJIME_SYNC_SHARD=<n> (0, 1, 2 …, siehe shards.js und scripts/test-e2e-sync.mjs) bekommt ein
// Lauf sein eigenes Knotenpaar — Ports 3200+2n/3201+2n, PostgreSQL-Port 5602+n und Datenverzeichnisse mit
// Suffix "-n" —, damit mehrere Shards gleichzeitig laufen können (der Hallen-Server trägt nur EIN Turnier).
// Ohne die Variable läuft alles in einem Lauf mit den Ports/Pfaden von Shard 0 ohne Suffix.
const shardText = process.env.HAJIME_SYNC_SHARD;
export const SYNC_SHARD = shardText === undefined || shardText === '' ? null : Number(shardText);
if (SYNC_SHARD !== null && (!Number.isInteger(SYNC_SHARD) || SYNC_SHARD < 0)) {
    throw new Error(`HAJIME_SYNC_SHARD ungültig: "${shardText}"`);
}
const n = SYNC_SHARD ?? 0;
const suffix = SYNC_SHARD ? `-${SYNC_SHARD}` : '';

export const SYNC_TEST_PORT = 3200 + 2 * n;
export const SYNC_BASE_URL = `http://localhost:${SYNC_TEST_PORT}`;
export const SYNC_TEST_PG_VERZEICHNIS = `./data/test-sync-pg${suffix}`;
export const SYNC_TEST_PG_PORT = 5602 + n;
export const SYNC_TEST_DOKUMENTE = `./data/test-sync-dokumente${suffix}`;
export const SYNC_TEST_DOWNLOADS = `./data/test-sync-downloads${suffix}`;
export const SYNC_TEST_SECRET = 'test-geheimnis';

// Client-Knoten (Notebook an der Matte/Waage) für die Offline-Szenarien.
export const CLIENT_TEST_PORT = 3201 + 2 * n;
export const CLIENT_BASE_URL = `http://localhost:${CLIENT_TEST_PORT}`;
export const CLIENT_TEST_DOKUMENTE = `./data/test-sync-client${suffix}`;

export const syncServerEnv = {
    ...process.env,
    BETRIEBSMODUS: 'server',
    IS_OFFLINE: '',
    DB_CLIENT: '',
    DB_HOST: '',
    DB_URL: '',
    DATABASE_URL: '',
    DB_PORT: String(SYNC_TEST_PG_PORT),
    DB_NAME: 'hajime_sync',
    PG_DATENVERZEICHNIS: SYNC_TEST_PG_VERZEICHNIS,
    PORT: String(SYNC_TEST_PORT),
    SYNC_ROLLE: '',
    SYNC_DATENVERZEICHNIS: SYNC_TEST_DOKUMENTE,
    SYNC_SECRET: SYNC_TEST_SECRET,
    MDNS_AKTIV: 'false',
    PORT80_WEITERLEITUNG: 'false',
    CLIENT_DOWNLOADS_VERZEICHNIS: SYNC_TEST_DOWNLOADS,
    NODE_ENV: 'test',
    // Leer statt undefined, siehe tests/e2e/test-env.js (dotenv überschreibt gesetzte Werte nicht).
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: ''
};

export const clientEnv = {
    ...process.env,
    BETRIEBSMODUS: 'client',
    IS_OFFLINE: '',
    PORT: String(CLIENT_TEST_PORT),
    SYNC_ROLLE: '',
    SYNC_SERVER_URL: SYNC_BASE_URL,
    SYNC_SECRET: SYNC_TEST_SECRET,
    SYNC_DATENVERZEICHNIS: CLIENT_TEST_DOKUMENTE,
    NODE_ENV: 'test',
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: ''
};
