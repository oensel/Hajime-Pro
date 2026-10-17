import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Freischaltung per Mail-Link (Helferverwaltung, Spec Abschnitt 4): GET zeigt nur an und verbraucht den
// Token nicht, erst das POST entscheidet (einmalig), danach bekommt der Antragsteller eine Ergebnis-Mail.
// Außerdem: Beitritt zu einem weiteren Verein (POST /api/vereine/join) erzeugt denselben Freischaltungs-Link.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
// Nie echte Mails: leerer Wert statt delete (dotenv ergänzt sonst SMTP_HOST aus der .env); zusätzlich wird
// in jedem Aufruf `sende` injiziert.
process.env.SMTP_HOST = '';

const { zeigeFreigabe, entscheideFreigabe, GEBRAUCHT_TEXT } = await import('../../src/controllers/freigabeController.js');
const { joinVerein } = await import('../../src/controllers/vereinController.js');
const { erzeugeToken, pruefeToken } = await import('../../src/services/einmalToken.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const BASIS = 'https://hajime.example';

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

const anfrage = (token, body = {}) => ({ params: { token }, body });

test('Freischaltung per Mail-Link: anzeigen, entscheiden, einmalig, Ergebnis-Mail', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const gesendet = [];
    const sende = async (mail) => { gesendet.push(mail); };
    try {
        assert.equal(GEBRAUCHT_TEXT, 'Diese Anfrage wurde bereits entschieden oder ist abgelaufen.');
        const verein = id((await knex('vereine').insert({ name: 'JC Freigabe' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-admin', email: 'admin@test.de', vorname: 'A', nachname: 'Dmin', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-erika', email: 'erika@test.de', vorname: 'Erika', nachname: 'Muster', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-max', email: 'max@test.de', vorname: 'Max', nachname: 'Mann', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-alt', email: 'alt@test.de', vorname: 'Alt', nachname: 'Token', email_bestaetigt_am: knex.fn.now() }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-erika', verein_id: verein, freigegeben: 0, angefragt_ueber: 'helfer-app' },
            { benutzer_id: 'u-max', verein_id: verein, freigegeben: 0, angefragt_ueber: 'verwaltung' },
            { benutzer_id: 'u-alt', verein_id: verein, freigegeben: 0, angefragt_ueber: 'helfer-app' }
        ]);
        const tErika = await erzeugeToken(knex, { benutzerId: 'u-erika', zweck: 'freischaltung', vereinId: verein });
        const tErika2 = await erzeugeToken(knex, { benutzerId: 'u-erika', zweck: 'freischaltung', vereinId: verein });
        const tMax = await erzeugeToken(knex, { benutzerId: 'u-max', zweck: 'freischaltung', vereinId: verein });
        const tAlt = await erzeugeToken(knex, { benutzerId: 'u-alt', zweck: 'freischaltung', vereinId: verein });

        // --- GET zeigt an, verbraucht nichts (Mail-Programme rufen Links vorab ab)
        for (let i = 0; i < 2; i++) {
            const res = fakeRes();
            await zeigeFreigabe(knex, anfrage(tErika), res);
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body.benutzer, { vorname: 'Erika', nachname: 'Muster', email: 'erika@test.de' });
            assert.deepEqual(res.body.verein, { id: verein, name: 'JC Freigabe' });
            assert.equal(res.body.vorbelegteRolle, 'helfer');
        }
        assert.ok(await pruefeToken(knex, tErika, 'freischaltung'), 'GET verbraucht den Token nicht');
        const resMax = fakeRes();
        await zeigeFreigabe(knex, anfrage(tMax), resMax);
        assert.equal(resMax.body.vorbelegteRolle, 'benutzer');

        // --- unbekannter Token → 404
        const res404 = fakeRes();
        await zeigeFreigabe(knex, anfrage('gibtsnicht'), res404);
        assert.equal(res404.statusCode, 404);
        const res404p = fakeRes();
        await entscheideFreigabe(knex, anfrage('gibtsnicht', { entscheidung: 'ablehnen' }), res404p, { sende });
        assert.equal(res404p.statusCode, 404);

        // --- ungültige Rolle / Entscheidung → 400, Token bleibt gültig, Mitgliedschaft unverändert, keine Mail
        for (const body of [{ entscheidung: 'freigeben' }, { entscheidung: 'freigeben', rolle: 'superadmin' }, { entscheidung: 'vielleicht' }, {}]) {
            const res = fakeRes();
            await entscheideFreigabe(knex, anfrage(tErika, body), res, { sende });
            assert.equal(res.statusCode, 400, JSON.stringify(body));
            assert.ok(await pruefeToken(knex, tErika, 'freischaltung'), 'Token bleibt nach 400 gültig');
        }
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: 'u-erika' }).first()).freigegeben, 0);
        assert.equal(gesendet.length, 0);

        // --- freigeben als Helfer
        const resFrei = fakeRes();
        await entscheideFreigabe(knex, anfrage(tErika, { entscheidung: 'freigeben', rolle: 'helfer' }), resFrei, { sende });
        assert.equal(resFrei.statusCode, 200);
        assert.equal(resFrei.body.success, true);
        const m = await knex('benutzer_vereine').where({ benutzer_id: 'u-erika', verein_id: verein }).first();
        assert.deepEqual([m.freigegeben, m.rolle, m.entschieden_von], [1, 'helfer', null]);
        assert.ok(m.entschieden_am);
        assert.equal(gesendet.length, 1);
        assert.equal(gesendet[0].to, 'erika@test.de');
        assert.match(gesendet[0].text, /Du bist als Helfer bei JC Freigabe freigeschaltet/);

        // --- zweites POST mit demselben Token → 410, GET → 410; weiterer Token derselben Anfrage ist verbraucht
        for (const t of [tErika, tErika2]) {
            const res = fakeRes();
            await entscheideFreigabe(knex, anfrage(t, { entscheidung: 'ablehnen' }), res, { sende });
            assert.equal(res.statusCode, 410);
            assert.equal(res.body.error, GEBRAUCHT_TEXT);
            const resGet = fakeRes();
            await zeigeFreigabe(knex, anfrage(t), resGet);
            assert.equal(resGet.statusCode, 410);
            assert.equal(resGet.body.error, GEBRAUCHT_TEXT);
        }
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: 'u-erika' }).first()).rolle, 'helfer');
        assert.equal(gesendet.length, 1);

        // --- abgelaufener Token → 410 (GET und POST)
        await knex('token_einmal').where({ benutzer_id: 'u-alt' }).update({ laeuft_ab_am: knex.raw("now() - interval '1 minute'") });
        const resAbgelaufen = fakeRes();
        await entscheideFreigabe(knex, anfrage(tAlt, { entscheidung: 'freigeben', rolle: 'helfer' }), resAbgelaufen, { sende });
        assert.equal(resAbgelaufen.statusCode, 410);
        assert.equal(resAbgelaufen.body.error, GEBRAUCHT_TEXT);
        const resAbgelaufenGet = fakeRes();
        await zeigeFreigabe(knex, anfrage(tAlt), resAbgelaufenGet);
        assert.equal(resAbgelaufenGet.statusCode, 410);
        assert.equal((await knex('benutzer_vereine').where({ benutzer_id: 'u-alt' }).first()).freigegeben, 0);

        // --- Anfrage inzwischen über die Liste entschieden → Token zeigt 410
        await knex('benutzer_vereine').where({ benutzer_id: 'u-alt' }).update({ freigegeben: 1, rolle: 'helfer' });
        const tAltNeu = await erzeugeToken(knex, { benutzerId: 'u-alt', zweck: 'freischaltung', vereinId: verein });
        const resListe = fakeRes();
        await zeigeFreigabe(knex, anfrage(tAltNeu), resListe);
        assert.equal(resListe.statusCode, 410);

        // --- ablehnen löscht die Mitgliedschaft; Mailfehler lassen den Ablauf nicht scheitern
        const resAb = fakeRes();
        await entscheideFreigabe(knex, anfrage(tMax, { entscheidung: 'ablehnen' }), resAb, {
            sende: async (mail) => { gesendet.push(mail); throw new Error('SMTP kaputt'); }
        });
        assert.equal(resAb.statusCode, 200);
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: 'u-max', verein_id: verein }).first(), undefined);
        assert.equal(gesendet.length, 2);
        assert.equal(gesendet[1].to, 'max@test.de');
        assert.match(gesendet[1].text, /JC Freigabe/);
        assert.match(gesendet[1].text, /abgelehnt/);
    } finally {
        await db.stoppe();
    }
});

