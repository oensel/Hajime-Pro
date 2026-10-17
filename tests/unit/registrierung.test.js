import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Registrierung mit E-Mail-Bestätigung (Helferverwaltung, Spec Abschnitt 4): Konto unbestätigt anlegen,
// Bestätigungsmail, erst nach der Bestätigung Mitgliedschaft + Mail an die Entscheider mit Freischaltungs-Link.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { registriere, bestaetige, sendeBestaetigungNeu } = await import('../../src/services/registrierung.js');
const { pruefeToken } = await import('../../src/services/einmalToken.js');
const { login, register } = await import('../../src/controllers/authController.js');
const { hashPassword } = await import('../../src/utils/password.js');
const { ensureSuperAdmin, SUPER_ADMIN_EMAIL } = await import('../../src/utils/superAdmin.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const BASIS = 'https://hajime.example';

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

function tokenAusLink(text, seite) {
    const m = new RegExp(`${BASIS.replace(/\./g, '\\.')}/${seite}\\?token=([A-Za-z0-9_-]+)`).exec(text);
    assert.ok(m, `Link auf ${seite} fehlt in: ${text}`);
    return m[1];
}

test('Registrierung: unbestätigt anlegen, bestätigen, Anfrage an den Verein', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const gesendet = [];
    const sende = async (mail) => { gesendet.push(mail); };
    try {
        const mitAdmin = id((await knex('vereine').insert({ name: 'JC Mit Admin' }).returning('id'))[0]);
        const ohneAdmin = id((await knex('vereine').insert({ name: 'JC Ohne Admin' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-admin', email: 'admin@test.de', vorname: 'A', nachname: 'Dmin', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'Uper', ist_super_admin: true, email_bestaetigt_am: knex.fn.now() }
        ]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-admin', verein_id: mitAdmin, freigegeben: 1, rolle: 'admin' });

        // --- Registrierung legt unbestätigtes Konto an und sendet genau eine Mail an die Adresse
        const r1 = await registriere(knex, {
            email: '  Erika@Example.DE ', password: 'geheim123', vorname: 'Erika', nachname: 'Muster',
            vereinId: mitAdmin, quelle: 'helfer-app', basisUrl: BASIS
        }, { sende });
        assert.equal(r1.status, 201);
        assert.equal(r1.body.token, undefined, 'kein JWT vor der Bestätigung');
        const erika = await knex('benutzer').where({ email: 'erika@example.de' }).first();
        assert.ok(erika, 'E-Mail getrimmt und kleingeschrieben gespeichert');
        assert.equal(erika.email_bestaetigt_am, null);
        assert.equal(gesendet.length, 1);
        assert.equal(gesendet[0].to, 'erika@example.de');
        const emailToken1 = tokenAusLink(gesendet[0].text, 'bestaetigen.html');
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: erika.id }).first(), undefined,
            'keine Mitgliedschaft vor der Bestätigung');

        // --- Login vor Bestätigung → 403 email_unbestaetigt (nur mit richtigem Passwort)
        const resLogin = fakeRes();
        await login(knex, { body: { email: 'ERIKA@example.de', password: 'geheim123' } }, resLogin);
        assert.equal(resLogin.statusCode, 403);
        assert.equal(resLogin.body.code, 'email_unbestaetigt');
        assert.equal(resLogin.body.token, undefined);
        const resFalsch = fakeRes();
        await login(knex, { body: { email: 'erika@example.de', password: 'falsch12345' } }, resFalsch);
        assert.equal(resFalsch.statusCode, 401);

        // --- gleiche E-Mail in Großschreibung → kein zweites Konto, erneute Bestätigungsmail
        const r2 = await registriere(knex, {
            email: 'ERIKA@EXAMPLE.DE', password: 'geheim123', vorname: 'Erika', nachname: 'Muster',
            vereinId: mitAdmin, quelle: 'helfer-app', basisUrl: BASIS
        }, { sende });
        assert.equal(r2.status, 200);
        assert.equal(r2.body.token, undefined);
        const anzahl = await knex('benutzer').whereRaw('lower(email) = ?', ['erika@example.de']).count('* as n').first();
        assert.equal(Number(anzahl.n), 1);
        assert.equal(gesendet.length, 2);
        assert.equal(gesendet[1].to, 'erika@example.de');
        const emailToken2 = tokenAusLink(gesendet[1].text, 'bestaetigen.html');
        // der ältere Link gilt nicht mehr
        assert.equal(await pruefeToken(knex, emailToken1, 'email'), null);

        // --- Bestätigen: Mitgliedschaft freigegeben=0 mit angefragt_ueber, Mail an die Vereins-Admins
        const b1 = await bestaetige(knex, emailToken2, BASIS, { sende });
        assert.deepEqual(b1, { ok: true, vereinId: mitAdmin });
        assert.ok((await knex('benutzer').where({ id: erika.id }).first()).email_bestaetigt_am);
        const m1 = await knex('benutzer_vereine').where({ benutzer_id: erika.id, verein_id: mitAdmin }).first();
        assert.deepEqual([m1.freigegeben, m1.rolle, m1.angefragt_ueber], [0, null, 'helfer-app']);
        assert.equal((await knex('benutzer').where({ id: erika.id }).first()).aktiver_verein_id, mitAdmin);
        assert.equal(gesendet.length, 3);
        assert.deepEqual(gesendet[2].to, ['admin@test.de']);
        assert.match(gesendet[2].text, /Erika Muster/);
        assert.match(gesendet[2].text, /erika@example\.de/);
        const freiToken = tokenAusLink(gesendet[2].text, 'freigabe.html');
        const frei = await pruefeToken(knex, freiToken, 'freischaltung');
        assert.deepEqual([frei.benutzer_id, frei.verein_id], [erika.id, mitAdmin]);

        // zweite Bestätigung mit demselben Link → kein Erfolg, keine weitere Mail
        const b2 = await bestaetige(knex, emailToken2, BASIS, { sende });
        assert.equal(b2.ok, false);
        assert.equal(gesendet.length, 3);

        // nach der Bestätigung: Login klappt
        const resOk = fakeRes();
        await login(knex, { body: { email: ' Erika@Example.de', password: 'geheim123' } }, resOk);
        assert.equal(resOk.statusCode, 200);
        assert.ok(resOk.body.token);

        // --- bestätigte Adresse bereits vergeben → 409 (auch in anderer Schreibweise), keine Mail
        const r409 = await registriere(knex, {
            email: 'Erika@example.de', password: 'anderes123', vorname: 'X', nachname: 'Y', basisUrl: BASIS
        }, { sende });
        assert.equal(r409.status, 409);
        assert.equal(gesendet.length, 3);

        // --- Verein ohne Admin → Mail an die Super-Admins; quelle fehlt → 'verwaltung'
        const r3 = await registriere(knex, {
            email: 'max@example.de', password: 'geheim123', vorname: 'Max', nachname: 'Mann',
            vereinId: ohneAdmin, basisUrl: BASIS
        }, { sende });
        assert.equal(r3.status, 201);
        const maxToken = tokenAusLink(gesendet[3].text, 'bestaetigen.html');
        assert.deepEqual(await bestaetige(knex, maxToken, BASIS, { sende }), { ok: true, vereinId: ohneAdmin });
        const max = await knex('benutzer').where({ email: 'max@example.de' }).first();
        const m3 = await knex('benutzer_vereine').where({ benutzer_id: max.id, verein_id: ohneAdmin }).first();
        assert.deepEqual([m3.freigegeben, m3.angefragt_ueber], [0, 'verwaltung']);
        assert.deepEqual(gesendet[4].to, ['super@test.de']);
        tokenAusLink(gesendet[4].text, 'freigabe.html');

        // --- ohne vereinId (Altfluss): Bestätigung ohne Mitgliedschaft und ohne Admin-Mail
        const r4 = await registriere(knex, {
            email: 'alt@example.de', password: 'geheim123', vorname: 'Alt', nachname: 'Fluss', basisUrl: BASIS
        }, { sende });
        assert.equal(r4.status, 201);
        const altToken = tokenAusLink(gesendet[5].text, 'bestaetigen.html');
        assert.deepEqual(await bestaetige(knex, altToken, BASIS, { sende }), { ok: true });
        const alt = await knex('benutzer').where({ email: 'alt@example.de' }).first();
        assert.ok(alt.email_bestaetigt_am);
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: alt.id }).first(), undefined);
        assert.equal(gesendet.length, 6);

        // --- Validierung
        const zuKurz = await registriere(knex, {
            email: 'kurz@example.de', password: '1234567', vorname: 'K', nachname: 'Urz', basisUrl: BASIS
        }, { sende });
        assert.equal(zuKurz.status, 400);
        const unbekannt = await registriere(knex, {
            email: 'unb@example.de', password: 'geheim123', vorname: 'U', nachname: 'Nb', vereinId: 999999, basisUrl: BASIS
        }, { sende });
        assert.equal(unbekannt.status, 400);
        const fehlend = await registriere(knex, { email: 'f@example.de', password: 'geheim123', basisUrl: BASIS }, { sende });
        assert.equal(fehlend.status, 400);
        const quelle = await registriere(knex, {
            email: 'q@example.de', password: 'geheim123', vorname: 'Q', nachname: 'U', quelle: 'irgendwo', basisUrl: BASIS
        }, { sende });
        assert.equal(quelle.status, 400);
        assert.equal(gesendet.length, 6);
        for (const e of ['kurz@example.de', 'unb@example.de', 'f@example.de', 'q@example.de']) {
            assert.equal(await knex('benutzer').where({ email: e }).first(), undefined);
        }

        // --- Bestätigung neu senden: unbestätigtes Konto bekommt neue Mail (Verein bleibt), sonst still ok
        await registriere(knex, {
            email: 'neu@example.de', password: 'geheim123', vorname: 'Neu', nachname: 'Send',
            vereinId: mitAdmin, quelle: 'verwaltung', basisUrl: BASIS
        }, { sende });
        const neuAlt = tokenAusLink(gesendet[6].text, 'bestaetigen.html');
        assert.deepEqual(await sendeBestaetigungNeu(knex, ' NEU@example.de', BASIS, { sende }), { ok: true });
        assert.equal(gesendet.length, 8);
        const neuToken = tokenAusLink(gesendet[7].text, 'bestaetigen.html');
        assert.equal(await pruefeToken(knex, neuAlt, 'email'), null);
        assert.equal((await pruefeToken(knex, neuToken, 'email')).verein_id, mitAdmin);
        assert.deepEqual(await sendeBestaetigungNeu(knex, 'gibtsnicht@example.de', BASIS, { sende }), { ok: true });
        assert.deepEqual(await sendeBestaetigungNeu(knex, 'erika@example.de', BASIS, { sende }), { ok: true });
        assert.equal(gesendet.length, 8, 'unbekannte/bestätigte Adressen bekommen keine Mail');
        assert.deepEqual(await bestaetige(knex, neuToken, BASIS, { sende }), { ok: true, vereinId: mitAdmin });
        const neu = await knex('benutzer').where({ email: 'neu@example.de' }).first();
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: neu.id }).first()).angefragt_ueber, 'verwaltung');

        // --- Controller register: kein Token, Basis-URL aus dem Request
        delete process.env.PUBLIC_BASE_URL;
        const resReg = fakeRes();
        await register(knex, {
            body: { email: 'ctrl@example.de', password: 'geheim123', vorname: 'C', nachname: 'Trl' },
            protocol: 'http', get: (h) => (h.toLowerCase() === 'host' ? 'turnier.local' : undefined)
        }, resReg);
        assert.equal(resReg.statusCode, 201);
        assert.equal(resReg.body.success, true);
        assert.equal(resReg.body.token, undefined);

        // --- Bestandskonto in Großschreibung: Login per kleingeschriebener Adresse, Registrierung → 409
        await knex('benutzer').insert({
            id: 'u-legacy', email: 'Legacy@Test.DE', vorname: 'L', nachname: 'G',
            password_hash: hashPassword('legacy123'), email_bestaetigt_am: knex.fn.now()
        });
        const resLegacy = fakeRes();
        await login(knex, { body: { email: 'legacy@test.de', password: 'legacy123' } }, resLegacy);
        assert.equal(resLegacy.statusCode, 200);
        const rLegacy = await registriere(knex, {
            email: 'legacy@test.de', password: 'geheim123', vorname: 'L', nachname: 'G', basisUrl: BASIS
        }, { sende });
        assert.equal(rLegacy.status, 409);

        // --- Super-Admin-Bootstrap legt ein bestätigtes Konto an (sonst wäre kein Login möglich)
        await ensureSuperAdmin(knex);
        const sa = await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first();
        assert.ok(sa.email_bestaetigt_am);
    } finally {
        await db.stoppe();
    }
});
