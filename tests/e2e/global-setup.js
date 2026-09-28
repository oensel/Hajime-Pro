// Läuft einmalig vor der gesamten Testsuite (siehe globalSetup in playwright.config.js): setzt
// die Offline-Test-SQLite-Datenbank auf einen sauberen, vollständig migrierten Ausgangszustand
// zurück, damit jeder Testlauf reproduzierbar bei "keine Turniere/Teilnehmer vorhanden" beginnt.
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { TEST_SQLITE_PATH } from './test-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

export default async function globalSetup() {
    const dbPath = path.resolve(projectRoot, TEST_SQLITE_PATH);
    if (existsSync(dbPath)) {
        unlinkSync(dbPath);
    }
    // data/ ist git-ignoriert und fehlt in einem frischen Checkout (z.B. CI).
    mkdirSync(path.dirname(dbPath), { recursive: true });

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
