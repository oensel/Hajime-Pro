// Gemeinsame Konfiguration der Sync-Suite (Hallen-Server mit SYNC_ROLLE=server). Eigener Port,
// eigene SQLite-Datei und eigenes Dokument-Verzeichnis, damit sie neben npm run test:e2e und einem
// Dev-Server laufen kann.
export const SYNC_TEST_PORT = 3200;
export const SYNC_BASE_URL = `http://localhost:${SYNC_TEST_PORT}`;
export const SYNC_TEST_SQLITE_PATH = './data/test-sync.sqlite';
export const SYNC_TEST_DOKUMENTE = './data/test-sync-dokumente';
export const SYNC_TEST_DOWNLOADS = './data/test-sync-downloads';
export const SYNC_TEST_SECRET = 'test-geheimnis';

// Client-Knoten (Notebook an der Matte/Waage) für die Offline-Szenarien.
export const CLIENT_TEST_PORT = 3201;
export const CLIENT_BASE_URL = `http://localhost:${CLIENT_TEST_PORT}`;
export const CLIENT_TEST_DOKUMENTE = './data/test-sync-client';

export const syncServerEnv = {
    ...process.env,
    BETRIEBSMODUS: 'server',
    IS_OFFLINE: '',
    DB_CLIENT: 'sqlite',
    DB_SQLITE_PATH: SYNC_TEST_SQLITE_PATH,
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
