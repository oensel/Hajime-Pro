import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';

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
    return createTurnierTeilnehmerRepository(db);
}

test('create legt einen Teilnehmer mit Erstellungszeitpunkt an', async () => {
    const repo = await neuesRepository();
    const teilnehmer = await repo.create({
        turnier_id: 'turnier:1',
        vorname: 'Max',
        nachname: 'Mustermann',
        geburtsjahr: 2005,
        geschlecht: 'm',
        verein: 'JC Beispiel',
        gewicht: 73.5,
        altersklasse: 'U18',
        gewichtsklasse: '-73kg'
    });

    assert.match(teilnehmer._id, /^teilnehmer:/);
    assert.equal(teilnehmer.nachname, 'Mustermann');
    assert.ok(teilnehmer.created_at);
});

test('findAll liefert alle Teilnehmer dieser Datenbank in Erstellungsreihenfolge', async () => {
    const repo = await neuesRepository();
    await repo.create({ nachname: 'Erste' });
    await repo.create({ nachname: 'Zweite' });
    await repo.create({ nachname: 'Dritte' });

    const gefunden = await repo.findAll();

    assert.deepEqual(gefunden.map(t => t.nachname), ['Erste', 'Zweite', 'Dritte']);
});

test('findByPool liefert nur Teilnehmer des angegebenen Pools', async () => {
    const repo = await neuesRepository();
    await repo.create({ pool_id: 'pool:1', nachname: 'ImPool' });
    await repo.create({ pool_id: 'pool:2', nachname: 'AndererPool' });
    await repo.create({ nachname: 'NochNichtZugeordnet' });

    const gefunden = await repo.findByPool('pool:1');

    assert.deepEqual(gefunden.map(t => t.nachname), ['ImPool']);
});

test('findById, update und remove funktionieren wie im generischen Repository', async () => {
    const repo = await neuesRepository();
    const teilnehmer = await repo.create({ turnier_id: 'turnier:1', nachname: 'Mustermann' });

    const gefunden = await repo.findById(teilnehmer._id);
    assert.equal(gefunden.nachname, 'Mustermann');

    const aktualisiert = await repo.update(teilnehmer._id, { status: 'kampfbereit' });
    assert.equal(aktualisiert.status, 'kampfbereit');

    await repo.remove(teilnehmer._id);
    const nachDemLoeschen = await repo.findById(teilnehmer._id);
    assert.equal(nachDemLoeschen, null);
});
