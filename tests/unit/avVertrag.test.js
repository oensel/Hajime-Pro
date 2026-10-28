import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Vertrag zur Auftragsverarbeitung: Text aus den Betreiberangaben, Annahme nur durch Admins des Vereins, Nachweis mit Text und
// SHA-256, neue Turniere erst nach der Annahme der aktuellen Fassung.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'av-vertrag-test-geheimnis';
process.env.RECHTLICHES_DATEI = path.resolve('docs/datenschutz/rechtliches.example.json');

const jwt = (await import('jsonwebtoken')).default;
const { ladeRechtliches } = await import('../../src/services/rechtliches.js');
const { rendereAvVertragText, istAvVertragAktiv, pruefeAvVertragFuerTurnier, ladeAnnahmenJeVerein, AV_VERTRAG_FASSUNG } = await import('../../src/services/avVertrag.js');
const { getAvVertragSeite, getAvVertragApi } = await import('../../src/routes/avVertragRoutes.js');
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('AV-Vertrag: aktiv in der Cloud, abschaltbar, außerhalb nur mit AV_VERTRAG_AKTIV=true', () => {
    assert.equal(istAvVertragAktiv({ BETRIEBSMODUS: 'cloud' }), true);
    assert.equal(istAvVertragAktiv({ BETRIEBSMODUS: 'cloud', AV_VERTRAG_AKTIV: 'false' }), false);
    assert.equal(istAvVertragAktiv({ BETRIEBSMODUS: 'server', IS_OFFLINE: 'true' }), false);
    assert.equal(istAvVertragAktiv({ BETRIEBSMODUS: 'server', IS_OFFLINE: 'true', AV_VERTRAG_AKTIV: 'true' }), true);
});

test('AV-Vertrag: Text aus den Betreiberangaben, Vereinsname maskiert, Lücken rot', () => {
    const r = ladeRechtliches();
    const html = rendereAvVertragText(r, { vereinName: 'JC <b>Test</b> e. V.' });
    assert.ok(!html.includes('class="fehlt"'), 'Beispieldatei ist vollständig');
    assert.match(html, /JC &lt;b&gt;Test&lt;\/b&gt; e\. V\./);
    assert.match(html, /Art\. 28 Datenschutz-Grundverordnung/);
    assert.ok(html.includes(r.daten.hosting.anbieter), 'Anlage 2 nennt den Hoster');
    for (const p of ['§ 1', '§ 3', '§ 5', '§ 7', 'Anlage 1', 'Anlage 2']) assert.ok(html.includes(p), p);
    // allgemeine Fassung für /av-vertrag.html ohne Vereinsnamen
    assert.match(rendereAvVertragText(r), /dem Verein, der diesen Vertrag in Hajime Pro annimmt/);
    // ohne Betreiberangaben: rot markierte Lücken
    const leer = ladeRechtliches({ RECHTLICHES_DATEI: path.resolve('gibt-es-nicht.json') });
    assert.ok(rendereAvVertragText(leer, { vereinName: 'JC' }).includes('class="fehlt"'));
});

