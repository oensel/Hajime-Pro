import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';

// Genau EIN Server pro Testdatei (before/after), geteilt von allen test()-Blöcken darin --
// mehrere startTestCouchServer()-Aufrufe in derselben Datei (= demselben Prozess, node --test
// isoliert nur zwischen Dateien, nicht innerhalb einer Datei) bringen express-pouchdbs interne
// Datenbank-Registrierung durcheinander (bestätigt per Spike, unabhängig vom gewählten
// Datenbanknamen). Jeder einzelne Test bekommt trotzdem seine eigene, isolierte Datenbank
// über einen zufälligen Namen innerhalb dieses einen Servers.
let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('ensureDatabase legt eine neue Datenbank an und liefert einen nutzbaren Handle', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);

    await db.insert({ _id: 'probe', ok: true });
    const doc = await db.get('probe');

    assert.equal(doc.ok, true);
});

test('ensureDatabase ist idempotent, wenn die Datenbank schon existiert', async () => {
    const dbName = `test-${randomUUID()}`;
    await ensureDatabase(nano, dbName);
    const db = await ensureDatabase(nano, dbName);

    await db.insert({ _id: 'probe', ok: true });
    const doc = await db.get('probe');

    assert.equal(doc.ok, true);
});
