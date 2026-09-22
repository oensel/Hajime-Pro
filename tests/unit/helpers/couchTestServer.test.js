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

test('startTestCouchServer darf nicht mit "Replicator already active" crashen wenn zweimal hintereinander aufgerufen', async () => {
    // Erster Server-Aufruf mit Datenbank-Operationen
    const first = await startTestCouchServer();
    try {
        const nano = nanoLib(first.url);
        await nano.db.create('test1');
        const db = nano.db.use('test1');
        await db.insert({ _id: 'a', value: 1 });
        const doc = await db.get('a');
        assert.equal(doc.value, 1);
    } finally {
        await first.close();
    }

    // Zweiter Server-Aufruf im selben Node-Prozess
    // Hauptziel: kein "Replicator already active"-Crash, der vorher aufgetreten ist,
    // weil alle Aufrufe den gleichen PouchDB-Konstruktor teilten
    const second = await startTestCouchServer();
    try {
        const nano = nanoLib(second.url);
        await nano.db.create('test2');
        const db = nano.db.use('test2');
        await db.insert({ _id: 'b', value: 2 });
        const doc = await db.get('b');
        assert.equal(doc.value, 2);
    } finally {
        await second.close();
    }
});
