import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createTurnierRepository } from '../../../../src/db/repositories/turnierRepository.js';

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
    return createTurnierRepository(db);
}

test('get liefert null, solange kein Turnier gespeichert wurde', async () => {
    const repo = await neuesRepository();

    const turnier = await repo.get();

    assert.equal(turnier, null);
});

test('save legt das Turnier-Dokument mit fester ID beim ersten Aufruf an', async () => {
    const repo = await neuesRepository();

    const gespeichert = await repo.save({ bezeichnung: 'Landesmeisterschaft', ort: 'Musterstadt' });

    assert.equal(gespeichert._id, 'turnier:meta');
    assert.equal(gespeichert.bezeichnung, 'Landesmeisterschaft');
    assert.ok(gespeichert._rev);
});

test('save ersetzt dasselbe Dokument, statt ein zweites anzulegen', async () => {
    const repo = await neuesRepository();
    await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'entwurf' });

    const aktualisiert = await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'veroeffentlicht' });

    assert.equal(aktualisiert._id, 'turnier:meta');
    assert.equal(aktualisiert.status, 'veroeffentlicht');

    const geladen = await repo.get();
    assert.equal(geladen.status, 'veroeffentlicht');
});

test('save ersetzt Felder vollständig, statt sie mit dem alten Stand zu vermischen', async () => {
    const repo = await neuesRepository();
    await repo.save({ bezeichnung: 'Landesmeisterschaft', ort: 'Musterstadt', status: 'entwurf' });

    const aktualisiert = await repo.save({ bezeichnung: 'Landesmeisterschaft', status: 'veroeffentlicht' });

    assert.equal(aktualisiert.ort, undefined);
});
