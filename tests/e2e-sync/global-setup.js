// Setzt SQLite-Datei und Dokument-Verzeichnis der Sync-Suite vor jedem Lauf zurück.
import { existsSync, unlinkSync, rmSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import knexLib from 'knex';
import { SYNC_TEST_SQLITE_PATH, SYNC_TEST_DOKUMENTE } from './test-env.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default async function globalSetup() {
    const dbPath = path.resolve(projectRoot, SYNC_TEST_SQLITE_PATH);
    if (existsSync(dbPath)) unlinkSync(dbPath);
    rmSync(path.resolve(projectRoot, SYNC_TEST_DOKUMENTE), { recursive: true, force: true });

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
