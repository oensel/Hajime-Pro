import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createMitgliedschaftenRepository } from '../../../../src/db/repositories/mitgliedschaftenRepository.js';
import {
    ensureOfflineAccountsDb,
    OFFLINE_VEREIN_ID,
    OFFLINE_BENUTZER_ID
} from '../../../../src/db/offline/offlineAccounts.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('ensureOfflineAccountsDb legt Offline Club, offline_user und deren Mitgliedschaft an', async () => {
    const db = await ensureOfflineAccountsDb(nano);

    const verein = await db.get(OFFLINE_VEREIN_ID);
    assert.equal(verein.name, 'Offline Club');

    const benutzer = await db.get(OFFLINE_BENUTZER_ID);
    assert.equal(benutzer.email, 'offline@hajime.os');
    assert.equal(benutzer.aktiver_verein_id, OFFLINE_VEREIN_ID);

    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);
    const mitgliedschaften = await mitgliedschaftenRepository.query({
        benutzer_id: OFFLINE_BENUTZER_ID,
        verein_id: OFFLINE_VEREIN_ID
    });
    assert.equal(mitgliedschaften.length, 1);
    assert.equal(mitgliedschaften[0].freigegeben, true);
});

test('ensureOfflineAccountsDb ist idempotent -- ein zweiter Aufruf legt nichts doppelt an', async () => {
    await ensureOfflineAccountsDb(nano);
    const db = await ensureOfflineAccountsDb(nano);

    const mitgliedschaftenRepository = createMitgliedschaftenRepository(db);
    const mitgliedschaften = await mitgliedschaftenRepository.query({
        benutzer_id: OFFLINE_BENUTZER_ID,
        verein_id: OFFLINE_VEREIN_ID
    });
    assert.equal(mitgliedschaften.length, 1);
});
