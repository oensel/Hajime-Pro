import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Einladung ohne Verein (Link zur Registrierung) und Turnier per Mail teilen (Direktlink über die Anmeldung).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'einladung-ohne-verein-test-geheimnis';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { getVereinRoutes } = await import('../../src/routes/vereinRoutes.js');
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');
const { sichereWeiterleitung, turnierAnsichtPfad, loginMitWeiterleitung } = await import('../../src/shared/weiterZiel.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('sichereWeiterleitung: nur Seiten dieser Anwendung', () => {
    assert.equal(sichereWeiterleitung('/turnier-ansicht.html?id=5'), '/turnier-ansicht.html?id=5');
    assert.equal(sichereWeiterleitung('/turniere.html'), '/turniere.html');
    for (const boese of ['https://boese.de', '//boese.de/x.html', '/\\boese.de', 'javascript:alert(1)', '/ordner/seite.html', '/seite.html#x', '/seite.html?a=<b>', '', null, undefined, 5]) {
        assert.equal(sichereWeiterleitung(boese), null, String(boese));
    }
    assert.equal(sichereWeiterleitung(decodeURIComponent(loginMitWeiterleitung(turnierAnsichtPfad(7)).split('weiter=')[1])), '/turnier-ansicht.html?id=7');
});

test('Einladung ohne Verein und Turnier teilen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    let mailKaputt = false;
    const sende = async (m) => { if (mailKaputt) throw new Error('SMTP kaputt'); mails.push(m); };
    const app = express();
    app.use(express.json());
    app.use('/api/vereine', getVereinRoutes(knex, { sende }));
    app.use('/api/turniere', getTurnierRoutes(knex, { sende }));
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
        for (const n of ['admin', 'benutzer', 'helfer', 'fremd', 'vorhanden']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: vA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-benutzer', verein_id: vA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-helfer', verein_id: vA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-fremd', verein_id: vB, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-admin', 'u-benutzer', 'u-helfer']).update({ aktiver_verein_id: vA });
        await knex('benutzer').where({ id: 'u-fremd' }).update({ aktiver_verein_id: vB });

        // --- Einladung ohne Verein ---
        assert.equal((await aufruf(null, 'POST', '/api/vereine/einladungen', { emails: 'a@x.de' })).status, 401);
        assert.equal((await aufruf('u-benutzer', 'POST', '/api/vereine/einladungen', { emails: 'a@x.de' })).status, 403);
        assert.equal((await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { emails: '  ' })).status, 400);
        assert.equal(mails.length, 0);

        const r = await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { emails: 'neu@extern.de, vorhanden@test.de\nkaputt' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual(r.daten.ergebnisse, [
            { email: 'neu@extern.de', status: 'gesendet' },
            { email: 'vorhanden@test.de', status: 'bereits_konto' }
        ]);
        assert.deepEqual(r.daten.ungueltig, ['kaputt']);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].to, 'neu@extern.de');
        assert.match(mails[0].text, /https:\/\/hajime\.example\.de\/login\.html\?registrieren=1&email=neu%40extern\.de/);
        // Kein Token, keine Sofort-Freischaltung: es entsteht nichts in den Einladungen
        assert.equal((await knex('orga_einladungen').count('* as n').first()).n, '0');

        mailKaputt = true;
        const fehler = await aufruf('u-admin', 'POST', '/api/vereine/einladungen', { emails: 'pech@extern.de' });
        assert.deepEqual(fehler.daten.ergebnisse, [{ email: 'pech@extern.de', status: 'fehler' }]);
        mailKaputt = false;

        // --- Turnier teilen ---
        mails.length = 0;
        const veroeffentlicht = id((await knex('turniere').insert({
            bezeichnung: 'Stadtpokal', ort: 'Halle', plz: '12345', datum: '2030-05-01', ausrichter: 'JC A', verein_id: vA, status: 'veroeffentlicht'
        }).returning('id'))[0]);
        const entwurf = id((await knex('turniere').insert({
            bezeichnung: 'Geheim', ort: 'Halle', datum: '2030-05-02', ausrichter: 'JC A', verein_id: vA, status: 'entwurf'
        }).returning('id'))[0]);

        assert.equal((await aufruf(null, 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: 'a@x.de' })).status, 401);
        assert.equal((await aufruf('u-helfer', 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: 'a@x.de' })).status, 403);
        assert.equal((await aufruf('u-fremd', 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: 'a@x.de' })).status, 403);
        assert.equal((await aufruf('u-benutzer', 'POST', `/api/turniere/${entwurf}/teilen`, { emails: 'a@x.de' })).status, 400);
        assert.equal((await aufruf('u-benutzer', 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: ' ' })).status, 400);
        assert.equal(mails.length, 0);

        const geteilt = await aufruf('u-benutzer', 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: 'eins@x.de; Zwei <zwei@x.de>\nkaputt' });
        assert.equal(geteilt.status, 200, JSON.stringify(geteilt.daten));
        assert.deepEqual(geteilt.daten.ergebnisse, [{ email: 'eins@x.de', status: 'gesendet' }, { email: 'zwei@x.de', status: 'gesendet' }]);
        assert.deepEqual(geteilt.daten.ungueltig, ['kaputt']);
        assert.deepEqual(mails.map((m) => m.to), ['eins@x.de', 'zwei@x.de']);
        assert.match(mails[0].text, /Stadtpokal/);
        assert.ok(mails[0].text.includes(`https://hajime.example.de/login.html?weiter=${encodeURIComponent(`/turnier-ansicht.html?id=${veroeffentlicht}`)}`), mails[0].text);

        // Vereine: nur freigegebene Admins mit bestätigter Adresse, nicht gesperrt; doppelte Adressen einmal
        mails.length = 0;
        const vC = id((await knex('vereine').insert({ name: 'JC C' }).returning('id'))[0]);
        const vD = id((await knex('vereine').insert({ name: 'JC D (ohne Admin)' }).returning('id'))[0]);
        for (const n of ['adminc', 'gesperrt', 'unbestaetigt', 'cbenutzer']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: n === 'unbestaetigt' ? null : knex.fn.now(), gesperrt: n === 'gesperrt' });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-adminc', verein_id: vC, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-admin', verein_id: vC, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-gesperrt', verein_id: vC, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-unbestaetigt', verein_id: vC, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-cbenutzer', verein_id: vC, freigegeben: 1, rolle: 'benutzer' }
        ]);
        const url = `/api/turniere/${veroeffentlicht}/teilen`;
        assert.equal((await aufruf('u-benutzer', 'POST', url, { vereinIds: 'x' })).status, 400);
        assert.equal((await aufruf('u-benutzer', 'POST', url, { vereinIds: [vC, 'x'] })).status, 400);
        assert.equal((await aufruf('u-benutzer', 'POST', url, { vereinIds: [] })).status, 400);
        const nachVerein = await aufruf('u-benutzer', 'POST', url, { emails: 'adminc@test.de', vereinIds: [vC, vD, vC] });
        assert.equal(nachVerein.status, 200, JSON.stringify(nachVerein.daten));
        // Nur die selbst eingetragene Adresse steht einzeln im Ergebnis; die Admin-Adressen bleiben serverseitig
        assert.deepEqual(nachVerein.daten.ergebnisse, [{ email: 'adminc@test.de', status: 'gesendet' }]);
        assert.deepEqual(nachVerein.daten.vereinsAdmins, { gesendet: 1, fehler: 0 });
        assert.ok(!JSON.stringify(nachVerein.daten).includes('admin@test.de'));
        assert.deepEqual(nachVerein.daten.vereineOhneAdmin, ['JC D (ohne Admin)']);
        assert.equal(mails.length, 2);

        // Einladungen in der Turnierübersicht: nur Admins des eingeladenen Vereins, nur offene Turniere
        const einl = await aufruf('u-adminc', 'GET', '/api/turniere/einladungen');
        assert.equal(einl.status, 200);
        assert.deepEqual(einl.daten.map((t) => [t.id, t.eingeladene_vereine]), [[veroeffentlicht, ['JC C']]]);
        assert.equal(einl.daten[0].status_effektiv, 'veroeffentlicht');
        assert.deepEqual((await aufruf('u-cbenutzer', 'GET', '/api/turniere/einladungen')).daten, []);
        assert.deepEqual((await aufruf('u-admin', 'GET', '/api/turniere/einladungen')).daten, []);
        assert.equal((await aufruf(null, 'GET', '/api/turniere/einladungen')).status, 401);
        // Erneut teilen legt keine zweite Einladung an; ein abgesagtes Turnier verschwindet aus den Einladungen
        await aufruf('u-benutzer', 'POST', url, { vereinIds: [vC] });
        assert.equal((await knex('turnier_einladungen').where({ verein_id: vC }).count('* as n').first()).n, '1');
        await knex('turniere').where({ id: veroeffentlicht }).update({ status: 'abgesagt' });
        assert.deepEqual((await aufruf('u-adminc', 'GET', '/api/turniere/einladungen')).daten, []);
        await knex('turniere').where({ id: veroeffentlicht }).update({ status: 'veroeffentlicht' });

        mailKaputt = true;
        const kaputt = await aufruf('u-benutzer', 'POST', `/api/turniere/${veroeffentlicht}/teilen`, { emails: 'pech@x.de' });
        assert.deepEqual(kaputt.daten.ergebnisse, [{ email: 'pech@x.de', status: 'fehler' }]);
    } finally {
        server.close();
        await db.stoppe();
    }
});
