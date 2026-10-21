import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Helfer per E-Mail in den Verein einladen (Admins): Zerlegen der Liste, Versand, Rechte, Einlösen des Links.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'helfer-einladung-test-geheimnis';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { getVereinRoutes } = await import('../../src/routes/vereinRoutes.js');
const { getEinladungRoutes } = await import('../../src/routes/einladungRoutes.js');
const { zerlegeEmailListe, MAX_EINLADUNGEN_JE_ANFRAGE } = await import('../../src/services/helferEinladung.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('zerlegeEmailListe: Zeilen, Komma, Semikolon, Namensform, Duplikate und Ungültiges', () => {
    const r = zerlegeEmailListe('a@x.de, B@X.de;\n c@x.de\r\nAnna Muster <anna@x.de>\n  a@x.de \nkeine-mail\nfast@\n\n');
    assert.deepEqual(r.adressen, ['a@x.de', 'b@x.de', 'c@x.de', 'anna@x.de']);
    assert.deepEqual(r.ungueltig, ['keine-mail', 'fast@']);
    assert.deepEqual(zerlegeEmailListe(['x@y.de', ' x@y.de', '']).adressen, ['x@y.de']);
    assert.deepEqual(zerlegeEmailListe(null), { adressen: [], ungueltig: [] });
});

test('Helfer-Einladung: Admin lädt per Liste ein, Rechte, Einlösen mit sofortiger Freischaltung als Helfer', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    let mailKaputt = false;
    const sende = async (m) => { if (mailKaputt) throw new Error('SMTP kaputt'); mails.push(m); };
    const app = express();
    app.use(express.json());
    app.use('/api/vereine', getVereinRoutes(knex, { sende }));
    app.use('/api/einladung', getEinladungRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, methode, pfad, body) => {
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
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const n of ['admin', 'benutzer', 'mit', 'adminb']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: vA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-benutzer', verein_id: vA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-mit', verein_id: vA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-adminb', verein_id: vB, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-admin', 'u-benutzer', 'u-mit']).update({ aktiver_verein_id: vA });
        await knex('benutzer').where({ id: 'u-adminb' }).update({ aktiver_verein_id: vB });

        // Rechte und Eingaben
        assert.equal((await aufruf(null, 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'a@x.de' })).status, 401);
        assert.equal((await aufruf('u-benutzer', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'a@x.de' })).status, 403);
        assert.equal((await aufruf('u-adminb', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'a@x.de' })).status, 403);
        assert.equal((await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { emails: 'a@x.de' })).status, 400);
        assert.equal((await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: '  ' })).status, 400);
        const zuViele = Array.from({ length: MAX_EINLADUNGEN_JE_ANFRAGE + 1 }, (_, i) => `p${i}@x.de`);
        assert.equal((await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: zuViele })).status, 400);
        assert.equal((await aufruf('u-benutzer', 'GET', `/api/vereine/einladungen?vereinId=${vA}`)).status, 403);
        assert.equal(mails.length, 0);

        // Liste: zwei neue Adressen, ein vorhandenes Mitglied, eine ungültige Zeile
        const r = await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'neu@extern.de, mit@test.de;\nAnna <anna@extern.de>\nkaputt' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual(r.daten.ergebnisse, [
            { email: 'neu@extern.de', status: 'gesendet' },
            { email: 'mit@test.de', status: 'bereits_mitglied' },
            { email: 'anna@extern.de', status: 'gesendet' }
        ]);
        assert.deepEqual(r.daten.ungueltig, ['kaputt']);
        assert.deepEqual(mails.map((m) => m.to), ['neu@extern.de', 'anna@extern.de']);
        assert.match(mails[0].text, /JC A/);
        const link = mails[0].text.match(/https:\/\/hajime\.example\.de\/einladung\.html\?token=([A-Za-z0-9_-]+)/);
        assert.ok(link, mails[0].text);

        // Offene Einladungen
        const offen = await aufruf('u-admin', 'GET', `/api/vereine/einladungen?vereinId=${vA}`);
        assert.deepEqual(offen.daten.einladungen.map((e) => e.email).sort(), ['anna@extern.de', 'neu@extern.de']);

        // Erneut einladen entwertet den alten Link (nur der neue gilt)
        const alterToken = link[1];
        await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'neu@extern.de' });
        assert.equal((await aufruf(null, 'GET', `/api/einladung/${alterToken}`)).status, 404);
        const neuerToken = mails.at(-1).text.match(/token=([A-Za-z0-9_-]+)/)[1];

        // Link: Verein und E-Mail stehen fest, Name und Passwort werden vergeben, danach sofort freigeschaltet (Helfer)
        const info = await aufruf(null, 'GET', `/api/einladung/${neuerToken}`);
        assert.deepEqual([info.status, info.daten.email, info.daten.vereinName, info.daten.kontoVorhanden], [200, 'neu@extern.de', 'JC A', false]);
        const einloesen = await aufruf(null, 'POST', `/api/einladung/${neuerToken}`, { password: 'sicheres-passwort-1', vorname: 'Nina', nachname: 'Neu' });
        assert.equal(einloesen.status, 200, JSON.stringify(einloesen.daten));
        const konto = await knex('benutzer').where({ email: 'neu@extern.de' }).first();
        assert.ok(konto.email_bestaetigt_am);
        const mitgliedschaft = await knex('benutzer_vereine').where({ benutzer_id: konto.id, verein_id: vA }).first();
        assert.deepEqual([Number(mitgliedschaft.freigegeben), mitgliedschaft.rolle], [1, 'helfer']);
        // Nach dem Einlösen ist die Person Mitglied: eine erneute Einladung wird nicht mehr versendet
        const nochmal = await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'neu@extern.de' });
        assert.deepEqual(nochmal.daten.ergebnisse, [{ email: 'neu@extern.de', status: 'bereits_mitglied' }]);

        // Mailfehler: Status fehler, die Einladung bleibt nicht offen
        mailKaputt = true;
        const fehler = await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { vereinId: vA, emails: 'pech@extern.de' });
        assert.deepEqual(fehler.daten.ergebnisse, [{ email: 'pech@extern.de', status: 'fehler' }]);
        mailKaputt = false;
        const nachFehler = await aufruf('u-admin', 'GET', `/api/vereine/einladungen?vereinId=${vA}`);
        assert.ok(!nachFehler.daten.einladungen.some((e) => e.email === 'pech@extern.de'));
    } finally {
        server.close();
        await db.stoppe();
    }
});
