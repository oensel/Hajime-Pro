import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createBenutzerRepository } from '../../../../src/db/repositories/benutzerRepository.js';

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
    return createBenutzerRepository(db);
}

test('create legt einen Benutzer mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const benutzer = await repo.create({ email: 'max@beispiel.de', vorname: 'Max', nachname: 'Mustermann' });

    assert.match(benutzer._id, /^benutzer:/);
    assert.equal(benutzer.email, 'max@beispiel.de');
    assert.ok(benutzer.created_at);
});

test('findByEmail liefert den Benutzer mit der angegebenen E-Mail-Adresse', async () => {
    const repo = await neuesRepository();
    await repo.create({ email: 'max@beispiel.de' });
    await repo.create({ email: 'erika@beispiel.de' });

    const gefunden = await repo.findByEmail('max@beispiel.de');

    assert.equal(gefunden.length, 1);
    assert.equal(gefunden[0].email, 'max@beispiel.de');
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const benutzer = await repo.create({ email: 'max@beispiel.de' });

    const gefunden = await repo.findById(benutzer._id);
    assert.equal(gefunden.email, 'max@beispiel.de');

    const aktualisiert = await repo.update(benutzer._id, { nachname: 'Mustermann' });
    assert.equal(aktualisiert.nachname, 'Mustermann');

    await repo.remove(benutzer._id);
    const nachDemLoeschen = await repo.findById(benutzer._id);
    assert.equal(nachDemLoeschen, null);
});
