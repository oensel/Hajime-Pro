import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { pruefeHatEchteKaempfe } from '../../../../src/db/offline/turnierStatusPruefung.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

test('pruefeHatEchteKaempfe ist false, wenn das Turnier noch keine Pools hat', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), false);
});

test('pruefeHatEchteKaempfe ist false, wenn alle Kämpfe noch nicht gestartet sind', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    const pool = await poolsRepository.create({ bezeichnung: 'Pool A' });
    await kaempfeRepository.create({ pool_id: pool._id, status: 'bereit' });

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), false);
});

test('pruefeHatEchteKaempfe ist true, sobald ein Kampf gestartet oder beendet ist', async () => {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    const poolsRepository = createPoolsRepository(db);
    const kaempfeRepository = createKaempfeRepository(db);

    const pool = await poolsRepository.create({ bezeichnung: 'Pool A' });
    await kaempfeRepository.create({ pool_id: pool._id, status: 'gestartet' });

    assert.equal(await pruefeHatEchteKaempfe(poolsRepository, kaempfeRepository), true);
});
