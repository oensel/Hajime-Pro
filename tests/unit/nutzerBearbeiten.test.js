import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin: Benutzer ändern, löschen und ein Initialpasswort vergeben (das beim nächsten Anmelden geändert werden muss).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'nutzer-bearbeiten-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getNutzerRoutes } = await import('../../src/routes/nutzerRoutes.js');
const { updateProfile, getMe } = await import('../../src/controllers/authController.js');
const { hashPassword, verifyPassword } = await import('../../src/utils/password.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

test('Nutzer bearbeiten, löschen, Initialpasswort: Rechte, Prüfungen, Schutz des letzten Super-Admins', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.use(express.json());
    app.use('/api/nutzer', getNutzerRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}/api/nutzer`;
    const aufruf = async (benutzerId, pfad, methode = 'GET', body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: {
                'Content-Type': 'application/json',
                ...(benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    try {
        const verein = id((await knex('vereine').insert({ name: 'JC Bearbeiten' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'Su', nachname: 'Per', ist_super_admin: true, password_hash: hashPassword('super-passwort'), email_bestaetigt_am: knex.fn.now() },
            { id: 'u-normal', email: 'normal@test.de', vorname: 'No', nachname: 'Rmal', password_hash: hashPassword('altes-passwort'), email_bestaetigt_am: knex.fn.now() },
            { id: 'u-neu', email: 'neu@test.de', vorname: 'Ne', nachname: 'U', password_hash: hashPassword('irgendwas1') }, // E-Mail unbestätigt
            { id: 'u-weg', email: 'weg@test.de', vorname: 'We', nachname: 'G', password_hash: hashPassword('irgendwas2'), email_bestaetigt_am: knex.fn.now() }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-normal', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-weg', verein_id: verein, freigegeben: 1, rolle: 'helfer' }
        ]);

        // --- Rechte: nur Super-Admins
        assert.equal((await aufruf(null, '/u-neu', 'PUT', { vorname: 'a', nachname: 'b', email: 'c@d.de' })).status, 401);
        assert.equal((await aufruf('u-normal', '/u-neu', 'PUT', { vorname: 'a', nachname: 'b', email: 'c@d.de' })).status, 403);
        assert.equal((await aufruf('u-normal', '/u-neu', 'DELETE')).status, 403);
        assert.equal((await aufruf('u-normal', '/u-neu/passwort', 'POST', { passwort: 'langes-passwort' })).status, 403);

        // --- Ändern: Pflichtfelder, Format, Dublette, Erfolg (E-Mail klein und getrimmt)
        assert.equal((await aufruf('u-super', '/u-neu', 'PUT', { vorname: '', nachname: 'b', email: 'c@d.de' })).status, 400);
        assert.equal((await aufruf('u-super', '/u-neu', 'PUT', { vorname: 'a', nachname: 'b', email: 'keine-mail' })).status, 400);
        assert.equal((await aufruf('u-super', '/u-neu', 'PUT', { vorname: 'a'.repeat(256), nachname: 'b', email: 'c@d.de' })).status, 400);
        assert.equal((await aufruf('u-super', '/u-neu', 'PUT', { vorname: 'a', nachname: 'b', email: ' NORMAL@test.de ' })).status, 409);
        assert.equal((await aufruf('u-super', '/u-gibtsnicht', 'PUT', { vorname: 'a', nachname: 'b', email: 'x@y.de' })).status, 404);
        const geaendert = await aufruf('u-super', '/u-neu', 'PUT', { vorname: ' Nina ', nachname: 'Neu', email: ' Nina.Neu@Test.DE ' });
        assert.equal(geaendert.status, 200);
        assert.deepEqual(geaendert.daten, { success: true, vorname: 'Nina', nachname: 'Neu', email: 'nina.neu@test.de' });
        assert.equal((await knex('benutzer').where({ id: 'u-neu' }).first()).email, 'nina.neu@test.de');
        // die eigene E-Mail unverändert zu speichern ist keine Dublette
        assert.equal((await aufruf('u-super', '/u-super', 'PUT', { vorname: 'Su', nachname: 'Per', email: 'super@test.de' })).status, 200);

        // --- Initialpasswort: Mindestlänge, setzt Hash und Pflicht zur Änderung, bestätigt ein unbestätigtes Konto
        assert.equal((await aufruf('u-super', '/u-neu/passwort', 'POST', { passwort: 'kurz' })).status, 400);
        assert.equal((await aufruf('u-super', '/u-neu/passwort', 'POST', {})).status, 400);
        assert.equal((await aufruf('u-super', '/u-gibtsnicht/passwort', 'POST', { passwort: 'langes-passwort' })).status, 404);
        const gesetzt = await aufruf('u-super', '/u-neu/passwort', 'POST', { passwort: 'Start-Passwort-1' });
        assert.deepEqual(gesetzt.daten, { success: true, aendernErforderlich: true });
        let neu = await knex('benutzer').where({ id: 'u-neu' }).first();
        assert.ok(verifyPassword('Start-Passwort-1', neu.password_hash));
        assert.equal(neu.muss_passwort_aendern, true);
        assert.ok(neu.email_bestaetigt_am, 'unbestätigtes Konto gilt nun als freigegeben');

        // ohne Pflicht zur Änderung
        const ohnePflicht = await aufruf('u-super', '/u-normal/passwort', 'POST', { passwort: 'Anderes-Passwort-2', aendernErforderlich: false });
        assert.equal(ohnePflicht.daten.aendernErforderlich, false);
        assert.equal((await knex('benutzer').where({ id: 'u-normal' }).first()).muss_passwort_aendern, false);

        // Die Anmeldeantwort (getMe) meldet die Pflicht, das Ändern des Passworts im Profil hebt sie auf
        const me = fakeRes();
        await getMe(knex, { user: { id: 'u-neu' } }, me);
        assert.equal(me.body.user.muss_passwort_aendern, true);
        const profil = fakeRes();
        await updateProfile(knex, { user: { id: 'u-neu' }, body: { vorname: 'Nina', nachname: 'Neu', email: 'nina.neu@test.de', currentPassword: 'Start-Passwort-1', newPassword: 'Mein-eigenes-Passwort-3' } }, profil);
        assert.equal(profil.statusCode, 200, JSON.stringify(profil.body));
        assert.equal(profil.body.user.muss_passwort_aendern, false);
        neu = await knex('benutzer').where({ id: 'u-neu' }).first();
        assert.equal(neu.muss_passwort_aendern, false);
        assert.ok(verifyPassword('Mein-eigenes-Passwort-3', neu.password_hash));
        // Profil ohne neues Passwort lässt die Pflicht bestehen
        await aufruf('u-super', '/u-neu/passwort', 'POST', { passwort: 'Start-Passwort-4' });
        const profilOhne = fakeRes();
        await updateProfile(knex, { user: { id: 'u-neu' }, body: { vorname: 'Nina', nachname: 'Neu', email: 'nina.neu@test.de', currentPassword: 'Start-Passwort-4' } }, profilOhne);
        assert.equal(profilOhne.body.user.muss_passwort_aendern, true);

        // --- Löschen: nicht das eigene, nicht der letzte Super-Admin, sonst samt Mitgliedschaften
        assert.equal((await aufruf('u-super', '/u-super', 'DELETE')).status, 409);
        assert.equal((await aufruf('u-super', '/u-gibtsnicht', 'DELETE')).status, 404);
        await knex('benutzer').insert({ id: 'u-super2', email: 'super2@test.de', vorname: 'S', nachname: 'Zwei', ist_super_admin: true, password_hash: 'x' });
        const weg = await aufruf('u-super', '/u-weg', 'DELETE');
        assert.equal(weg.status, 200);
        assert.equal(await knex('benutzer').where({ id: 'u-weg' }).first() ?? null, null);
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: 'u-weg' })).length, 0);
        // Ein weiterer Super-Admin darf gelöscht werden, solange einer übrig bleibt
        assert.equal((await aufruf('u-super', '/u-super2', 'DELETE')).status, 200);
        // u-super ist wieder der einzige: ein anderer Super-Admin-Konto-Löschversuch zeigt den Schutz
        await knex('benutzer').where({ id: 'u-normal' }).update({ ist_super_admin: true });
        const letzter = await aufruf('u-normal', '/u-super', 'DELETE');
        assert.equal(letzter.status, 200); // zwei Super-Admins (u-super, u-normal): u-super darf gelöscht werden
        assert.equal((await aufruf('u-normal', '/u-normal', 'DELETE')).status, 409); // eigenes Konto
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
