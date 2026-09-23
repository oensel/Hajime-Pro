import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMitgliedschaftenRepository } from '../../../../src/db/repositories/mitgliedschaftenRepository.js';

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
    return createMitgliedschaftenRepository(db);
}

test('create legt eine Mitgliedschaft mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mitgliedschaft = await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1', freigegeben: 0 });

    assert.match(mitgliedschaft._id, /^mitgliedschaft:/);
    assert.equal(mitgliedschaft.freigegeben, 0);
    assert.ok(mitgliedschaft.created_at);
});

test('findByBenutzer liefert nur Mitgliedschaften des angegebenen Benutzers', async () => {
    const repo = await neuesRepository();
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:2', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:2' });

    const gefunden = await repo.findByBenutzer('benutzer:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.benutzer_id === 'benutzer:1'));
});

test('findByVerein liefert nur Mitgliedschaften des angegebenen Vereins', async () => {
    const repo = await neuesRepository();
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:2', verein_id: 'verein:1' });
    await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:2' });

    const gefunden = await repo.findByVerein('verein:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.verein_id === 'verein:1'));
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mitgliedschaft = await repo.create({ benutzer_id: 'benutzer:1', verein_id: 'verein:1', freigegeben: 0 });

    const gefunden = await repo.findById(mitgliedschaft._id);
    assert.equal(gefunden.freigegeben, 0);

    const aktualisiert = await repo.update(mitgliedschaft._id, { freigegeben: 1 });
    assert.equal(aktualisiert.freigegeben, 1);

    await repo.remove(mitgliedschaft._id);
    const nachDemLoeschen = await repo.findById(mitgliedschaft._id);
    assert.equal(nachDemLoeschen, null);
});
