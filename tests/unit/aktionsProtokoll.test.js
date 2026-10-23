import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
process.env.SUPER_ADMIN_2FA = 'false';
process.env.JWT_SECRET = 'test-geheimnis-protokoll';

const { starteTestPostgres } = await import('../helpers/testPostgres.js');
const pr = await import('../../src/services/aktionsProtokoll.js');
const { getProtokollRoutes } = await import('../../src/routes/protokollRoutes.js');
const { requireAuth } = await import('../../src/middleware/auth.js');
const { login } = await import('../../src/controllers/authController.js');
const { hashPassword } = await import('../../src/utils/password.js');
const express = (await import('express')).default;
const jwt = (await import('jsonwebtoken')).default;

test('Protokoll: Pfade normalisieren und Klartexte', () => {
    const n = pr.normalisierePfad('/api/nutzer/c3f73817-cdda-45b5-b683-64b96fb9e5d7/mitgliedschaft/12?x=1');
    assert.equal(n.pfad, '/api/nutzer/:id/mitgliedschaft/:id');
    assert.deepEqual(n.ids, ['c3f73817-cdda-45b5-b683-64b96fb9e5d7', '12']);
    assert.equal(pr.normalisierePfad('/api/einladung/abcdefghijklmnopqrstuvwxyz0123').pfad, '/api/einladung/:token');

    assert.deepEqual(pr.beschreibeAktion('DELETE', '/api/turniere/:id'), { aktion: 'turnier.loeschen', beschreibung: 'Turnier gelöscht' });
    assert.deepEqual(pr.beschreibeAktion('POST', '/api/nutzer/:id/sperren'), { aktion: 'nutzer.sperren', beschreibung: 'Konto gesperrt bzw. entsperrt' });
    // unbekannte Route: Klartext aus Ressource, Unterpunkt und Methode
    assert.deepEqual(pr.beschreibeAktion('POST', '/api/pools/aufteilen'), { aktion: 'pools.post.aufteilen', beschreibung: 'Pool: aufteilen angelegt bzw. ausgeführt' });
    assert.equal(pr.beschreibeAktion('PUT', '/api/teilnehmer/:id').beschreibung, 'Teilnehmer geändert');

    assert.equal(pr.istProtokollierbar('POST', '/api/turniere'), true);
    assert.equal(pr.istProtokollierbar('GET', '/api/turniere'), false);
    for (const pfad of ['/api/live/ingest', '/api/sync/test', '/api/video/x', '/api/durchsage', '/api/cluster/gesund', '/db/x']) {
        assert.equal(pr.istProtokollierbar('POST', pfad), false, pfad);
    }
});

const warteAuf = async (bedingung, ms = 3000) => {
    const ende = Date.now() + ms;
    for (;;) {
        const ergebnis = await bedingung();
        if (ergebnis) return ergebnis;
        if (Date.now() > ende) throw new Error('Zeitüberschreitung beim Warten auf das Protokoll');
        await new Promise((r) => setTimeout(r, 50));
    }
};

const OPFER = '11111111-2222-3333-4444-555555555555';

