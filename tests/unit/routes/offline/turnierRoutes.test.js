import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';
import { getTurnierRoutesOffline } from '../../../../src/routes/offline/turnierRoutes.js';

let couchServer;
let nano;
let httpServer;
let baseUrl;
const urspruenglichesIsOffline = process.env.IS_OFFLINE;

before(async () => {
    process.env.IS_OFFLINE = 'true';
    couchServer = await startTestCouchServer();
    nano = connect(couchServer.url);
    const registry = createTurnierDbRegistry(nano);

    const app = express();
    app.use(express.json());
    app.use('/api/turniere', getTurnierRoutesOffline(registry));

    httpServer = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${httpServer.address().port}/api/turniere`;
});

after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    await couchServer.close();
    if (urspruenglichesIsOffline === undefined) {
        delete process.env.IS_OFFLINE;
    } else {
        process.env.IS_OFFLINE = urspruenglichesIsOffline;
    }
});

test('POST / legt ein Turnier an, GET /:id liest es zurück, POST /:id/veroeffentlichen ändert den Status', async () => {
    const createResp = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Routen-Test', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });
    assert.equal(createResp.status, 201);
    const { turnierId } = await createResp.json();

    const getResp = await fetch(`${baseUrl}/${turnierId}`);
    assert.equal(getResp.status, 200);
    const turnier = await getResp.json();
    assert.equal(turnier.bezeichnung, 'Routen-Test');

    const veroeffentlichenResp = await fetch(`${baseUrl}/${turnierId}/veroeffentlichen`, { method: 'POST' });
    assert.equal(veroeffentlichenResp.status, 200);
});

test('GET / listet Turniere', async () => {
    await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Für die Liste', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });

    const listResp = await fetch(baseUrl);
    assert.equal(listResp.status, 200);
    const liste = await listResp.json();
    assert.ok(liste.some((t) => t.bezeichnung === 'Für die Liste'));
});

test('DELETE /:id löscht ein leeres Turnier', async () => {
    const createResp = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bezeichnung: 'Zu löschen', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' })
    });
    const { turnierId } = await createResp.json();

    const deleteResp = await fetch(`${baseUrl}/${turnierId}`, { method: 'DELETE' });
    assert.equal(deleteResp.status, 200);

    const getResp = await fetch(`${baseUrl}/${turnierId}`);
    assert.equal(getResp.status, 404);
});

test('POST /import legt ein neues Turnier an, GET /:id/export liefert es als Datei zurück', async () => {
    const importDaten = {
        turnier: { bezeichnung: 'Routen-Import', ort: 'X', datum: '2020-01-01', ausrichter: 'Z', status: 'abgeschlossen' },
        kampfflaechen: [], pools: [], teilnehmer: [], kaempfe: [], mannschaften: [], mannschaft_mitglieder: []
    };
    const contentBase64 = Buffer.from(JSON.stringify(importDaten), 'utf-8').toString('base64');

    const importResp = await fetch(`${baseUrl}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentBase64 })
    });
    assert.equal(importResp.status, 201);
    const { turnierId } = await importResp.json();

    const exportResp = await fetch(`${baseUrl}/${turnierId}/export`);
    assert.equal(exportResp.status, 200);
    const exportiert = await exportResp.json();
    assert.equal(exportiert.turnier.bezeichnung, 'Routen-Import');
});
