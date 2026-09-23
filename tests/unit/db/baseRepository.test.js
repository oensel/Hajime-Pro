import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../src/db/couch.js';
import { createRepository } from '../../../src/db/baseRepository.js';

// Genau EIN Server für die ganze Datei (before/after) -- siehe Kommentar in couch.test.js:
// mehrere startTestCouchServer()-Aufrufe in derselben Datei bringen express-pouchdbs interne
// Datenbank-Registrierung durcheinander. Jeder Test bekommt trotzdem sein eigenes Repository
// auf einer frischen, zufällig benannten Datenbank innerhalb dieses einen Servers.
let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neuesRepository(typePrefix) {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createRepository({ db, typePrefix });
}

test('create legt ein Dokument mit Typ-Präfix-ID an und liefert es vollständig zurück', async () => {
    const repo = await neuesRepository('kampffl');
    const doc = await repo.create({ bezeichnung: 'Matte 1' });

    assert.match(doc._id, /^kampffl:/);
    assert.equal(doc.typ, 'kampffl');
    assert.equal(doc.bezeichnung, 'Matte 1');
    assert.ok(doc._rev);
});

test('create ignoriert eingeschleuste reservierte Felder wie _deleted', async () => {
    const repo = await neuesRepository('kampffl');
    const doc = await repo.create({ bezeichnung: 'Matte 1', _deleted: true, _rev: 'geraten' });

    const gefunden = await repo.findById(doc._id);
    assert.ok(gefunden, 'Dokument muss trotz eingeschleustem _deleted weiterhin existieren');
    assert.equal(gefunden.bezeichnung, 'Matte 1');
});

test('update ignoriert eingeschleuste reservierte Felder wie _deleted', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1', status: 'frei' });

    await repo.update(created._id, { status: 'pausiert', _deleted: true });

    const gefunden = await repo.findById(created._id);
    assert.ok(gefunden, 'Dokument muss trotz eingeschleustem _deleted weiterhin existieren');
    assert.equal(gefunden.status, 'pausiert');
});

test('findById liefert ein vorhandenes Dokument', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1' });

    const found = await repo.findById(created._id);

    assert.equal(found.bezeichnung, 'Matte 1');
});

test('findById liefert null für ein nicht vorhandenes Dokument', async () => {
    const repo = await neuesRepository('kampffl');

    const found = await repo.findById('kampffl:nicht-vorhanden');

    assert.equal(found, null);
});

test('update ändert einzelne Felder, ohne die übrigen zu verlieren', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1', status: 'frei' });

    const updated = await repo.update(created._id, { status: 'pausiert' });

    assert.equal(updated.status, 'pausiert');
    assert.equal(updated.bezeichnung, 'Matte 1');
});

test('remove löscht ein Dokument endgültig', async () => {
    const repo = await neuesRepository('kampffl');
    const created = await repo.create({ bezeichnung: 'Matte 1' });

    await repo.remove(created._id);
    const found = await repo.findById(created._id);

    assert.equal(found, null);
});

test('query findet Dokumente über zusätzliche Selector-Felder, beschränkt auf den eigenen Typ', async () => {
    const repo = await neuesRepository('kampffl');
    await repo.create({ bezeichnung: 'Matte 1', turnier_id: 'turnier:1' });
    await repo.create({ bezeichnung: 'Matte 2', turnier_id: 'turnier:1' });
    await repo.create({ bezeichnung: 'Matte 3', turnier_id: 'turnier:2' });

    const treffer = await repo.query({ turnier_id: 'turnier:1' });

    assert.equal(treffer.length, 2);
});

test('query schneidet Ergebnisse nicht bei CouchDBs Mango-Default von 25 ab', async () => {
    const repo = await neuesRepository('kampffl');
    const anzahl = 30;
    for (let i = 0; i < anzahl; i += 1) {
        await repo.create({ bezeichnung: `Matte ${i}` });
    }

    const treffer = await repo.query({});

    assert.equal(treffer.length, anzahl);
});
