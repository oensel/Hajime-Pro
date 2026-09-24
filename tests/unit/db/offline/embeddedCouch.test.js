import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { mountEmbeddedCouch } from '../../../../src/db/offline/embeddedCouch.js';

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
        await rm(dataPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
});
