import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { erzeugeEinzelkaempfeFuerBegegnung, werteBegegnungAus, aktualisiereMannschaftsPool } from '../../../../src/db/kaskaden/mannschaftsBegegnungKaskade.js';

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
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db),
        poolsRepository: createPoolsRepository(db)
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

test('werteBegegnungAus entscheidet nach Siegen, wenn diese nicht ausgeglichen sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-73kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'a2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.siegpunkte_mannschaft1, 2);
    assert.equal(aktualisiert.siegpunkte_mannschaft2, 0);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, 'mannschaft:1');
});

test('werteBegegnungAus entscheidet nach Wertungspunkten, wenn die Siege gleich sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 7, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-73kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'b2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 10 });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.siegpunkte_mannschaft1, 1);
    assert.equal(aktualisiert.siegpunkte_mannschaft2, 1);
    assert.equal(aktualisiert.wertungspunkte_mannschaft1, 7);
    assert.equal(aktualisiert.wertungspunkte_mannschaft2, 10);
    assert.equal(aktualisiert.status, 'beendet');
    assert.equal(aktualisiert.sieger_mannschaft_id, 'mannschaft:2');
});

test('werteBegegnungAus lost bei vollständigem Gleichstand einen Stichkampf in der einzigen kontestierten Gewichtsklasse aus', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a1', kaempfer2_id: 'b1', sieger_id: 'a1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'beendet', kaempfer1_id: 'a2', kaempfer2_id: 'b2', sieger_id: 'b2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:stich1', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:stich2', gewichtsklasse: '-60kg' });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, begegnung._id);

    const aktualisiert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(aktualisiert.stichkampf_gewichtsklasse, '-60kg');
    assert.notEqual(aktualisiert.status, 'beendet');

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 3);
    const stichkampf = kaempfe.find(k => k.status === 'bereit');
    assert.equal(stichkampf.mannschaft_gewichtsklasse, '-60kg');
    assert.equal(stichkampf.kaempfer1_id, 'teilnehmer:stich1');
    assert.equal(stichkampf.kaempfer2_id, 'teilnehmer:stich2');
});

test('werteBegegnungAus greift nicht ein, solange nicht alle Einzelkämpfe beendet sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository } = await neueRepositories();
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: 'pool:1', status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });
    await kaempfeRepository.create({ pool_id: 'pool:1', mannschaftskampf_id: begegnung._id, mannschaft_gewichtsklasse: '-60kg', status: 'bereit', kaempfer1_id: 'a1', kaempfer2_id: 'b1' });

    await werteBegegnungAus(kaempfeRepository, mannschaftskaempfeRepository, null, begegnung._id);

    const unveraendert = await mannschaftskaempfeRepository.findById(begegnung._id);
    assert.equal(unveraendert.siegpunkte_mannschaft1, undefined);
    assert.equal(unveraendert.status, 'bereit');
});

test('aktualisiereMannschaftsPool erzeugt Einzelkämpfe für eine bereite Begegnung', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:1', turnier_teilnehmer_id: 'teilnehmer:a60', gewichtsklasse: '-60kg' });
    await mannschaftMitgliederRepository.create({ mannschaft_id: 'mannschaft:2', turnier_teilnehmer_id: 'teilnehmer:b60', gewichtsklasse: '-60kg' });
    const begegnung = await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'bereit', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: begegnung._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:a60');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:b60');
    const unveraendertePool = await poolsRepository.findById(pool._id);
    assert.equal(unveraendertePool.status, undefined);
});

test('aktualisiereMannschaftsPool schließt den Pool ab, sobald alle Begegnungen entschieden sind', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await mannschaftskaempfeRepository.create({ pool_id: pool._id, status: 'beendet', mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', sieger_mannschaft_id: 'mannschaft:1' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const aktualisiert = await poolsRepository.findById(pool._id);
    assert.equal(aktualisiert.status, 'kaempfe_beendet');
});

test('aktualisiereMannschaftsPool tut nichts, wenn der Pool nicht existiert', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:nicht-vorhanden');
    // Kein Fehlerwurf -> Test besteht bereits durch das Erreichen dieser Zeile.
});

test('aktualisiereMannschaftsPool tut nichts, wenn der Pool keine Begegnungen hat', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await aktualisiereMannschaftsPool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const unveraendert = await poolsRepository.findById(pool._id);
    assert.equal(unveraendert.status, 'geplant');
});
