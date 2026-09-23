import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createVereineRepository } from '../../../../src/db/repositories/vereineRepository.js';

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
    return createVereineRepository(db);
}

test('create legt einen Verein mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const verein = await repo.create({ name: 'JC Beispiel' });

    assert.match(verein._id, /^verein:/);
    assert.equal(verein.name, 'JC Beispiel');
    assert.ok(verein.created_at);
});

test('findByName liefert den Verein mit dem angegebenen Namen', async () => {
    const repo = await neuesRepository();
    await repo.create({ name: 'JC Beispiel' });
    await repo.create({ name: 'JC Anders' });

    const gefunden = await repo.findByName('JC Beispiel');

    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].name, 'JC Beispiel');
});

test('findAll liefert alle Vereine in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ name: 'JC Eins' });
    await repo.create({ name: 'JC Zwei' });
    await repo.create({ name: 'JC Drei' });

    const gefunden = await repo.findAll();

    assert.deepEqual(gefunden.map(v => v.name), ['JC Eins', 'JC Zwei', 'JC Drei']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const verein = await repo.create({ name: 'JC Beispiel' });

    const gefunden = await repo.findById(verein._id);
    assert.equal(gefunden.name, 'JC Beispiel');

    const aktualisiert = await repo.update(verein._id, { name: 'JC Beispiel e.V.' });
    assert.equal(aktualisiert.name, 'JC Beispiel e.V.');

    await repo.remove(verein._id);
    const nachDemLoeschen = await repo.findById(verein._id);
    assert.equal(nachDemLoeschen, null);
});
