// Migriert die (in playwright.sync.config.js vor dem Serverstart gelöschte) SQLite-Datei der
// Sync-Suite. Ein vorher fehlgeschlagener Initialisierungsversuch des Servers (Client fragt beim
// Start sofort den Status ab) wird beim nächsten Request automatisch wiederholt.
import path from 'path';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { SYNC_TEST_SQLITE_PATH } from './test-env.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default async function globalSetup() {
    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: path.resolve(projectRoot, SYNC_TEST_SQLITE_PATH) },
        useNullAsDefault: true,
        migrations: { directory: path.resolve(projectRoot, 'migrations') }
    });
    try {
        await knex.migrate.latest();
    } finally {
        await knex.destroy();
    }
}
