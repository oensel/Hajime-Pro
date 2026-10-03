// Gemeinsame Konfiguration für playwright.vollablauf.config.js UND die Setup/Teardown-Skripte
// dieser Suite — analog zu tests/e2e/test-env.js, aber für ZWEI echte Serverprozesse statt einem:
// ein Online-Server gegen die echte Cloud-Postgres-DB aus .env (siehe knexfile.cjs "online") und
// ein Offline-Server gegen ein eigenes, frisches eingebettetes PostgreSQL. Bewusst eigene Ports/DB-Datei,
// getrennt von tests/e2e/test-env.js, damit dieser (viel langsamere, gegen echte Cloud-Daten
// schreibende) Lauf niemals versehentlich denselben Prozess/Zustand wie die normale E2E-Suite
// berührt.
export const ONLINE_PORT = 3200;
export const OFFLINE_PORT = 3201;
export const ONLINE_BASE_URL = `http://localhost:${ONLINE_PORT}`;
export const OFFLINE_BASE_URL = `http://localhost:${OFFLINE_PORT}`;
export const OFFLINE_PG_VERZEICHNIS = './data/vollablauf-offline-pg';
export const OFFLINE_PG_PORT = 5603;
export const OFFLINE_PG_BEREIT_PORT = 5613;
export const OFFLINE_PG_DB = 'hajime_vollablauf';

export const pgDienstEnv = {
    ...process.env,
    PG_DIENST_VERZEICHNIS: OFFLINE_PG_VERZEICHNIS,
    PG_DIENST_PORT: String(OFFLINE_PG_PORT),
    PG_DIENST_DB: OFFLINE_PG_DB,
    PG_DIENST_BEREIT_PORT: String(OFFLINE_PG_BEREIT_PORT)
};

// Fester Testwert, NICHT aus process.env übernommen: der echte Online-Server legt beim Start
// (ensureSuperAdmin, siehe src/utils/superAdmin.js) idempotent judo@bastian-haas.com an — auf der
// echten Cloud-DB existiert dieses Konto mit hoher Wahrscheinlichkeit bereits mit einem echten,
// uns unbekannten Passwort, SUPER_ADMIN_INITIAL_PASSWORD hätte dann keine Wirkung (siehe Kommentar
// in superAdmin.js: das Passwort wird nur beim allerersten Anlegen gesetzt). Der Testlauf loggt
// sich deshalb NICHT als Super-Admin ein, sondern setzt die Verein-Freigabe für die drei
// selbst angelegten Test-Vereine direkt per Knex (siehe global-teardown.js/helpers.js) — dieser
// Wert wird dafür nicht gebraucht, bleibt hier nur dokumentiert, warum er in onlineServerEnv NICHT
// gesetzt wird.

export const onlineServerEnv = {
    ...process.env,
    IS_OFFLINE: 'false',
    PORT: String(ONLINE_PORT),
    // Reale Zugangsdaten (DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT, JWT_SECRET) werden bewusst
    // 1:1 aus der echten .env übernommen (process.env, s.o. Spread) — das ist genau die vom Nutzer
    // bestätigte echte Cloud-DB, gegen die dieser Testlauf schreiben soll.
    //
    // SMTP explizit deaktiviert: ohne SMTP_HOST loggt sendeMail (src/utils/mailer.js) nur, statt zu
    // versenden. Sonst würde jede Registrierung/jeder Vereinsbeitritt in diesem Testlauf eine ECHTE
    // Mail über den in .env hinterlegten SMTP-Account verschicken.
    SMTP_HOST: '',
    STEUERUNG_PASSWORD: ''
};

export const offlineServerEnv = {
    ...process.env,
    IS_OFFLINE: 'true',
    DB_HOST: '127.0.0.1',
    DB_PORT: String(OFFLINE_PG_PORT),
    DB_USER: 'postgres',
    DB_PASSWORD: '',
    DB_NAME: OFFLINE_PG_DB,
    DB_URL: '',
    DATABASE_URL: '',
    PORT: String(OFFLINE_PORT),
    STEUERUNG_PASSWORD: '',
    SMTP_HOST: ''
};
