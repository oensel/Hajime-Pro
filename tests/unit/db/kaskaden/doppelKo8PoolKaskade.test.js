import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo8PoolKaskade.js';

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
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}

test('initialisierePool füllt bei 8 Teilnehmern verschiedener Vereine das Raster ohne Freilose und trennt Vereine', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const angaben = [
        [50, 'ClubX'], [90, 'ClubX'], [55, 'ClubB'], [60, 'ClubC'],
        [65, 'ClubD'], [70, 'ClubE'], [75, 'ClubF'], [80, 'ClubG']
    ];
    const t = {};
    for (const [gewicht, verein] of angaben) {
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht, verein });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 11);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung gemäß Vereinstrennungs-Algorithmus (von Hand nachvollzogen):
    // H1: 50(ClubX)-65(ClubD), H2: 70(ClubE)-90(ClubX), H3: 55(ClubB)-75(ClubF), H4: 60(ClubC)-80(ClubG)
    assert.equal(byReihenfolge.H1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t[65]._id);
    assert.equal(byReihenfolge.H1.status, 'bereit');
    assert.equal(byReihenfolge.H2.kaempfer1_id, t[70]._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, t[90]._id);
    assert.equal(byReihenfolge.H3.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.H4.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.H4.kaempfer2_id, t[80]._id);

    for (const nr of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen: H5 bezieht seine Kämpfer aus H1/H2-Siegern.
    assert.equal(byReihenfolge.H5.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H5.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H5.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F.kaempfer1_quelle_kampf_id, byReihenfolge.H5._id);
});

test('initialisierePool weist Freilose an den korrekten Rasterpositionen zu, inkl. Sonderregel für die besetzte Seite', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Positionen [7,0,4,3] -> Raster: [null, t1, t2, null, null, null, null, null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, null);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t1._id);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 10);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.kaempfer1_id, t2._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, null);
    assert.equal(byReihenfolge.H2.sieger_id, t2._id);
    assert.equal(byReihenfolge.H2.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H2.unterbewertung_kaempfer2, 0);

    assert.equal(byReihenfolge.H3.status, 'freilos');
    assert.equal(byReihenfolge.H3.kaempfer1_id, null);
    assert.equal(byReihenfolge.H3.kaempfer2_id, null);
    assert.equal(byReihenfolge.H3.sieger_id, null);

    assert.equal(byReihenfolge.H4.status, 'freilos');
    assert.equal(byReihenfolge.H4.kaempfer1_id, null);
    assert.equal(byReihenfolge.H4.kaempfer2_id, null);
    assert.equal(byReihenfolge.H4.sieger_id, null);
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H5', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h5 = kaempfe.find(k => k.reihenfolge_nummer === 'H5');
    assert.equal(h5.status, 'bereit');
    assert.equal(h5.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h5.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F, T3 und T4 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T3', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T4', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T3', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T4', status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});

test('aktualisiereTurnier ist ein No-Op, wenn der Pool noch keine Kämpfe hat', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});
