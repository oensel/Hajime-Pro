import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// PUT /api/auth/profile: E-Mail-Adressen werden wie bei der Registrierung normalisiert (getrimmt, klein) gespeichert
// und ohne Beachtung der Schreibweise auf Dubletten geprüft; das neue Passwort braucht MIN_PASSWORT_LAENGE Zeichen.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { updateProfile } = await import('../../src/controllers/authController.js');
const { hashPassword } = await import('../../src/utils/password.js');

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function aendere(knex, userId, body) {
    const res = fakeRes();
    await updateProfile(knex, { user: { id: userId }, body }, res);
    return res;
}

test('updateProfile: E-Mail normalisiert, Dubletten ohne Schreibweise, Passwortlänge', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        await knex('benutzer').insert([
            { id: 'u-anna', email: 'anna@test.de', vorname: 'Anna', nachname: 'A', password_hash: hashPassword('geheim123'), email_bestaetigt_am: knex.fn.now() },
            // Bestandskonto mit Großbuchstaben
            { id: 'u-bert', email: 'Bert@Test.DE', vorname: 'Bert', nachname: 'B', password_hash: hashPassword('geheim123'), email_bestaetigt_am: knex.fn.now() }
        ]);
        const basis = { vorname: 'Anna', nachname: 'A', currentPassword: 'geheim123' };

        // fremde Adresse in anderer Schreibweise → 409, nichts geändert
        const r409 = await aendere(knex, 'u-anna', { ...basis, email: ' bert@test.de ' });
        assert.equal(r409.statusCode, 409);
        const r409b = await aendere(knex, 'u-bert', { ...basis, vorname: 'Bert', email: 'ANNA@test.de' });
        assert.equal(r409b.statusCode, 409);
        assert.equal((await knex('benutzer').where({ id: 'u-anna' }).first()).email, 'anna@test.de');

        // eigene Adresse in anderer Schreibweise → ok, normalisiert gespeichert
        const rBert = await aendere(knex, 'u-bert', { ...basis, vorname: 'Bert', email: '  BERT@test.de ' });
        assert.equal(rBert.statusCode, 200, JSON.stringify(rBert.body));
        assert.equal((await knex('benutzer').where({ id: 'u-bert' }).first()).email, 'bert@test.de');
        const rAnna = await aendere(knex, 'u-anna', { ...basis, email: 'Anna.Neu@Test.de' });
        assert.equal(rAnna.statusCode, 200);
        assert.equal((await knex('benutzer').where({ id: 'u-anna' }).first()).email, 'anna.neu@test.de');

        // neues Passwort mit 7 Zeichen → 400, mit 8 ok
        const kurz = await aendere(knex, 'u-anna', { ...basis, email: 'anna.neu@test.de', newPassword: '1234567' });
        assert.equal(kurz.statusCode, 400);
        assert.match(kurz.body.error, /mindestens 8 Zeichen/);
        const lang = await aendere(knex, 'u-anna', { ...basis, email: 'anna.neu@test.de', newPassword: '12345678' });
        assert.equal(lang.statusCode, 200);
    } finally {
        await db.stoppe();
    }
});
