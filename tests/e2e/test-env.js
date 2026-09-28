// Gemeinsame Konfiguration für playwright.config.js UND global-setup.js — ein einziger Ort für
// Port/DB-Pfad/Umgebungsvariablen, damit beide garantiert denselben Test-Server/dieselbe
// Test-Datenbank ansprechen.
//
// Eigener Port (3100 statt 3000) UND eigene SQLite-Datei (data/test.sqlite statt
// data/turnier.sqlite), damit die E2E-Suite parallel zu einem lokal laufenden Dev-Server bzw.
// zu manuellen Tests in der App laufen kann, ohne dessen Zustand zu beeinflussen.
export const TEST_PORT = 3100;
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const TEST_SQLITE_PATH = './data/test.sqlite';

export const testServerEnv = {
    ...process.env,
    IS_OFFLINE: 'true',
    DB_SQLITE_PATH: TEST_SQLITE_PATH,
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
    // Ebenso: eine lokale .env für den Hallen-Server-Betrieb (DB_CLIENT=pg, SYNC_ROLLE=server,
    // CLUSTER_KNOTEN) würde den Testserver sonst gegen das lokale PostgreSQL statt gegen
    // data/test.sqlite laufen lassen — im Sync-Modus löscht das Anlegen eines Turniers dort das
    // bisherige. Die Suite braucht den reinen SQLite-Offline-Server ohne Sync/Cluster.
    DB_CLIENT: '',
    SYNC_ROLLE: '',
    CLUSTER_KNOTEN: ''
};
