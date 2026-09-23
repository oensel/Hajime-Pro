import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { erzeugeEinzelkaempfeFuerBegegnung } from '../../../../src/db/kaskaden/mannschaftsBegegnungKaskade.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neueRepositories() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

test('erzeugeEinzelkaempfeFuerBegegnung erzeugt einen Einzelkampf pro gemeinsam besetzter Gewichtsklasse', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-73kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a73', gewichtsklasse: '-73kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b73', gewichtsklasse: '-73kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 2);
    const byKlasse = Object.fromEntries(kaempfe.map(k => [k.mannschaft_gewichtsklasse, k]));
    assert.equal(byKlasse['-60kg'].kaempfer1_id, 'teilnehmer:a60');
    assert.equal(byKlasse['-60kg'].kaempfer2_id, 'teilnehmer:b60');
    assert.equal(byKlasse['-60kg'].status, 'bereit');
    assert.equal(byKlasse['-73kg'].kaempfer1_id, 'teilnehmer:a73');
    assert.equal(byKlasse['-73kg'].kaempfer2_id, 'teilnehmer:b73');
});

test('erzeugeEinzelkaempfeFuerBegegnung überspringt Gewichtsklassen, die nicht von beiden Mannschaften besetzt sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-73kg', '-90kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a73', gewichtsklasse: '-73kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].mannschaft_gewichtsklasse, '-60kg');
});

test('erzeugeEinzelkaempfeFuerBegegnung markiert die Begegnung als beendet ohne Sieger, wenn keine gemeinsame Gewichtsklasse besetzt ist', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg', '-90kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b90', gewichtsklasse: '-90kg' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 0);
    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, null);
});

test('erzeugeEinzelkaempfeFuerBegegnung ist idempotent, wenn bereits Einzelkämpfe existieren', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    await kaempfeRepository.create({ pool_id: pool._id, mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'bereit', kaempfer1_id: 'teilnehmer:a60', kaempfer2_id: 'teilnehmer:b60' });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
});

test('erzeugeEinzelkaempfeFuerBegegnung tut nichts, wenn eine der beiden Mannschaften noch nicht feststeht', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const pool = { _id: 'pool:1', mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) };
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'angelegt', mannschaft1_id: null, mannschaft2_id: null });

    await erzeugeEinzelkaempfeFuerBegegnung(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung, pool);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 0);
    const unveraendert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(unveraendert.status, 'angelegt');
});