test('Beitritt zu einem weiteren Verein: E-Mail bestätigt, Freischaltungs-Link an die Entscheider', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const gesendet = [];
    const sende = async (mail) => { gesendet.push(mail); };
    const vorherBasis = process.env.PUBLIC_BASE_URL;
    try {
        const heimat = id((await knex('vereine').insert({ name: 'JC Heimat' }).returning('id'))[0]);
        const weiterer = id((await knex('vereine').insert({ name: 'JC Weiterer' }).returning('id'))[0]);
        const dritter = id((await knex('vereine').insert({ name: 'JC Dritter' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-admin', email: 'admin@test.de', vorname: 'A', nachname: 'Dmin', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-helfer', email: 'helfer@test.de', vorname: 'Hel', nachname: 'Fer', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-offen', email: 'offen@test.de', vorname: 'Of', nachname: 'Fen', email_bestaetigt_am: null },
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'Uper', ist_super_admin: true, email_bestaetigt_am: knex.fn.now() }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: weiterer, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-helfer', verein_id: heimat, freigegeben: 1, rolle: 'helfer', angefragt_ueber: 'helfer-app' }
        ]);
        const req = (userId, body) => ({
            user: { id: userId }, body, protocol: 'http', get: () => 'boese.example'
        });

        // unbestätigte E-Mail → 403, keine Mitgliedschaft, keine Mail
        const res403 = fakeRes();
        await joinVerein(knex, req('u-offen', { vereinId: weiterer }), res403, { sende });
        assert.equal(res403.statusCode, 403);
        assert.equal(res403.body.code, 'email_unbestaetigt');
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: 'u-offen' }).first(), undefined);
        assert.equal(gesendet.length, 0);

        // bestätigt → Anfrage mit Quelle der bestehenden Mitgliedschaft, Mail mit Link an die Admins
        process.env.PUBLIC_BASE_URL = BASIS;
        const res = fakeRes();
        await joinVerein(knex, req('u-helfer', { vereinId: weiterer }), res, { sende });
        assert.equal(res.statusCode, 200);
        const m = await knex('benutzer_vereine').where({ benutzer_id: 'u-helfer', verein_id: weiterer }).first();
        assert.deepEqual([m.freigegeben, m.angefragt_ueber], [0, 'helfer-app']);
        assert.equal(gesendet.length, 1);
        assert.deepEqual(gesendet[0].to, ['admin@test.de']);
        const treffer = /https:\/\/hajime\.example\/freigabe\.html\?token=([A-Za-z0-9_-]+)/.exec(gesendet[0].text);
        assert.ok(treffer, gesendet[0].text);
        assert.doesNotMatch(gesendet[0].text, /boese\.example/);
        const resGet = fakeRes();
        await zeigeFreigabe(knex, anfrage(treffer[1]), resGet);
        assert.equal(resGet.statusCode, 200);
        assert.equal(resGet.body.vorbelegteRolle, 'helfer');
        assert.deepEqual(resGet.body.verein, { id: weiterer, name: 'JC Weiterer' });

        // Cloud ohne PUBLIC_BASE_URL → Anfrage entsteht, Mail ohne Link, kein Token
        delete process.env.PUBLIC_BASE_URL;
        const anzahlVorher = Number((await knex('token_einmal').count('* as n').first()).n);
        const resOhne = fakeRes();
        await joinVerein(knex, req('u-helfer', { vereinId: dritter }), resOhne, { sende });
        assert.equal(resOhne.statusCode, 200);
        assert.ok(await knex('benutzer_vereine').where({ benutzer_id: 'u-helfer', verein_id: dritter }).first());
        assert.equal(gesendet.length, 2);
        assert.deepEqual(gesendet[1].to, ['super@test.de'], 'Verein ohne Admin → Super-Admins');
        assert.doesNotMatch(gesendet[1].text, /freigabe\.html/);
        assert.equal(Number((await knex('token_einmal').count('* as n').first()).n), anzahlVorher);
    } finally {
        if (vorherBasis === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = vorherBasis;
        await db.stoppe();
    }
});
