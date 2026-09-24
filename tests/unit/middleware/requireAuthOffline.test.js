import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';
import { OFFLINE_BENUTZER_ID, OFFLINE_VEREIN_ID } from '../../../src/db/offline/offlineAccounts.js';
import { requireAuth } from '../../../src/middleware/auth.js';

let server;
let nano;
const urspruenglichesIsOffline = process.env.IS_OFFLINE;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
    process.env.IS_OFFLINE = 'true';
});

after(async () => {
    await server.close();
    process.env.IS_OFFLINE = urspruenglichesIsOffline;
});

test('requireAuth legt im Offline-Betrieb zusätzlich den Offline-Verein/-Benutzer in CouchDB an', async () => {
    const app = express();
    app.set('offlineCouchNano', nano);
    app.get('/geschuetzt', requireAuth, (req, res) => res.json({ userId: req.user.id }));

    const server2 = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
    });

    try {
        const antwort = await fetch(`http://127.0.0.1:${server2.address().port}/geschuetzt`);
        const body = await antwort.json();
        assert.equal(body.userId, 'offline_user');

        const offlineAccountsDb = await ensureDatabase(nano, 'offline_accounts');
        const benutzer = await offlineAccountsDb.get(OFFLINE_BENUTZER_ID);
        assert.equal(benutzer.aktiver_verein_id, OFFLINE_VEREIN_ID);
    } finally {
        await new Promise((resolve) => server2.close(resolve));
    }
});
