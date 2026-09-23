import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';

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
    return createMannschaftMitgliederRepository(db);
}

test('create legt ein Roster-Mitglied mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const mitglied = await repo.create({
        mannschaft_id: 'mannschaft:1',
        turnier_teilnehmer_id: 'teilnehmer:1',
        gewichtsklasse: '-73kg'
    });

    assert.match(mitglied._id, /^mitglied:/);
    assert.equal(mitglied.gewichtsklasse, '-73kg');
    assert.ok(mitglied.created_at);
});

test('findByMannschaft liefert nur Mitglieder der angegebenen Mannschaft', async () => {
    const repo = await neuesRepository();
    await repo.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:1', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:2', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:3', gewichtsklasse: '-73kg' });

    const gefunden = await repo.findByMannschaft('mannschaft:1');

    assert.equal(gefunden.length, 2);
    assert.ok(gefunden.every(m => m.mannschaft_id === 'mannschaft:1'));
});

test('findByMannschaft liefert die Mitglieder in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-60kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-73kg' });
    await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-90kg' });

    const gefunden = await repo.findByMannschaft('mannschaft:1');

    assert.deepEqual(gefunden.map(m => m.gewichtsklasse), ['-60kg', '-73kg', '-90kg']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const mitglied = await repo.create({ mannschaft_id: 'mannschaft:1', gewichtsklasse: '-60kg' });

    const gefunden = await repo.findById(mitglied._id);
    assert.equal(gefunden.gewichtsklasse, '-60kg');

    const aktualisiert = await repo.update(mitglied._id, { gewichtsklasse: '-66kg' });
    assert.equal(aktualisiert.gewichtsklasse, '-66kg');

    await repo.remove(mitglied._id);
    const nachDemLoeschen = await repo.findById(mitglied._id);
    assert.equal(nachDemLoeschen, null);
});
