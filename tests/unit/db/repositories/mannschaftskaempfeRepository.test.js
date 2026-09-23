import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';

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
    return createMannschaftskaempfeRepository(db);
}

test('create legt eine Begegnung mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const begegnung = await repo.create({
        pool_id: 'pool:1',
        mannschaft1_id: 'mannschaft:1',
        mannschaft2_id: 'mannschaft:2',
        status: 'angelegt'
    });

    assert.match(begegnung._id, /^mannschaftskampf:/);
    assert.equal(begegnung.status, 'angelegt');
    assert.ok(begegnung.created_at);
});

test('findByPool liefert nur Begegnungen des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:2', status: 'angelegt' });
    await repo.create({ pool_id: 'pool:1', status: 'bereit' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(b => b.pool_id === 'pool:1'));
});

test('findByPool liefert die Begegnungen in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B1' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B2' });
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'B3' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(b => b.reihenfolge_nummer), ['B1', 'B2', 'B3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const begegnung = await repo.create({ pool_id: 'pool:1', status: 'angelegt' });

    const gefunden = await repo.findById(begegnung._id);
    assert.equal(gefunden.status, 'angelegt');

    const aktualisiert = await repo.update(begegnung._id, { status: 'bereit' });
    assert.equal(aktualisiert.status, 'bereit');

    await repo.remove(begegnung._id);
    const nachDemLoeschen = await repo.findById(begegnung._id);
    assert.equal(nachDemLoeschen, null);
});
