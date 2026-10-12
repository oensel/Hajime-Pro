import test from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

test('Migration: live_freigabe-Spalte und Views im Schema live', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        assert.equal(await knex.schema.hasColumn('turniere', 'live_freigabe'), true);
        const [{ id: turnierId }] = await knex('turniere').insert({
            bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A'
        }).returning('id');
        const t = await knex('turniere').where({ id: turnierId }).first();
        assert.equal(t.live_freigabe, false);

        await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster',
            geschlecht: 'w', verein: 'JC Muster', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012
        });

        const zeilen = await knex.raw('select * from live.teilnehmer');
        assert.equal(zeilen.rows.length, 1);
        const z = zeilen.rows[0];
        assert.equal(z.vorname, 'Anna');
        assert.match(z.passnummer_hash, /^[0-9a-f]{64}$/);
        for (const verboten of ['judopass_id', 'gewicht', 'geburtsjahr', 'geburtsdatum', 'iban', 'email']) {
            assert.equal(verboten in z, false, `Spalte ${verboten} darf nicht in live.teilnehmer stehen`);
        }
        for (const view of ['turniere', 'kampfflaechen', 'pools', 'kaempfe']) {
            const r = await knex.raw(`select * from live.${view} limit 0`);
            assert.ok(Array.isArray(r.fields), view);
        }
    } finally {
        await db.stoppe();
    }
});
