// Turnierleitungs-Passwort: Start-Passwort aus der Umgebung, erzwungene Änderung, gehashte Ablage.
// Die DB ist durch eine kleine Attrappe ersetzt (eine Zeile, id = 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import * as sp from '../../src/utils/steuerungPasswort.js';
import { getAuthRoutes } from '../../src/routes/authRoutes.js';

function attrappe() {
    let zeile = null;
    const tabelle = () => ({
        where: () => ({ first: async () => zeile }),
        insert: (neu) => ({ onConflict: () => ({ merge: async () => { zeile = { ...neu }; } }) })
    });
    const knex = (name) => {
        assert.equal(name, 'steuerung_passwort');
        return tabelle();
    };
    knex.fn = { now: () => 'jetzt' };
    knex.zeile = () => zeile;
    knex.loesche = () => { zeile = null; };
    return knex;
}

const knex = attrappe();
let aufraeumen = () => {};

test.before(async () => {
    process.env.STEUERUNG_PASSWORD = 'startpass1';
    await sp.initialisiere(knex);
});

test.after(() => aufraeumen());

test('Start-Passwort gilt, bis ein eigenes gesetzt ist', () => {
    assert.equal(sp.istGesetzt(), true);
    assert.equal(sp.istStartPasswort(), true);
    assert.equal(sp.pruefe('startpass1'), true);
    assert.equal(sp.pruefe('falsch'), false);
    assert.equal(sp.pruefe(''), false);
    assert.equal(sp.pruefe(undefined), false);
    assert.equal(sp.sha256Aktuell(), sp.sha256Hex('startpass1'));
});

test('neues Passwort: Regeln', () => {
    assert.match(sp.pruefeNeuesPasswort('kurz'), /mindestens 8 Zeichen/);
    assert.match(sp.pruefeNeuesPasswort(' leerzeichen1 '), /mindestens 8 Zeichen/);
    assert.match(sp.pruefeNeuesPasswort('startpass1'), /unterscheiden/);
    assert.equal(sp.pruefeNeuesPasswort('einEigenes-Passwort'), null);
    // ohne Kenntnis des bisherigen (Client-Konfig) darf es auch gleich bleiben, die Längenregel gilt weiter
    assert.equal(sp.pruefeNeuesPasswort('startpass1', { gleichErlaubt: true }), null);
    assert.match(sp.pruefeNeuesPasswort('kurz', { gleichErlaubt: true }), /mindestens 8 Zeichen/);
});

test('GET /mode und POST /verify melden die ausstehende Änderung; Änderung löst das Start-Passwort ab', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/auth', getAuthRoutes(knex));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    aufraeumen = () => server.close();
    const basis = `http://127.0.0.1:${server.address().port}/api/auth`;
    const post = (pfad, passwort, body) => fetch(`${basis}${pfad}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(passwort ? { 'x-steuerung-password': passwort } : {}) },
        body: JSON.stringify(body || {})
    });

    assert.deepEqual(await (await fetch(`${basis}/mode`)).json(), { passwordRequired: true });

    const verify = await post('/verify', null, { password: 'startpass1' });
    assert.equal(verify.status, 200);
    assert.deepEqual(await verify.json(), { success: true, aenderungErforderlich: true });
    assert.equal((await post('/verify', null, { password: 'falsch' })).status, 401);

    // Ohne das bisherige Passwort geht die Änderung nicht, zu kurze/gleiche Passwörter werden abgelehnt.
    assert.equal((await post('/steuerung-passwort', null, { neuesPasswort: 'einEigenes-Passwort' })).status, 401);
    assert.equal((await post('/steuerung-passwort', 'startpass1', { neuesPasswort: 'kurz' })).status, 400);
    assert.equal((await post('/steuerung-passwort', 'startpass1', { neuesPasswort: 'startpass1' })).status, 400);
    assert.equal(knex.zeile(), null);

    const geaendert = await post('/steuerung-passwort', 'startpass1', { neuesPasswort: 'einEigenes-Passwort' });
    assert.equal(geaendert.status, 200);

    // In der DB liegt nur der Hash (scrypt) und der SHA-256 für die Client-Geräte, kein Klartext.
    assert.match(knex.zeile().passwort_hash, /^scrypt\$/);
    assert.ok(!JSON.stringify(knex.zeile()).includes('einEigenes-Passwort'));
    assert.equal(knex.zeile().passwort_sha256, sp.sha256Hex('einEigenes-Passwort'));

    assert.equal(sp.istStartPasswort(), false);
    assert.equal(sp.pruefe('startpass1'), false, 'Start-Passwort gilt nicht mehr');
    assert.equal(sp.pruefe('einEigenes-Passwort'), true);
    assert.equal(sp.sha256Aktuell(), sp.sha256Hex('einEigenes-Passwort'));

    const nachher = await post('/verify', null, { password: 'einEigenes-Passwort' });
    assert.deepEqual(await nachher.json(), { success: true, aenderungErforderlich: false });
    assert.equal((await post('/verify', null, { password: 'startpass1' })).status, 401);
});

test('ein zweiter Knoten übernimmt das geänderte Passwort beim Nachladen aus der DB', async () => {
    // Zustand dieses Prozesses zurücksetzen und aus der (inzwischen befüllten) DB neu laden.
    await sp.initialisiere(knex);
    assert.equal(sp.pruefe('einEigenes-Passwort'), true);
    assert.equal(sp.pruefeHash('einEigenes-Passwort', knex.zeile().passwort_hash), true);
    assert.equal(sp.pruefeHash('anderes', knex.zeile().passwort_hash), false);
    assert.equal(sp.pruefeHash('x', 'kaputt'), false);
});
