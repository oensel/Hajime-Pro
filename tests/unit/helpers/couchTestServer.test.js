import { test } from 'node:test';
import assert from 'node:assert/strict';
import nanoLib from 'nano';
import { startTestCouchServer } from './couchTestServer.js';

test('startTestCouchServer stellt eine funktionsfähige CouchDB-kompatible HTTP-API bereit', async () => {
    const { url, close } = await startTestCouchServer();
    try {
        const nano = nanoLib(url);
        await nano.db.create('smoke');
        const db = nano.db.use('smoke');

        await db.insert({ _id: 'doc1', wert: 42 });
        const doc = await db.get('doc1');

        assert.equal(doc.wert, 42);
    } finally {
        await close();
    }
});
