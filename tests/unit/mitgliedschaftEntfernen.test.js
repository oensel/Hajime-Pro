import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin entfernt eine Vereinszuordnung; mit vereinBehalten bleibt auch ein Verein ohne Mitglieder bestehen.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { entferneMitglied } = await import('../../src/services/vereinsRollen.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('Zuordnung entfernen: Verein bleibt bestehen, Fehler für Nicht-Mitglieder', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const a = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'U', ist_super_admin: true, super_admin_modus: true },
            { id: 'u-ziel', email: 'ziel@test.de', vorname: 'Z', nachname: 'Iel', aktiver_verein_id: a }
        ]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-ziel', verein_id: a, freigegeben: 1, rolle: 'admin' });

        assert.deepEqual(await entferneMitglied(knex, { vereinId: a, benutzerId: 'u-ziel', durchId: 'u-super', vereinBehalten: true }), { ok: true, vereinGeloescht: false });
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: 'u-ziel' })).length, 0);
        assert.ok(await knex('vereine').where({ id: a }).first());
        assert.equal((await knex('benutzer').where({ id: 'u-ziel' }).first()).aktiver_verein_id, null);

        const nochmal = await entferneMitglied(knex, { vereinId: a, benutzerId: 'u-ziel', durchId: 'u-super', vereinBehalten: true });
        assert.equal(nochmal.ok, false);
        assert.equal(nochmal.status, 404);
    } finally {
        await db.stoppe();
    }
});
