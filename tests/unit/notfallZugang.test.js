import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { verifyPassword } from '../../src/utils/password.js';
import {
    erzeugeNotfallSchluessel, notfallSchluesselStatus, nutzeNotfallSchluessel, MELDUNG_UNGUELTIG, SCHLUESSEL_BYTES
} from '../../src/services/notfallZugang.js';

test('Notfall-Schlüssel: erzeugen, nutzen, verbrauchen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    const sende = async (mail) => { mails.push(mail); };
    try {
        await knex('benutzer').insert([
            { id: 'sa', email: 'sa@test.de', vorname: 'Sa', nachname: 'Admin', password_hash: 'x:y', ist_super_admin: true, gesperrt: true, muss_passwort_aendern: true },
            { id: 'normal', email: 'normal@test.de', vorname: 'No', nachname: 'Rmal', password_hash: 'x:y' }
        ]);
        await knex('token_einmal').insert({ benutzer_id: 'sa', zweck: 'passwort', token_hash: 'abc', laeuft_ab_am: new Date(Date.now() + 3600_000) });

        await knex('benutzer').where({ id: 'sa' }).update({ totp_secret: 'geheim', totp_aktiv_am: knex.fn.now(), totp_letzter_schritt: 5 });
        await knex('totp_backup_codes').insert({ benutzer_id: 'sa', code_hash: 'a'.repeat(64) });

        assert.deepEqual(await notfallSchluesselStatus(knex), { vorhanden: false, erstellt: null });
        const schluessel = await erzeugeNotfallSchluessel(knex);
        assert.ok(schluessel.length >= 80, 'superlang');
        assert.equal(Buffer.from(schluessel, 'base64url').length, SCHLUESSEL_BYTES);
        assert.equal((await knex('notfall_schluessel')).length, 1);
        assert.equal((await knex('notfall_schluessel').first()).schluessel_hash.includes(schluessel), false, 'nur der Hash wird gespeichert');

        // falscher Schlüssel, normales Konto, unbekanntes Konto, schwaches Passwort: nichts passiert
        assert.deepEqual(await nutzeNotfallSchluessel(knex, { schluessel: 'falsch', email: 'sa@test.de', passwort: 'Neues-Passwort-1' }, { sende }),
            { ok: false, status: 403, error: MELDUNG_UNGUELTIG });
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel, email: 'normal@test.de', passwort: 'Neues-Passwort-1' }, { sende })).status, 403);
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel, email: 'gibtsnicht@test.de', passwort: 'Neues-Passwort-1' }, { sende })).status, 403);
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel, email: 'sa@test.de', passwort: 'kurz' }, { sende })).status, 400);
        assert.equal((await notfallSchluesselStatus(knex)).vorhanden, true, 'Fehlversuche verbrauchen den Schlüssel nicht');
        assert.equal(mails.length, 0);

        const ok = await nutzeNotfallSchluessel(knex, { schluessel: ` ${schluessel}\n`, email: ' SA@test.de ', passwort: 'Neues-Passwort-1' }, { sende });
        assert.deepEqual(ok, { ok: true, email: 'sa@test.de' });
        const konto = await knex('benutzer').where({ id: 'sa' }).first();
        assert.ok(verifyPassword('Neues-Passwort-1', konto.password_hash));
        assert.equal(konto.gesperrt, false);
        assert.equal(konto.muss_passwort_aendern, false);
        assert.ok(konto.email_bestaetigt_am);
        assert.equal((await knex('token_einmal').where({ benutzer_id: 'sa' })).length, 0, 'offene Reset-Links verfallen');
        assert.deepEqual([konto.totp_secret, konto.totp_aktiv_am, konto.totp_letzter_schritt], [null, null, null], '2FA wird zurückgesetzt');
        assert.equal((await knex('totp_backup_codes').where({ benutzer_id: 'sa' })).length, 0);
        assert.equal((await knex('benutzer').where({ id: 'normal' }).first()).password_hash, 'x:y');
        assert.equal(mails.length, 1);
        assert.equal(mails[0].to, 'sa@test.de');

        // einmalig: derselbe Schlüssel funktioniert nicht noch einmal
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel, email: 'sa@test.de', passwort: 'Anderes-Passwort-2' }, { sende })).status, 403);
        assert.ok(verifyPassword('Neues-Passwort-1', (await knex('benutzer').where({ id: 'sa' }).first()).password_hash));

        // ein neuer Schlüssel ersetzt den alten
        const erster = await erzeugeNotfallSchluessel(knex);
        const zweiter = await erzeugeNotfallSchluessel(knex);
        assert.notEqual(erster, zweiter);
        assert.equal((await knex('notfall_schluessel')).length, 1);
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel: erster, email: 'sa@test.de', passwort: 'Anderes-Passwort-2' }, { sende })).status, 403);
        assert.equal((await nutzeNotfallSchluessel(knex, { schluessel: zweiter, email: 'sa@test.de', passwort: 'Anderes-Passwort-2' }, { sende })).ok, true);
    } finally {
        await db.stoppe();
    }
});
