import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

test('Migration legt Sync-Spalten und sync_angewendet an', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        assert.equal(await knex.schema.hasColumn('turniere', 'instanz_id'), true);
        assert.equal(await knex.schema.hasColumn('turnier_teilnehmer', 'dokument_id'), true);
        assert.equal(await knex.schema.hasTable('sync_angewendet'), true);
        await knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' });
        await assert.rejects(knex('sync_angewendet').insert({ doc_id: 'kampf:1', rev: '1-a' }));
    } finally {
        await db.stoppe();
    }
});
