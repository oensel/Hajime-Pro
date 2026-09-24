import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';
import {
    createTurnier, getTurnier, getTurniere, updateTurnier, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung
} from '../../../../src/controllers/offline/turnierController.js';

let server;
let nano;
let registry;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
    registry = createTurnierDbRegistry(nano);
});

after(async () => {
    await server.close();
});

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

test('createTurnier legt ein Turnier mit Kampfflächen an und getTurnier liest es zurück', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Testturnier', ort: 'Musterstadt', datum: '2026-05-10', ausrichter: 'TV Muster', anzahl_kampfflaechen: '2' }
    }, createRes);

    assert.equal(createRes.statusCode, 201);
    assert.ok(createRes.body.success);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 2);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Testturnier');
    assert.equal(getRes.body.status_effektiv, 'entwurf');
    assert.equal(getRes.body.teilnehmer_anzahl, 0);
});

test('createTurnier lehnt Startgeld ohne Zahlungsdaten ab', async () => {
    const res = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', startgeld: '10' }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
});

test('updateTurnier passt Felder an und synchronisiert die Kampfflächen-Anzahl', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Vorher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '1' }
    }, createRes);
    const turnierId = createRes.body.turnierId;

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'Nachher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '3' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 3);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Nachher');
});

test('updateTurnier meldet 404 für eine unbekannte Turnier-ID', async () => {
    const res = fakeRes();
    await updateTurnier(registry, {
        params: { id: 'nicht-vorhanden-00000000-0000-0000-0000-000000000000' },
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z' }
    }, res);
    assert.equal(res.statusCode, 404);
});

test('getTurniere listet alle lokal angelegten Turniere', async () => {
    const registryEigen = createTurnierDbRegistry(nano);
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste A', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, fakeRes());
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste B', ort: 'X', datum: '2026-02-01', ausrichter: 'Z' } }, fakeRes());

    const res = fakeRes();
    await getTurniere(registryEigen, { query: {} }, res);
    const bezeichnungen = res.body.map((t) => t.bezeichnung);
    assert.ok(bezeichnungen.includes('Liste A'));
    assert.ok(bezeichnungen.includes('Liste B'));
});

test('deleteTurnier löscht ein leeres Entwurfs-Turnier vollständig', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Löschbar', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const deleteRes = fakeRes();
    await deleteTurnier(registry, { params: { id: turnierId } }, deleteRes);
    assert.equal(deleteRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.statusCode, 404);
});

test('Lebenszyklus: veroeffentlichen -> absagen', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Lebenszyklus', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const veroeffentlichenRes = fakeRes();
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, veroeffentlichenRes);
    assert.equal(veroeffentlichenRes.statusCode, 200);

    const absagenRes = fakeRes();
    await sageTurnierAb(registry, { params: { id: turnierId } }, absagenRes);
    assert.equal(absagenRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.status, 'abgesagt');
});

test('beendeDurchfuehrung lehnt ein Turnier ab, das nicht in Durchführung ist', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Nicht in Durchführung', ort: 'X', datum: '2099-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const res = fakeRes();
    await beendeDurchfuehrung(registry, { params: { id: turnierId } }, res);
    assert.equal(res.statusCode, 403);
});
