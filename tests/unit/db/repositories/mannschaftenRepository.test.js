import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';

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
    return createMannschaftenRepository(db);
}

test('create legt eine Mannschaft mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mannschaft = await repo.create({ verein: 'JC Beispiel', bezeichnung: 'JC Beispiel I', status: 'angemeldet' });

    assert.match(mannschaft._id, /^mannschaft:/);
    assert.equal(mannschaft.bezeichnung, 'JC Beispiel I');
    assert.ok(mannschaft.created_at);
});

test('findByPool liefert nur Mannschaften des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team A' });
    await repo.create({ pool_id: 'pool:2', bezeichnung: 'Team B' });
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team C' });

    const gefunden = await repo.findByPool('pool:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.pool_id === 'pool:1'));
});

test('findUnassigned liefert nur Mannschaften ohne zugewiesenen Pool', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: null, bezeichnung: 'Team A' });
    await repo.create({ pool_id: 'pool:1', bezeichnung: 'Team B' });
    await repo.create({ pool_id: null, bezeichnung: 'Team C' });

    const gefunden = await repo.findUnassigned();

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.pool_id === null));
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mannschaft = await repo.create({ bezeichnung: 'Team A' });

    const gefunden = await repo.findById(mannschaft._id);
    assert.equal(gefunden.bezeichnung, 'Team A');

    const aktualisiert = await repo.update(mannschaft._id, { status: 'zugewiesen' });
    assert.equal(aktualisiert.status, 'zugewiesen');

    await repo.remove(mannschaft._id);
    const nachDemLoeschen = await repo.findById(mannschaft._id);
    assert.equal(nachDemLoeschen, null);
});