test('Protokoll: Middleware, Rechte, Filter, Anmeldeereignisse, Aufbewahrung', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    let server;
    try {
        const [a, b] = (await knex('vereine').insert([{ name: 'JC Alpha' }, { name: 'JC Beta' }]).returning('id')).map((r) => (typeof r === 'object' ? r.id : r));
        const benutzer = [
            ['sa', 'Sara', 'Super', true], ['ad', 'Adam', 'Admin', false], ['bn', 'Bea', 'Benutzer', false],
            ['hf', 'Hans', 'Helfer', false], ['ad2', 'Anna', 'Beta', false], [OPFER, 'Otto', 'Opfer', false]
        ];
        for (const [id, vorname, nachname, super_] of benutzer) {
            await knex('benutzer').insert({
                id, email: id === OPFER ? 'opfer@test.de' : `${id}@test.de`, vorname, nachname, password_hash: hashPassword('Passwort-123'),
                ist_super_admin: super_, super_admin_modus: super_, email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: id === 'ad2' ? b : a
            });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'ad', verein_id: a, freigegeben: 1, rolle: 'admin' }, { benutzer_id: 'bn', verein_id: a, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'hf', verein_id: a, freigegeben: 1, rolle: 'helfer' }, { benutzer_id: 'ad2', verein_id: b, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: OPFER, verein_id: a, freigegeben: 1, rolle: 'helfer' }
        ]);
        const [tA] = (await knex('turniere').insert({ bezeichnung: 'Cup A', ort: 'X', datum: '2026-11-01', ausrichter: 'JC Alpha', verein_id: a, status: 'veroeffentlicht' }).returning('id')).map((r) => (typeof r === 'object' ? r.id : r));

        const app = express();
        app.set('knex', knex);
        app.use(express.json());
        app.use(pr.erzeugeProtokollMiddleware(knex));
        app.put('/api/turniere/:id', requireAuth, (_req, res) => res.json({ success: true }));
        app.post('/api/pools/aufteilen', requireAuth, (_req, res) => res.json({ success: true }));
        app.post('/api/helfer/einsatz', requireAuth, (_req, res) => res.json({ success: true }));
        app.post('/api/nutzer/:id/sperren', requireAuth, (_req, res) => res.status(400).json({ success: false }));
        app.delete('/api/nutzer/:id', requireAuth, async (req, res) => { await knex('benutzer').where({ id: req.params.id }).del(); res.json({ success: true }); });
        app.get('/api/turniere', requireAuth, (_req, res) => res.json({ success: true }));
        app.post('/api/live/ingest', requireAuth, (_req, res) => res.json({ success: true }));
        app.use('/api/protokoll', getProtokollRoutes(knex));
        server = createServer(app);
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const basis = `http://127.0.0.1:${server.address().port}`;
        const token = (id) => jwt.sign({ id, email: `${id}@test.de` }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const rufe = (id, pfad, optionen = {}) => fetch(`${basis}${pfad}`, {
            ...optionen, headers: { 'Content-Type': 'application/json', ...(id ? { Authorization: `Bearer ${token(id)}` } : {}), ...(optionen.headers || {}) }
        });
        const body = JSON.stringify({ password: 'geheim123', turnierId: tA });

        // Aktionen verschiedener Rollen
        await rufe('sa', `/api/turniere/${tA}`, { method: 'PUT', body });
        await rufe('ad', `/api/turniere/${tA}`, { method: 'PUT', body });
        await rufe('bn', '/api/pools/aufteilen', { method: 'POST', body: JSON.stringify({ turnierId: tA }) });
        await rufe('hf', '/api/helfer/einsatz', { method: 'POST', body: '{}' });
        await rufe('ad2', '/api/helfer/einsatz', { method: 'POST', body: '{}' });
        // nicht protokolliert: Lesen, Fehlschlag, ohne Anmeldung, ignorierter Pfad
        await rufe('ad', '/api/turniere');
        await rufe('ad', `/api/nutzer/${OPFER}/sperren`, { method: 'POST', body: '{}' });
        await rufe(null, `/api/turniere/${tA}`, { method: 'PUT', body: '{}' });
        await rufe('ad', '/api/live/ingest', { method: 'POST', body: '{}' });
        // Ziel wird vor dem Löschen festgehalten
        await rufe('ad', `/api/nutzer/${OPFER}`, { method: 'DELETE' });

        const alle = await warteAuf(async () => { const z = await knex('aktionsprotokoll').orderBy('id'); return z.length >= 6 ? z : null; });
        assert.equal(alle.length, 6, alle.map((z) => z.aktion).join(', '));
        const von = (id, aktion) => alle.find((z) => z.benutzer_id === id && z.aktion === aktion);

        const saEintrag = von('sa', 'turnier.aendern');
        assert.equal(saEintrag.rolle, 'super_admin');
        assert.equal(saEintrag.verein_id, a, 'Verein aus dem Turnier');
        assert.equal(saEintrag.verein_name, 'JC Alpha');
        assert.equal(saEintrag.turnier_id, tA);
        assert.equal(saEintrag.beschreibung, 'Turnier geändert');
        assert.equal(saEintrag.pfad, '/api/turniere/:id');
        assert.equal(saEintrag.benutzer_name, 'Sara Super');
        assert.equal(von('ad', 'turnier.aendern').rolle, 'admin');
        assert.equal(von('bn', 'pools.post.aufteilen').rolle, 'benutzer');
        assert.equal(von('hf', 'helfer.post.einsatz').rolle, 'helfer');
        assert.equal(von('ad2', 'helfer.post.einsatz').verein_id, b);
        const geloescht = von('ad', 'nutzer.loeschen');
        assert.match(geloescht.details.ziel, /Otto Opfer <opfer@test\.de>/);
        assert.equal(JSON.stringify(alle).includes('geheim123'), false, 'Eingaben werden nie gespeichert');

        // Sichtbarkeit
        const liste = async (id, abfrage = '') => { const r = await rufe(id, `/api/protokoll${abfrage}`); return { status: r.status, daten: await r.json() }; };
        const super_ = await liste('sa');
        assert.equal(super_.daten.gesamt, 6);
        const adminA = await liste('ad');
        assert.equal(adminA.daten.gesamt, 5, 'nur Verein A, einschließlich der Aktionen von Benutzer, Helfer und Super-Admin');
        assert.ok(adminA.daten.eintraege.every((e) => e.verein_id === a));
        assert.equal((await liste('ad2')).daten.gesamt, 1);
        assert.equal((await liste('bn')).status, 403);
        assert.equal((await liste('hf')).status, 403);
        assert.equal((await rufe(null, '/api/protokoll')).status, 401);
        assert.equal((await liste('ad', `?vereinId=${b}`)).status, 403, 'fremder Verein');
        assert.equal((await liste('sa', `?vereinId=${b}`)).daten.gesamt, 1);
        const vereine = await (await rufe('ad', '/api/protokoll/vereine')).json();
        assert.deepEqual(vereine.vereine.map((v) => v.name), ['JC Alpha']);
        assert.equal((await (await rufe('sa', '/api/protokoll/vereine')).json()).vereine.length, 2);

        // Filter und Seiten
        assert.equal((await liste('sa', '?benutzer=adam')).daten.gesamt, 2);
        assert.equal((await liste('sa', '?suche=gelöscht')).daten.gesamt, 1);
        assert.equal((await liste('sa', '?suche=Opfer')).daten.gesamt, 1, 'Suche auch in den Einzelheiten');
        assert.equal((await liste('sa', '?von=2999-01-01')).daten.gesamt, 0);
        assert.equal((await liste('sa', `?bis=${new Date().toISOString().slice(0, 10)}`)).daten.gesamt, 6, 'der heutige Tag zählt zum Zeitraum');
        const seite1 = (await liste('sa', '?proSeite=4&seite=1')).daten;
        const seite2 = (await liste('sa', '?proSeite=4&seite=2')).daten;
        assert.deepEqual([seite1.seiten, seite1.eintraege.length, seite2.eintraege.length], [2, 4, 2]);
        assert.ok(seite1.eintraege[0].zeitpunkt >= seite2.eintraege[0].zeitpunkt, 'neueste zuerst');
        assert.equal((await liste('sa', '?suche=%25')).daten.gesamt, 0, 'Platzhalter werden nicht ausgewertet');

        // Anmeldeereignisse über den Auth-Controller
        const anfrage = (email, password) => ({ body: { email, password }, headers: {}, socket: { remoteAddress: '203.0.113.9' }, app: { get: () => knex } });
        const antwort = () => ({ statusCode: 200, status(c) { this.statusCode = c; return this; }, json(x) { this.body = x; return this; } });
        let res = antwort();
        await login(knex, anfrage('hf@test.de', 'falsch'), res);
        assert.equal(res.statusCode, 401);
        res = antwort();
        await login(knex, anfrage('unbekannt@test.de', 'falsch'), res);
        res = antwort();
        await login(knex, anfrage('hf@test.de', 'Passwort-123'), res);
        assert.ok(res.body.token);
        const ereignisse = await warteAuf(async () => { const z = await knex('aktionsprotokoll').where('aktion', 'like', 'anmeldung.%').orderBy('id'); return z.length >= 3 ? z : null; });
        // Die Einträge entstehen ohne Warten, ihre Reihenfolge in der Tabelle ist daher nicht die der Aufrufe: nach Inhalt suchen
        assert.deepEqual(ereignisse.map((z) => z.aktion).sort(), ['anmeldung.erfolgreich', 'anmeldung.fehlgeschlagen', 'anmeldung.fehlgeschlagen']);
        const falschBekannt = ereignisse.find((z) => z.benutzer_id === 'hf' && z.aktion === 'anmeldung.fehlgeschlagen');
        assert.equal(falschBekannt.verein_id, a, 'ein Admin sieht die fehlgeschlagene Anmeldung seiner Mitglieder');
        assert.equal(falschBekannt.ip, '203.0.113.9');
        const unbekannt = ereignisse.find((z) => z.benutzer_email === 'unbekannt@test.de');
        assert.equal(unbekannt.benutzer_id, null);
        assert.equal(unbekannt.verein_id, null, 'unbekanntes Konto: nur der Super-Admin sieht es');
        assert.equal(ereignisse.find((z) => z.aktion === 'anmeldung.erfolgreich').rolle, 'helfer');
        assert.equal(JSON.stringify(ereignisse).includes('Passwort-123'), false);
        assert.equal((await liste('ad', '?suche=anmeldung')).daten.gesamt, 2, 'Admin sieht Anmeldungen seiner Mitglieder');

        // Aufbewahrung
        await knex('aktionsprotokoll').insert({ zeitpunkt: knex.raw("now() - interval '400 days'"), aktion: 'alt', beschreibung: 'alter Eintrag' });
        assert.equal(await pr.bereinigeProtokoll(knex, 365), 1);
        assert.equal((await knex('aktionsprotokoll').where({ aktion: 'alt' })).length, 0);
        assert.equal(await pr.bereinigeProtokoll(knex, 0), 0, 'ungültige Frist löscht nichts');
    } finally {
        if (server) await new Promise((r) => server.close(r));
        await db.stoppe();
    }
});
