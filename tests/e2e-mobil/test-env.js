// Konfiguration der Mobil-Suite (Android-App im Browser). Zwei Prozesse: ein Hallen-Server (wie in der
// Sync-Suite, eigener Port/PostgreSQL/Dokument-Verzeichnis) und ein statischer Server, der das Web-
// Verzeichnis der App (scripts/baue-android-www.mjs) unter einer eigenen Herkunft ausliefert — wie die
// Capacitor-WebView (http://localhost) ruft die App den Hallen-Server dadurch cross-origin auf.
export const SERVER_PORT = 3400;
export const SERVER_URL = `http://localhost:${SERVER_PORT}`;
export const APP_PORT = 3401;
export const APP_URL = `http://localhost:${APP_PORT}`;
export const TEST_PG_VERZEICHNIS = './data/test-mobil-pg';
export const TEST_PG_PORT = 5603;
export const TEST_DOKUMENTE = './data/test-mobil-dokumente';
export const TEST_DOWNLOADS = './data/test-mobil-downloads';
export const APP_WWW = './data/test-mobil-www';
export const TEST_SECRET = 'test-geheimnis-mobil';

export const serverEnv = {
    ...process.env,
    BETRIEBSMODUS: 'server',
    IS_OFFLINE: '',
    DB_CLIENT: '',
    DB_HOST: '',
    DB_URL: '',
    DATABASE_URL: '',
    DB_PORT: String(TEST_PG_PORT),
    DB_NAME: 'hajime_mobil',
    PG_DATENVERZEICHNIS: TEST_PG_VERZEICHNIS,
    PORT: String(SERVER_PORT),
    SYNC_ROLLE: '',
    SYNC_DATENVERZEICHNIS: TEST_DOKUMENTE,
    SYNC_SECRET: TEST_SECRET,
    MDNS_AKTIV: 'false',
    PORT80_WEITERLEITUNG: 'false',
    CLIENT_DOWNLOADS_VERZEICHNIS: TEST_DOWNLOADS,
    NODE_ENV: 'test',
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: ''
};
