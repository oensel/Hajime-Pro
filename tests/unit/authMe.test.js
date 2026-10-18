import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// /api/auth/me und /api/auth/login liefern die Rolle im aktiven Verein (verein_rolle) und je Verein
// (vereine[].rolle); verein_wartet_auf_super_admin gilt, solange der Verein keinen freigegebenen ADMIN hat
// (Helferverwaltung, Spec 4), auch wenn andere Mitglieder schon freigegeben sind.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { getMe, login } = await import('../../src/controllers/authController.js');
const { hashPassword } = await import('../../src/utils/password.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function me(knex, userId) {
    const res = fakeRes();
    await getMe(knex, { user: { id: userId } }, res);
    assert.equal(res.statusCode, 200);
    return res.body.user;
}

test('getMe/login: Rollen und Warten auf den Super-Admin', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const ohneAdmin = id((await knex('vereine').insert({ name: 'JC Ohne Admin' }).returning('id'))[0]);
        const mitAdmin = id((await knex('vereine').insert({ name: 'JC Mit Admin' }).returning('id'))[0]);
        for (const b of ['wartend', 'benutzer', 'wartend2', 'admin', 'helfer']) {
            await knex('benutzer').insert({
                id: `u-${b}`, email: `${b}@test.de`, vorname: b, nachname: 'Test',
                password_hash: hashPassword('geheim123'), email_bestaetigt_am: knex.fn.now()
            });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-wartend', verein_id: ohneAdmin, freigegeben: 0 },
            // freigegebenes Mitglied, aber kein Admin: der Verein hat weiter keinen Admin
            { benutzer_id: 'u-benutzer', verein_id: ohneAdmin, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-wartend2', verein_id: mitAdmin, freigegeben: 0 },
            { benutzer_id: 'u-admin', verein_id: mitAdmin, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-helfer', verein_id: mitAdmin, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-helfer', verein_id: ohneAdmin, freigegeben: 1, rolle: 'benutzer' }
        ]);
        await knex('benutzer').whereIn('id', ['u-wartend', 'u-benutzer']).update({ aktiver_verein_id: ohneAdmin });
        await knex('benutzer').whereIn('id', ['u-wartend2', 'u-admin', 'u-helfer']).update({ aktiver_verein_id: mitAdmin });

        const wartend = await me(knex, 'u-wartend');
        assert.equal(wartend.verein_freigegeben, false);
        assert.equal(wartend.verein_wartet_auf_super_admin, true, 'Verein ohne Admin, obwohl ein Mitglied freigegeben ist');
        assert.equal(wartend.verein_rolle, null);

        const wartend2 = await me(knex, 'u-wartend2');
        assert.equal(wartend2.verein_wartet_auf_super_admin, false, 'Verein mit Admin');

        const helfer = await me(knex, 'u-helfer');
        assert.equal(helfer.verein_rolle, 'helfer');
        assert.deepEqual(helfer.vereine.map(v => [v.name, v.rolle]), [['JC Mit Admin', 'helfer'], ['JC Ohne Admin', 'benutzer']]);
        assert.equal(helfer.ist_super_admin, false);

        assert.equal((await me(knex, 'u-admin')).verein_rolle, 'admin');

        const res = fakeRes();
        await login(knex, { body: { email: 'helfer@test.de', password: 'geheim123' } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.user.verein_rolle, 'helfer');
        assert.equal(res.body.user.ist_super_admin, false);
        assert.deepEqual(res.body.user.vereine.map(v => v.rolle), ['helfer', 'benutzer']);
    } finally {
        await db.stoppe();
    }
});
