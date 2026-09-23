import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo16PoolKaskade.js';

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

test('initialisierePool füllt bei 16 Teilnehmern verschiedener Vereine das Raster ohne Freilose', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const gewichte = [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125];
    const t = {};
    for (let i = 0; i < gewichte.length; i++) {
        t[gewichte[i]] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: gewichte[i], verein: `Club${i + 1}` });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 27);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung bei 16 Teilnehmern mit ausschließlich unterschiedlichen Vereinen (von Hand
    // gegen den Vereinstrennungs-Algorithmus nachgerechnet): raster = [50,70,90,110,55,75,95,115,
    // 60,80,100,120,65,85,105,125]
    assert.equal(byReihenfolge.H1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.H2.kaempfer1_id, t[90]._id);
    assert.equal(byReihenfolge.H2.kaempfer2_id, t[110]._id);
    assert.equal(byReihenfolge.H3.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.H4.kaempfer1_id, t[95]._id);
    assert.equal(byReihenfolge.H4.kaempfer2_id, t[115]._id);
    assert.equal(byReihenfolge.H5.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.H5.kaempfer2_id, t[80]._id);
    assert.equal(byReihenfolge.H6.kaempfer1_id, t[100]._id);
    assert.equal(byReihenfolge.H6.kaempfer2_id, t[120]._id);
    assert.equal(byReihenfolge.H7.kaempfer1_id, t[65]._id);
    assert.equal(byReihenfolge.H7.kaempfer2_id, t[85]._id);
    assert.equal(byReihenfolge.H8.kaempfer1_id, t[105]._id);
    assert.equal(byReihenfolge.H8.kaempfer2_id, t[125]._id);

    for (const nr of ['H9', 'H10', 'H11', 'H12', 'H13', 'H14', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'F1']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen.
    assert.equal(byReihenfolge.H9.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H9.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H9.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.H13._id);
});

test('initialisierePool weist Freilose an den korrekten 16er-Rasterpositionen zu', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Indices [15,0,8,7,4,11,12,3] -> Raster: [null,t1,null,null,null,t2,null,null,...,null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, null);
    assert.equal(byReihenfolge.H1.kaempfer2_id, t1._id);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 10);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.kaempfer1_id, null);
    assert.equal(byReihenfolge.H2.kaempfer2_id, null);
    assert.equal(byReihenfolge.H2.sieger_id, null);

    assert.equal(byReihenfolge.H3.status, 'freilos');
    assert.equal(byReihenfolge.H3.kaempfer1_id, null);
    assert.equal(byReihenfolge.H3.kaempfer2_id, t2._id);
    assert.equal(byReihenfolge.H3.sieger_id, t2._id);
    assert.equal(byReihenfolge.H3.unterbewertung_kaempfer1, 0);
    assert.equal(byReihenfolge.H3.unterbewertung_kaempfer2, 10);

    for (const nr of ['H4', 'H5', 'H6', 'H7', 'H8']) {
        assert.equal(byReihenfolge[nr].status, 'freilos');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
        assert.equal(byReihenfolge[nr].kaempfer2_id, null);
        assert.equal(byReihenfolge[nr].sieger_id, null);
    }
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H9', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h9 = kaempfe.find(k => k.reihenfolge_nummer === 'H9');
    assert.equal(h9.status, 'bereit');
    assert.equal(h9.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h9.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1, T11 und T12 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T11', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T12', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T11', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T12', status: 'bereit' });

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