test('AV-Vertrag: Annahme durch Admins, Nachweis, Sperre für neue Turniere', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.use(express.json());
    app.set('avVertragPflicht', true);
    app.use(getAvVertragSeite());
    app.use('/api/av-vertrag', getAvVertragApi(knex));
    app.use('/api/turniere', getTurnierRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, methode, pfad, body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', ...(benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await res.text();
        let daten = null;
        try { daten = JSON.parse(text); } catch { daten = text; }
        return { status: res.status, daten };
    };
    const neuesTurnier = { bezeichnung: 'Pokal', ort: 'Nottuln', datum: '2099-06-01', ausrichter: 'JC A', anzahl_kampfflaechen: 1 };
    try {
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const n of ['admin', 'mitglied', 'adminB']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: vA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-mitglied', verein_id: vA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-adminB', verein_id: vB, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-admin', 'u-mitglied']).update({ aktiver_verein_id: vA });
        await knex('benutzer').where({ id: 'u-adminB' }).update({ aktiver_verein_id: vB });

        // öffentliche Fassung
        const seite = await aufruf(null, 'GET', '/av-vertrag.html');
        assert.equal(seite.status, 200);
        assert.match(seite.daten, /<h1>Vertrag zur Auftragsverarbeitung<\/h1>/);
        assert.equal((await aufruf(null, 'GET', '/api/av-vertrag')).status, 401);

        // ohne Annahme kein neues Turnier
        const gesperrt = await aufruf('u-admin', 'POST', '/api/turniere', neuesTurnier);
        assert.equal(gesperrt.status, 403);
        assert.equal(gesperrt.daten.code, 'av_vertrag_fehlt');
        assert.match(gesperrt.daten.error, /JC A hat den Vertrag/);

        // Mitglied ohne Admin-Rolle: sieht den Text, darf nicht annehmen
        const mitglied = await aufruf('u-mitglied', 'GET', '/api/av-vertrag');
        assert.equal(mitglied.status, 200);
        assert.equal(mitglied.daten.darfAnnehmen, false);
        const annahmeMitglied = { name: 'Mia Mitglied', funktion: 'Kassenwartin', bestaetigt: true, fassung: AV_VERTRAG_FASSUNG };
        assert.equal((await aufruf('u-mitglied', 'POST', '/api/av-vertrag/annehmen', annahmeMitglied)).status, 403);

        const offen = await aufruf('u-admin', 'GET', '/api/av-vertrag');
        assert.equal(offen.status, 200);
        assert.deepEqual(offen.daten.verein, { id: vA, name: 'JC A' });
        assert.equal(offen.daten.angenommen, null);
        assert.equal(offen.daten.darfAnnehmen, true);
        assert.equal(offen.daten.vollstaendig, true);
        assert.equal(offen.daten.hatTurnier, false);
        assert.match(offen.daten.html, /<strong>JC A<\/strong>/);

        // Eingaben prüfen: Bestätigung, Fassung, Pflichtfelder
        const gueltig = { name: '  Anna   Admin ', funktion: '1. Vorsitzende', bestaetigt: true, fassung: AV_VERTRAG_FASSUNG };
        assert.equal((await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', { ...gueltig, bestaetigt: false })).status, 400);
        const veraltet = await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', { ...gueltig, fassung: '2000-01-01' });
        assert.equal(veraltet.status, 409);
        assert.equal(veraltet.daten.code, 'fassung_veraltet');
        assert.equal((await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', { ...gueltig, funktion: ' ' })).status, 400);
        assert.equal((await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', { ...gueltig, name: 'x'.repeat(201) })).status, 400);

        const angenommen = await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', gueltig);
        assert.equal(angenommen.status, 200, JSON.stringify(angenommen.daten));
        assert.equal(angenommen.daten.bereits, false);
        assert.equal((await aufruf('u-admin', 'POST', '/api/av-vertrag/annehmen', gueltig)).daten.bereits, true);

        // Nachweis: genau eine Zeile, angenommener Text samt Annahme-Vermerk und passendem SHA-256
        const zeilen = await knex('av_vertrag_annahmen').where({ verein_id: vA });
        assert.equal(zeilen.length, 1);
        const [z] = zeilen;
        assert.equal(z.fassung, AV_VERTRAG_FASSUNG);
        assert.equal(z.benutzer_id, 'u-admin');
        assert.equal(z.name, 'Anna Admin');
        assert.equal(z.funktion, '1. Vorsitzende');
        assert.equal(z.email, 'admin@test.de');
        assert.equal(z.verein_name, 'JC A');
        assert.match(z.text_html, /Angenommen für <strong>JC A<\/strong> am .* durch Anna Admin \(1\. Vorsitzende, admin@test\.de\)/);
        assert.equal(z.text_sha256, crypto.createHash('sha256').update(z.text_html, 'utf8').digest('hex'));

        const stand = await aufruf('u-mitglied', 'GET', '/api/av-vertrag');
        assert.equal(stand.daten.angenommen.name, 'Anna Admin');
        assert.equal(stand.daten.html, z.text_html, 'nach der Annahme gilt der gespeicherte Text');

        // jetzt lässt sich ein Turnier anlegen
        const turnier = await aufruf('u-admin', 'POST', '/api/turniere', neuesTurnier);
        assert.ok(turnier.status < 300, JSON.stringify(turnier.daten));
        assert.equal((await aufruf('u-admin', 'GET', '/api/av-vertrag')).daten.hatTurnier, true);

        // Verein B hat nur eine frühere Fassung angenommen: gilt nicht, Hinweis auf die frühere Annahme
        await knex('av_vertrag_annahmen').insert({ verein_id: vB, fassung: '2000-01-01', benutzer_id: 'u-adminB', name: 'Bert', funktion: 'Vorsitzender', verein_name: 'JC B', text_html: '<p>alt</p>', text_sha256: 'x' });
        const b = await aufruf('u-adminB', 'GET', '/api/av-vertrag');
        assert.equal(b.daten.angenommen, null);
        assert.equal(b.daten.fruehereFassung.fassung, '2000-01-01');
        assert.notEqual(b.daten.html, '<p>alt</p>');
        assert.equal((await pruefeAvVertragFuerTurnier(knex, vB)).code, 'av_vertrag_fehlt');
        assert.equal(await pruefeAvVertragFuerTurnier(knex, vA), null);

        // Übersicht der Super-Admins: nur die aktuelle Fassung zählt
        const je = await ladeAnnahmenJeVerein(knex);
        assert.ok(je.get(vA));
        assert.equal(je.has(vB), false);

        // Verein gelöscht: Annahmen folgen per CASCADE
        await knex('turniere').where({ verein_id: vA }).del();
        await knex('benutzer_vereine').where({ verein_id: vA }).del();
        await knex('vereine').where({ id: vA }).del();
        assert.equal((await knex('av_vertrag_annahmen').where({ verein_id: vA })).length, 0);
    } finally {
        await new Promise((r) => server.close(r));
        await db.stoppe();
    }
});
