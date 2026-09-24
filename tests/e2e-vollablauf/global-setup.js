// Läuft einmalig vor der Vollablauf-Suite (siehe globalSetup in playwright.vollablauf.config.js):
// setzt NUR die Offline-SQLite auf einen sauberen, migrierten Ausgangszustand zurück (analog
// tests/e2e/global-setup.js) — die Online-DB ist die echte Cloud-DB mit bereits existierendem
// Live-Schema und wird hier bewusst NICHT migriert/verändert. Initialisiert außerdem die
// Cleanup-Statusdatei (siehe run-state.js), damit ein wiederholter Lauf nicht mit den ID-Listen
// eines vorherigen (bereits aufgeräumten) Laufs startet.
import { existsSync, unlinkSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { OFFLINE_SQLITE_PATH, OFFLINE_COUCHDB_PATH } from './test-env.js';
import { initialisiereStatus } from './run-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

export default async function globalSetup() {
    initialisiereStatus();

    const dbPath = path.resolve(projectRoot, OFFLINE_SQLITE_PATH);
    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }

    const couchDataPath = path.resolve(projectRoot, OFFLINE_COUCHDB_PATH);
    rmSync(couchDataPath, { recursive: true, force: true });

    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: dbPath },
        useNullAsDefault: true,
        migrations: { directory: path.resolve(projectRoot, 'migrations') }
    });

    try {
        await knex.migrate.latest();
    } finally {
        await knex.destroy();
    }
}
