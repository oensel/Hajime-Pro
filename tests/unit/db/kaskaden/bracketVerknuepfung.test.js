import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { verknuepfeQuellenFuerPool, verknuepfeQuellenFuerMannschaftsPool } from '../../../../src/db/kaskaden/bracketVerknuepfung.js';

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
    return createKaempfeRepository(db);
}

async function neuesMannschaftsRepository() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return createMannschaftskaempfeRepository(db);
}

test('verknuepfeQuellenFuerPool setzt die quelle_kampf_id/_typ-Felder gemäß der Topologie', async () => {
    const repo = await neuesRepository();
    const kampfH1 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H1' });
    const kampfH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const kampfF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    const topologie = { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } };
    await verknuepfeQuellenFuerPool(repo, 'pool:1', topologie);

    const aktualisiert = await repo.findById(kampfF._id);
    assert.equal(aktualisiert.kaempfer1_quelle_kampf_id, kampfH1._id);
    assert.equal(aktualisiert.kaempfer1_quelle_typ, 'sieger');
    assert.equal(aktualisiert.kaempfer2_quelle_kampf_id, kampfH2._id);
    assert.equal(aktualisiert.kaempfer2_quelle_typ, 'sieger');
});

test('verknuepfeQuellenFuerPool lässt Kämpfe ohne passenden Topologie-Eintrag unverändert', async () => {
    const repo = await neuesRepository();
    const kampf = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'unbekannt' });

    await verknuepfeQuellenFuerPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(kampf._id);
    assert.equal(unveraendert.kaempfer1_quelle_kampf_id, undefined);
});

test('verknuepfeQuellenFuerPool überspringt einen Eintrag, wenn eine referenzierte Quelle im Pool fehlt', async () => {
    const repo = await neuesRepository();
    // H1 fehlt absichtlich -- unvollständige Altdaten simulieren, siehe Kommentar im Original.
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const kampfF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    await verknuepfeQuellenFuerPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(kampfF._id);
    assert.equal(unveraendert.kaempfer1_quelle_kampf_id, undefined);
});

test('verknuepfeQuellenFuerMannschaftsPool setzt die mannschaft_quelle-Felder gemäß der Topologie', async () => {
    const repo = await neuesMannschaftsRepository();
    const begegnungH1 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H1' });
    const begegnungH2 = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const begegnungF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    const topologie = { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } };
    await verknuepfeQuellenFuerMannschaftsPool(repo, 'pool:1', topologie);

    const aktualisiert = await repo.findById(begegnungF._id);
    assert.equal(aktualisiert.mannschaft1_quelle_kampf_id, begegnungH1._id);
    assert.equal(aktualisiert.mannschaft1_quelle_typ, 'sieger');
    assert.equal(aktualisiert.mannschaft2_quelle_kampf_id, begegnungH2._id);
    assert.equal(aktualisiert.mannschaft2_quelle_typ, 'sieger');
});

test('verknuepfeQuellenFuerMannschaftsPool überspringt einen Eintrag, wenn eine referenzierte Quelle fehlt', async () => {
    const repo = await neuesMannschaftsRepository();
    // H1 fehlt absichtlich -- unvollständige Altdaten simulieren, siehe Kommentar im Original.
    await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'H2' });
    const begegnungF = await repo.create({ pool_id: 'pool:1', reihenfolge_nummer: 'F' });

    await verknuepfeQuellenFuerMannschaftsPool(repo, 'pool:1', { F: { k1: ['H1', 'sieger'], k2: ['H2', 'sieger'] } });

    const unveraendert = await repo.findById(begegnungF._id);
    assert.equal(unveraendert.mannschaft1_quelle_kampf_id, undefined);
});
