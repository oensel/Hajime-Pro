// Gemeinsame Konfiguration für playwright.config.js UND global-setup.js — ein einziger Ort für
// Port/DB-Pfad/Umgebungsvariablen, damit beide garantiert denselben Test-Server/dieselbe
// Test-Datenbank ansprechen.
//
// Eigener Port (3100 statt 3000) UND eigenes eingebettetes PostgreSQL (data/test-pg, Port 5601), damit die
// E2E-Suite parallel zu einem lokal laufenden Dev-Server bzw. zu manuellen Tests in der App laufen kann, ohne
// dessen Zustand zu beeinflussen. Das PostgreSQL startet tests/helpers/pg-dienst.mjs (erster webServer-Eintrag
// in playwright.config.js) frisch und migriert; globalTeardown stoppt es.
export const TEST_PORT = 3100;
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const TEST_PG_VERZEICHNIS = './data/test-pg';
export const TEST_PG_PORT = 5601;
export const TEST_PG_BEREIT_PORT = 5611;
export const TEST_PG_DB = 'hajime_e2e';

export const pgDienstEnv = {
    ...process.env,
    PG_DIENST_VERZEICHNIS: TEST_PG_VERZEICHNIS,
    PG_DIENST_PORT: String(TEST_PG_PORT),
    PG_DIENST_DB: TEST_PG_DB,
    PG_DIENST_BEREIT_PORT: String(TEST_PG_BEREIT_PORT)
};

// Verbindung für Specs, die Fixtures direkt in der Test-Datenbank anlegen (HTTP-API allein reicht dort nicht).
export const testDbVerbindung = {
    host: '127.0.0.1', port: TEST_PG_PORT, user: 'postgres', password: '', database: TEST_PG_DB
};

export const testServerEnv = {
    ...process.env,
    IS_OFFLINE: 'true',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(TEST_PG_PORT),
    DB_USER: 'postgres',
    DB_PASSWORD: '',
    DB_NAME: TEST_PG_DB,
    DB_URL: '',
    DATABASE_URL: '',
    PORT: String(TEST_PORT),
    // Leer statt undefined: überschreibt eine evtl. in .env gesetzte STEUERUNG_PASSWORD
    // ausdrücklich (dotenv.config() in src/app.js überschreibt bereits gesetzte process.env-
    // Werte nicht) — Tests laufen so ohne das Kontroll-Passwort-Modal aus menu.js.
    STEUERUNG_PASSWORD: '',
    // Ebenso ausdrücklich geleert: ohne SMTP_HOST loggt sendeMail (siehe src/utils/mailer.js) nur
    // statt zu versenden. Sonst würde ein Testlauf, sobald in der lokalen .env irgendwann echte
    // SMTP-Zugangsdaten stehen, bei jeder Registrierungs-/Beitritts-Anfrage tatsächlich Mails
    // verschicken.
    SMTP_HOST: '',
    // Ebenso: eine lokale .env für den Hallen-Server-Betrieb (SYNC_ROLLE=server, CLUSTER_KNOTEN) würde den
    // Testserver sonst mit Sync betreiben — dort löscht das Anlegen eines Turniers das bisherige. Die Suite
    // braucht den Hallen-Server ohne Sync/Cluster.
    DB_CLIENT: '',
    SYNC_ROLLE: '',
    CLUSTER_KNOTEN: '',
    // Diese Suite läuft bewusst mit den ALTVARIABLEN (IS_OFFLINE=true) und deckt so den Altpfad von
    // src/config/betriebsmodus.cjs ab; die Sync- und die Cluster-Suite nutzen den neuen BETRIEBSMODUS.
    BETRIEBSMODUS: ''
};
