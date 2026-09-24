import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('openTurnierDb legt eine Turnier-Datenbank an und gibt beim zweiten Aufruf dasselbe Handle aus dem Cache zurück', async () => {
    const registry = createTurnierDbRegistry(nano);
    const turnierId = randomUUID();

    const db1 = await registry.openTurnierDb(turnierId);
    await db1.insert({ _id: 'turnier:meta', typ: 'turnier', name: 'Test-Turnier' });

    const db2 = await registry.openTurnierDb(turnierId);
    assert.equal(db2, db1);

    const gelesen = await db2.get('turnier:meta');
    assert.equal(gelesen.name, 'Test-Turnier');
});

test('listTurnierIds findet alle lokal angelegten Turnier-Datenbanken', async () => {
    const registry = createTurnierDbRegistry(nano);
    const idA = randomUUID();
    const idB = randomUUID();

    await registry.openTurnierDb(idA);
    await registry.openTurnierDb(idB);

    const ids = await registry.listTurnierIds();
    assert.ok(ids.includes(idA));
    assert.ok(ids.includes(idB));
});

test('openTurnierDb lehnt eine Turnier-ID mit ungültigen Zeichen ab', async () => {
    const registry = createTurnierDbRegistry(nano);
    await assert.rejects(() => registry.openTurnierDb('../etc'));
    await assert.rejects(() => registry.openTurnierDb('foo/bar'));
});

test('openTurnierDb lehnt undefined, null und Großbuchstaben ab', async () => {
    const registry = createTurnierDbRegistry(nano);
    await assert.rejects(() => registry.openTurnierDb(undefined));
    await assert.rejects(() => registry.openTurnierDb(null));
    await assert.rejects(() => registry.openTurnierDb('ABC123'));
});
