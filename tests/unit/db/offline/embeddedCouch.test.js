import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { mountEmbeddedCouch, nurLoopback } from '../../../../src/db/offline/embeddedCouch.js';

test('mountEmbeddedCouch stellt eine funktionsfähige, persistente CouchDB-kompatible API bereit', async () => {
    const dataPath = await mkdtemp(path.join(tmpdir(), 'hajime-embedded-couch-'));
    const app = express();
    mountEmbeddedCouch(app, dataPath);

    const server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });

    try {
        const nano = connect(`http://127.0.0.1:${server.address().port}/_couch`);
        const db = await ensureDatabase(nano, 'fundament-test');
        const angelegt = await db.insert({ _id: 'kampf:1', typ: 'kampf', status: 'bereit' });
        assert.equal(angelegt.ok, true);

        const gelesen = await db.get('kampf:1');
        assert.equal(gelesen.status, 'bereit');
    } finally {
        await new Promise((resolve) => server.close(resolve));
        // express-pouchdb betreibt einen internen Daemon (verwaltet die _replicator-
        // Systemdatenbank) mit eigenen, andauernden LevelDB-Handles, die über die
        // Prozesslaufzeit hinweg offen bleiben -- server.close() beendet nur den
        // HTTP-Server, nicht diesen Daemon. Das Verzeichnis danach zu löschen (auch
        // best-effort) kollidiert auf Windows mit dessen laufenden Dateizugriffen und
        // erzeugt eine unhandledRejection statt nur einen harmlosen rm()-Fehler.
        // Deshalb bewusst KEIN Aufräumen hier -- das OS-Temp-Verzeichnis sammelt
        // dadurch ein paar KB pro Testlauf an, die das Betriebssystem selbst aufräumt.
    }
});

test('nurLoopback erlaubt 127.0.0.1/::1 und lehnt alles andere mit 403 ab', () => {
    const erlaubt = (remoteAddress) => {
        let nextAufgerufen = false;
        const req = { socket: { remoteAddress } };
        const res = { status: () => ({ json: () => {} }) };
        nurLoopback(req, res, () => { nextAufgerufen = true; });
        return nextAufgerufen;
    };

    assert.equal(erlaubt('127.0.0.1'), true);
    assert.equal(erlaubt('::1'), true);
    assert.equal(erlaubt('::ffff:127.0.0.1'), true);
    assert.equal(erlaubt('192.168.1.50'), false);

    let statusCode;
    const req = { socket: { remoteAddress: '203.0.113.5' } };
    const res = { status: (code) => { statusCode = code; return { json: () => {} }; } };
    nurLoopback(req, res, () => { throw new Error('next() darf hier nicht aufgerufen werden'); });
    assert.equal(statusCode, 403);
});
