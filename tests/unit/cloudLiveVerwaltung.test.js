import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Cloud-Live-Verwaltung mit echtem JWT gegen ein eingebettetes PostgreSQL, Betriebsmodus cloud (Rechteprüfung aktiv).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'cloud-live-test-geheimnis';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { getCloudLiveVerwaltungRoutes } = await import('../../src/cloudLive/verwaltungRoutes.js');
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');
const { erzeugeVerwalter } = await import('../../src/cloudLive/verwalter.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

let jetztWert = new Date('2099-05-03T10:00:00Z'); // einen Tag vor dem Turnier (Startfenster)

test('Cloud-Live-Verwaltung: Rechte, Starten, Mischen-Sperre, Export, Code erneuern, Sperren', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cl-verw-'));
    const verwalter = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis }, maxTurniere: 10 });
    const app = express();
    app.use(express.json());
    app.use('/api/cloud-live', getCloudLiveVerwaltungRoutes(knex, { verwalter, jetzt: () => jetztWert }));
    app.use('/api/turniere', getTurnierRoutes(knex));
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
    const get = (u, p) => aufruf(u, 'GET', p);
    const post = (u, p, b = {}) => aufruf(u, 'POST', p, b);

    try {
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const n of ['benutzer', 'admin', 'fremd']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-benutzer', verein_id: vA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-admin', verein_id: vA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-fremd', verein_id: vB, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-benutzer', 'u-admin']).update({ aktiver_verein_id: vA });
        await knex('benutzer').where({ id: 'u-fremd' }).update({ aktiver_verein_id: vB });
        const turnier = async (name, status) => id((await knex('turniere').insert({
            bezeichnung: name, ort: 'Halle', datum: '2099-05-04', anmeldeschluss: '2020-01-01', ausrichter: 'JC', verein_id: vA, status
        }).returning('id'))[0]);
        const tLive = await turnier('Live-Turnier', 'veroeffentlicht');
        const tEntwurf = await turnier('Entwurf', 'entwurf');
        const tGeholt = await turnier('Geholt', 'veroeffentlicht');
        await knex('kampfflaechen').insert({ turnier_id: tLive, bezeichnung: 'Matte 1' });

        // --- Rechte ---
        assert.equal((await get(null, `/api/cloud-live/${tLive}`)).status, 401);
        assert.equal((await get('u-benutzer', `/api/cloud-live/${tLive}`)).status, 403, 'Benutzer ist für Geräte gedacht, nicht fürs Live-Schalten');
        assert.equal((await get('u-fremd', `/api/cloud-live/${tLive}`)).status, 403, 'Admin eines fremden Vereins');
        assert.equal((await post('u-benutzer', `/api/cloud-live/${tLive}/starten`)).status, 403);

        // --- Status vor dem Start ---
        const vorher = (await get('u-admin', `/api/cloud-live/${tLive}`)).daten;
        assert.equal(vorher.live, false);
        assert.equal(vorher.geholt, false);
        assert.equal(vorher.maxInstanzen, 10);
        assert.equal(vorher.offeneInstanzen, 0);

        // --- Entwurf lässt sich nicht live schalten ---
        const entwurf = await post('u-admin', `/api/cloud-live/${tEntwurf}/starten`);
        assert.equal(entwurf.status, 409);

        // --- Startfenster: nur ab dem Vortag, nicht Wochen vorher und nicht nach dem Turniertag ---
        jetztWert = new Date('2099-04-01T10:00:00Z');
        const zuFrueh = await post('u-admin', `/api/cloud-live/${tLive}/starten`);
        assert.equal(zuFrueh.status, 409);
        assert.equal(zuFrueh.daten.code, 'zu_frueh');
        jetztWert = new Date('2099-05-06T10:00:00Z');
        assert.equal((await post('u-admin', `/api/cloud-live/${tLive}/starten`)).daten.code, 'vorbei');
        jetztWert = new Date('2099-05-03T10:00:00Z');

        // --- Starten ---
        const gestartet = await post('u-admin', `/api/cloud-live/${tLive}/starten`);
        assert.equal(gestartet.status, 200, JSON.stringify(gestartet.daten));
        assert.equal(gestartet.daten.live, true);
        assert.match(gestartet.daten.code, /^\d{6}$/);
        assert.equal(gestartet.daten.url, `https://hajime.example.de/turnierlive/${gestartet.daten.schluessel}`);
        assert.equal(gestartet.daten.qr, `https://hajime.example.de/turnierlive/${gestartet.daten.schluessel}#code=${gestartet.daten.code}`);
        assert.equal(gestartet.daten.offeneInstanzen, 1);
        assert.deepEqual(gestartet.daten.geraete, []);
        assert.equal(gestartet.daten.geheimnis, undefined, 'das Geheimnis verlässt den Server nie über diese API');
        // zweimal starten ist unschädlich
        assert.equal((await post('u-admin', `/api/cloud-live/${tLive}/starten`)).daten.schluessel, gestartet.daten.schluessel);

        // --- Export: gesperrt solange live ---
        assert.equal((await get('u-admin', `/api/turniere/${tLive}/export`)).status, 409);

        // --- Mischen-Sperre: Export markiert das Turnier als geholt, Live-Schalten verlangt Bestätigung ---
        assert.equal((await get('u-admin', `/api/turniere/${tGeholt}/export`)).status, 200);
        assert.equal((await get('u-admin', `/api/cloud-live/${tGeholt}`)).daten.geholt, true);
        const abgelehnt = await post('u-admin', `/api/cloud-live/${tGeholt}/starten`);
        assert.equal(abgelehnt.status, 409);
        assert.equal(abgelehnt.daten.code, 'bereits_geholt');
        assert.equal(verwalter.offeneAnzahl(), 1);
        const bestaetigt = await post('u-admin', `/api/cloud-live/${tGeholt}/starten`, { bestaetigt: true });
        assert.equal(bestaetigt.status, 200);
        assert.equal(verwalter.offeneAnzahl(), 2);

        // --- Code erneuern und Sperren ---
        const alt = (await get('u-admin', `/api/cloud-live/${tLive}`)).daten;
        const neu = (await post('u-admin', `/api/cloud-live/${tLive}/code-erneuern`)).daten;
        assert.equal(neu.schluessel, alt.schluessel);
        assert.match(neu.code, /^\d{6}$/);
        const gesperrt = (await post('u-admin', `/api/cloud-live/${tLive}/sperren`, { wert: true })).daten;
        assert.equal(gesperrt.gesperrt, true);
        assert.equal((await post('u-admin', `/api/cloud-live/${tLive}/sperren`, { wert: false })).daten.gesperrt, false);

        // --- Beenden: Geräte mit ungesendeten Änderungen, Rechte, danach wieder exportierbar ---
        const instanz = verwalter.instanzFuerTurnier(tLive);
        await instanz.db.put({
            _id: 'client:g1', dokumenttyp: 'client', client_id: 'g1', geraet: 'Notebook', matte_id: 1,
            letzter_kontakt: new Date().toISOString(), ausstehend: 4, bearbeitet_von: 'client-heartbeat'
        });
        assert.equal((await post('u-benutzer', `/api/cloud-live/${tLive}/beenden`)).status, 403);
        assert.deepEqual((await get('u-admin', `/api/cloud-live/${tLive}`)).daten.geraete.map((g) => [g.clientId, g.ausstehend]), [['g1', 4]]);
        const offen = await post('u-admin', `/api/cloud-live/${tLive}/beenden`);
        assert.equal(offen.status, 409);
        assert.equal(offen.daten.ausstehendeGeraete, 4);
        const beendet = await post('u-admin', `/api/cloud-live/${tLive}/beenden`, { erzwingen: true });
        assert.equal(beendet.status, 200);
        assert.equal(beendet.daten.live, false);
        assert.equal(beendet.daten.ausstehendeGeraete, 4);
        assert.equal((await get('u-admin', `/api/turniere/${tLive}/export`)).status, 200);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await verwalter.schliesseAlle();
        await db.stoppe();
        try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ }
    }
});
