import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';

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
    return createKampfflaechenRepository(db);
}

test('create legt eine Kampffläche mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const kf = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });

    assert.match(kf._id, /^kampffl:/);
    assert.equal(kf.bezeichnung, 'Matte 1');
    assert.ok(kf.created_at);
});

test('findByTurnier liefert nur Kampfflächen des angegebenen Turniers', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });
    await repo.create({ turnier_id: 'turnier:2', bezeichnung: 'Matte A' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 2' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(kf => kf.turnier_id === 'turnier:1'));
});

test('findByTurnier liefert die Kampfflächen in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 2' });
    await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 3' });

    const gefunden = await repo.findByTurnier('turnier:1');

    assert.deepEqual(gefunden.map(kf => kf.bezeichnung), ['Matte 1', 'Matte 2', 'Matte 3']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const kf = await repo.create({ turnier_id: 'turnier:1', bezeichnung: 'Matte 1' });

    const gefunden = await repo.findById(kf._id);
    assert.equal(gefunden.bezeichnung, 'Matte 1');

    const aktualisiert = await repo.update(kf._id, { status: 'pausiert' });
    assert.equal(aktualisiert.status, 'pausiert');

    await repo.remove(kf._id);
    const nachDemLoeschen = await repo.findById(kf._id);
    assert.equal(nachDemLoeschen, null);
});
