import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin weist einem Konto Verein und Rolle zu (weiseMitgliedschaftZu).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { weiseMitgliedschaftZu } = await import('../../src/services/vereinsRollen.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('Mitgliedschaft zuweisen: neu, offene Anfrage freigeben, Rolle ändern, Rechte und Fehler', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const a = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const b = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'U', ist_super_admin: true, super_admin_modus: true },
            { id: 'u-ziel', email: 'ziel@test.de', vorname: 'Z', nachname: 'Iel' },
            { id: 'u-admin', email: 'admin@test.de', vorname: 'A', nachname: 'Dmin' }
        ]);
        await knex('benutzer_vereine').insert([{ benutzer_id: 'u-admin', verein_id: a, freigegeben: 1, rolle: 'admin' }]);
        const zuweisen = (extra) => weiseMitgliedschaftZu(knex, { benutzerId: 'u-ziel', vereinId: a, rolle: 'benutzer', durchId: 'u-super', ...extra });
        const zeile = (v) => knex('benutzer_vereine').where({ benutzer_id: 'u-ziel', verein_id: v }).first();

        // Neu: freigegeben mit Rolle, wird aktiver Verein
        assert.deepEqual(await zuweisen({}), { ok: true, aktion: 'angelegt' });
        const neu = await zeile(a);
        assert.equal(neu.freigegeben, 1);
        assert.equal(neu.rolle, 'benutzer');
        assert.equal(neu.entschieden_von, 'u-super');
        assert.equal((await knex('benutzer').where({ id: 'u-ziel' }).first()).aktiver_verein_id, a);

        // Rolle ändern; ein zweiter Verein ändert den aktiven Verein nicht
        assert.deepEqual(await zuweisen({ rolle: 'helfer' }), { ok: true, aktion: 'rolle' });
        assert.equal((await zeile(a)).rolle, 'helfer');
        assert.deepEqual(await zuweisen({ vereinId: b, rolle: 'admin' }), { ok: true, aktion: 'angelegt' });
        assert.equal((await knex('benutzer').where({ id: 'u-ziel' }).first()).aktiver_verein_id, a);

        // Offene Anfrage wird freigegeben
        await knex('benutzer').insert({ id: 'u-wartet', email: 'wartet@test.de', vorname: 'W', nachname: 'Artet' });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-wartet', verein_id: a, freigegeben: 0 });
        assert.deepEqual(await weiseMitgliedschaftZu(knex, { benutzerId: 'u-wartet', vereinId: a, rolle: 'helfer', durchId: 'u-super' }), { ok: true, aktion: 'freigegeben' });
        const frei = await knex('benutzer_vereine').where({ benutzer_id: 'u-wartet', verein_id: a }).first();
        assert.equal(frei.freigegeben, 1);
        assert.equal(frei.rolle, 'helfer');

        // Fehler: kein Super-Admin, ungültige Rolle, unbekannter Verein/Konto, ungültige Vereins-ID
        assert.equal((await zuweisen({ durchId: 'u-admin' })).status, 403);
        assert.equal((await zuweisen({ rolle: 'chef' })).status, 400);
        assert.equal((await zuweisen({ vereinId: 99999 })).status, 404);
        assert.equal((await zuweisen({ benutzerId: 'gibt-es-nicht' })).status, 404);
        assert.equal((await zuweisen({ vereinId: 'abc' })).status, 400);
        // Im Vereinsmodus (Modus aus) darf auch ein Super-Admin nicht zuweisen
        await knex('benutzer').where({ id: 'u-super' }).update({ super_admin_modus: false });
        assert.equal((await zuweisen({})).status, 403);
    } finally {
        await db.stoppe();
    }
});
