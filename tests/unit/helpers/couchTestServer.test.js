import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import nanoLib from 'nano';
import { startTestCouchServer } from './couchTestServer.js';

// Diese Datei hat nur EINEN Test und braucht deshalb auch nur EINEN
// startTestCouchServer()-Aufruf -- anders als couch.test.js/baseRepository.test.js ist hier
// kein gemeinsamer before()/after()-Server nötig. Der Datenbankname wird trotzdem zufällig
// generiert (statt eines festen Literals), aus Konsistenz mit den anderen Testdateien und um
// zufällige Kollisionen zwischen Läufen auszuschließen. Sollte hier jemals ein zweiter Test
// mit einem weiteren startTestCouchServer()-Aufruf dazukommen, wirft die Erzwingung in
// couchTestServer.js laut auf.
test('startTestCouchServer stellt eine funktionsfähige CouchDB-kompatible HTTP-API bereit', async () => {
    const { url, close } = await startTestCouchServer();
    try {
        const dbName = `test-${randomUUID()}`;
        const nano = nanoLib(url);
        await nano.db.create(dbName);
        const db = nano.db.use(dbName);

        await db.insert({ _id: 'doc1', wert: 42 });
        const doc = await db.get('doc1');

        assert.equal(doc.wert, 42);
    } finally {
        await close();
    }
});
