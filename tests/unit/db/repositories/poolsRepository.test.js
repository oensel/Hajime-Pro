import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';

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
    return createPoolsRepository(db);
}

test('create legt einen Pool mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const pool = await repo.create({
        turnier_id: 'turnier:1',
        bezeichnung: 'U18 Männlich -73kg',
        altersklasse: 'U18',
        geschlecht: 'm',
        gewichtsklasse: '-73kg'
    });

    assert.match(pool._id, /^pool:/);
    assert.equal(pool.bezeichnung, 'U18 Männlich -73kg');
    assert.ok(pool.created_at);
});

test('findByTurnier liefert nur Pools des angegebenen Turniers', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool A' });
    await repo.create({ turnier_id: 'turnier:2', bezeichnung: 'Pool B' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool C' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(p => p.turnier_id === 'turnier:1'));
});

test('findByTurnier liefert die Pools in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 1' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 2' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 3' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.deepEqual(gefunden.map(p => p.bezeichnung), ['Pool 1', 'Pool 2', 'Pool 3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const pool = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Pool 1' });

    const gefunden = await repo.findById(pool._id);
    assert.equal(gefunden.bezeichnung, 'Pool 1');

    const aktualisiert = await repo.update(pool._id, { status: 'gestartet' });
    assert.equal(aktualisiert.status, 'gestartet');

    await repo.remove(pool._id);
    const nachDemLoeschen = await repo.findById(pool._id);
    assert.equal(nachDemLoeschen, null);
});
