import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createKaempfeRepository(db);
}

test('create legt einen Kampf mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({
        pool_id: 'pool:1',
        kaempfer1_id: 'teilnehmer:1',
        kaempfer2_id: 'teilnehmer:2',
        status: 'angelegt'
    });

    assert.match(kampf._id, /^kampf:/);
    assert.equal(kampf.status, 'angelegt');
    assert.ok(kampf.created_at);
});

test('findByPool liefert nur Kämpfe des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:2', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:1', status: 'bereit' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(k => k.pool_id === 'pool:1'));
});

test('findByPool liefert die Kämpfe in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'V1' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'V2' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'HF1' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(k => k.reihenfolge_nummer), ['V1', 'V2', 'HF1']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({ pool_id: 'pool:1', status: 'angelegt' });

    const gefunden = await repo.findById(kampf._id);
    assert.equal(gefunden.status, 'angelegt');

    const aktualisiert = await repo.update(kampf._id, { status: 'bereit' });
    assert.equal(aktualisiert.status, 'bereit');

    await repo.remove(kampf._id);
    const nachDemLoeschen = await repo.findById(kampf._id);
    assert.equal(nachDemLoeschen, null);
});
