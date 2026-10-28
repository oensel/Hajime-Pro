import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Nachrichten: Kontakt/Vereinsanfrage ohne Konto, Vereinsadmins schreiben an Mitglieder und fremde Admins, Postfach mit Ungelesen-Zähler.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'nachrichten-test-geheimnis';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { getNachrichtenRoutes, getKontaktRoutes } = await import('../../src/routes/nachrichtenRoutes.js');
const { loescheAlteNachrichten } = await import('../../src/services/nachrichten.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('Nachrichten: Kontakt, Vereinsanfrage, Admin-Nachrichten, Postfach', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    const sende = async (m) => { mails.push(m); };
    const app = express();
    app.use(express.json());
    app.use('/api/nachrichten', getNachrichtenRoutes(knex, { sende }));
    app.use('/api/kontakt', getKontaktRoutes(knex, { sende }));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, methode, pfad, body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', ...(benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    try {
        const vA = id((await knex('vereine').insert({ name: 'Judo Club Alpha' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'Judo Club Beta' }).returning('id'))[0]);
        const konto = (n, extra = {}) => knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: knex.fn.now(), ...extra });
        await konto('super', { ist_super_admin: true, super_admin_modus: true });
        for (const n of ['adminA', 'helferA', 'adminB', 'adminB2']) await konto(n);
        const mitglied = (n, v, rolle) => knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle });
        await mitglied('adminA', vA, 'admin'); await mitglied('helferA', vA, 'helfer');
        await mitglied('adminB', vB, 'admin'); await mitglied('adminB2', vB, 'admin');
        await knex('benutzer').whereIn('id', ['u-adminA', 'u-helferA']).update({ aktiver_verein_id: vA });

        // Kontakt ohne Konto: Pflichtangaben, bestehender Verein, Vereinsanfrage
        assert.equal((await aufruf(null, 'POST', '/api/kontakt', { art: 'kontakt', name: 'X', email: 'kaputt', betreff: 'a', text: 'b' })).status, 400);
        assert.equal((await aufruf(null, 'POST', '/api/kontakt', { art: 'vereinsanfrage', name: 'Neu Mensch', email: 'neu@test.de', vereinsname: 'Judo Club Alpha', text: 'bitte' })).status, 409);
        assert.equal((await aufruf(null, 'POST', '/api/kontakt', { art: 'vereinsanfrage', name: 'Neu Mensch', email: 'neu@test.de', vereinsname: 'JC', text: 'bitte' })).status, 400);
        const anfrage = await aufruf(null, 'POST', '/api/kontakt', { art: 'vereinsanfrage', name: 'Neu Mensch', email: 'neu@test.de', vereinsname: 'Judo Club Gamma e.V.', text: 'Bitte anlegen' });
        assert.equal(anfrage.status, 200);
        assert.deepEqual(mails.map((m) => m.to), ['super@test.de']);

        // Super-Admin sieht sie, sonst niemand; Zähler 1
        assert.equal((await aufruf('u-super', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 1);
        assert.equal((await aufruf('u-adminA', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 0);
        const liste = (await aufruf('u-super', 'GET', '/api/nachrichten')).daten.threads;
        assert.equal(liste.length, 1);
        assert.equal(liste[0].betreff, 'Vereinsanfrage: Judo Club Gamma e.V.');
        assert.equal(liste[0].ungelesen, true);
        const threadId = liste[0].id;
        assert.equal((await aufruf('u-adminA', 'GET', `/api/nachrichten/${threadId}`)).status, 404);

        // Lesen setzt den Zähler zurück; Antwort geht per Mail an die Adresse ohne Konto
        const gelesen = (await aufruf('u-super', 'GET', `/api/nachrichten/${threadId}`)).daten.thread;
        assert.equal(gelesen.absenderEmail, 'neu@test.de');
        assert.equal((await aufruf('u-super', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 0);
        mails.length = 0;
        assert.equal((await aufruf('u-super', 'POST', `/api/nachrichten/${threadId}/antworten`, { text: 'Ist angelegt.' })).status, 200);
        assert.deepEqual(mails.map((m) => m.to), ['neu@test.de']);

        // Helfer darf nur den Super-Admins schreiben
        assert.equal((await aufruf('u-helferA', 'POST', '/api/nachrichten', { betreff: 'Hallo', text: 'x', ziel: { art: 'personen', benutzerIds: ['u-adminA'] } })).status, 403);
        mails.length = 0;
        const frage = await aufruf('u-helferA', 'POST', '/api/nachrichten', { betreff: 'Frage', text: 'Wie geht das?', ziel: { art: 'super_admins' } });
        assert.equal(frage.status, 200);
        assert.deepEqual(mails.map((m) => m.to), ['super@test.de']);
        assert.equal((await aufruf('u-super', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 1);
        await aufruf('u-super', 'POST', `/api/nachrichten/${frage.daten.id}/antworten`, { text: 'So.' });
        assert.equal((await aufruf('u-helferA', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 1);

        // Admin A: an den eigenen Verein (alle Mitglieder), an einen fremden Verein (nur Admins), namentlich; fremde Helfer nicht
        mails.length = 0;
        const training = await aufruf('u-adminA', 'POST', '/api/nachrichten', { betreff: 'Training', text: 'Am Montag', ziel: { art: 'verein', vereinId: vA } });
        assert.equal(training.status, 200);
        assert.deepEqual(mails.map((m) => m.to), ['helferA@test.de']);
        mails.length = 0;
        assert.equal((await aufruf('u-adminA', 'POST', '/api/nachrichten', { betreff: 'Turnier', text: 'Hallo Beta', ziel: { art: 'verein', vereinId: vB } })).status, 200);
        assert.deepEqual(mails.map((m) => m.to).sort(), ['adminB2@test.de', 'adminB@test.de']);
        assert.equal((await aufruf('u-adminB2', 'GET', '/api/nachrichten/ungelesen')).daten.anzahl, 1);
        assert.equal((await aufruf('u-adminA', 'POST', '/api/nachrichten', { betreff: 'Direkt', text: 'Hi', ziel: { art: 'personen', benutzerIds: ['u-adminB'] } })).status, 200);
        const auswahl = (await aufruf('u-adminA', 'GET', '/api/nachrichten/empfaenger')).daten;
        assert.deepEqual(auswahl.eigeneVereine.map((v) => v.name), ['Judo Club Alpha']);
        assert.deepEqual(auswahl.eigeneVereine[0].mitglieder.map((m) => m.id), ['u-helferA']);
        const fremdeAdmins = (await aufruf('u-adminA', 'GET', `/api/nachrichten/empfaenger/admins?vereinId=${vB}`)).daten.admins;
        assert.equal(fremdeAdmins.length, 2);
        assert.equal((await aufruf('u-helferA', 'GET', '/api/nachrichten/empfaenger')).daten.darfAnKonten, false);
        assert.equal((await aufruf('u-adminB', 'GET', `/api/nachrichten/${training.daten.id}`)).status, 404);

        // Löschfrist: Unterhaltungen ohne neue Nachricht seit mehr als N Tagen werden mitsamt Nachrichten gelöscht
        const vorher = Number((await knex('nachrichten_threads').count({ n: '*' }).first()).n);
        await knex('nachrichten_threads').where({ id: training.daten.id }).update({ aktualisiert_am: knex.raw("now() - interval '400 days'") });
        assert.equal(await loescheAlteNachrichten(knex, 0), 0, 'ungültige Frist löscht nichts');
        assert.equal(await loescheAlteNachrichten(knex), 1);
        assert.equal(Number((await knex('nachrichten_threads').count({ n: '*' }).first()).n), vorher - 1);
        assert.equal((await knex('nachrichten').where({ thread_id: training.daten.id })).length, 0);
    } finally {
        server.close();
        await db.stoppe();
    }
});
