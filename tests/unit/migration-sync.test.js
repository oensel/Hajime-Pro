import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import knexLib from 'knex';

test('Migration legt Sync-Spalten und sync_angewendet an', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hajime-mig-'));
    const knex = knexLib({
        client: 'sqlite3',
        connection: { filename: path.join(dir, 't.sqlite') },
        useNullAsDefault: true,
        migrations: { directory: path.resolve('migrations') }
    });
    try {
        await knex.migrate.latest();
        assert.equal(await knex.schema.hasColumn('turniere', 'instanz_id'), true);
        assert.equal(await knex.schema.hasColumn('turnier_teilnehmer', 'dokument_id'), true);
        assert.equal(await knex.schema.hasTable('sync_angewendet'), true);
        await knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' });
        await assert.rejects(knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' }));
    } finally {
        await knex.destroy();
        rmSync(dir, { recursive: true, force: true });
    }
});
