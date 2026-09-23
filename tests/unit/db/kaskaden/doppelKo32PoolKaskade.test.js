import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/doppelKo32PoolKaskade.js';

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

test('initialisierePool füllt bei 32 Teilnehmern verschiedener Vereine das Raster ohne Freilose', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t = {};
    for (let i = 0; i < 32; i++) {
        const gewicht = 50 + 5 * i;
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht, verein: `Club${i + 1}` });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 59);

    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Rasterbefüllung bei 32 Teilnehmern mit ausschließlich unterschiedlichen Vereinen (von Hand
    // gegen den Vereinstrennungs-Algorithmus nachgerechnet, Gewichte 50..205 in 5er-Schritten):
    const erwarteteHPaare = [
        [50, 70], [90, 110], [130, 150], [170, 190],
        [55, 75], [95, 115], [135, 155], [175, 195],
        [60, 80], [100, 120], [140, 160], [180, 200],
        [65, 85], [105, 125], [145, 165], [185, 205]
    ];
    erwarteteHPaare.forEach(([g1, g2], idx) => {
        const h = byReihenfolge[`H${idx + 1}`];
        assert.equal(h.kaempfer1_id, t[g1]._id, `H${idx + 1} kaempfer1`);
        assert.equal(h.kaempfer2_id, t[g2]._id, `H${idx + 1} kaempfer2`);
        assert.equal(h.status, 'bereit');
    });

    const huellenReihenfolgeNummern = [
        ...[17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].map(i => `H${i}`),
        ...Array.from({ length: 28 }, (_, i) => `T${i + 1}`),
        'F1'
    ];
    assert.equal(huellenReihenfolgeNummern.length, 43);
    for (const nr of huellenReihenfolgeNummern) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen.
    assert.equal(byReihenfolge.H17.kaempfer1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H17.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H17.kaempfer2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.H29._id);
    assert.equal(byReihenfolge.F1.kaempfer2_quelle_kampf_id, byReihenfolge.H30._id);
});

test('initialisierePool weist Freilose an den korrekten 32er-Rasterpositionen zu', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50, verein: 'Club1' });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 55, verein: 'Club2' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Freilos-Indices klemmen bei F=30 auf alle 16 Werte -> Raster: nur Index 0 = t1, Index 8 = t2.
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.kaempfer1_id, t1._id);
    assert.equal(byReihenfolge.H1.kaempfer2_id, null);
    assert.equal(byReihenfolge.H1.sieger_id, t1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer2, 0);

    assert.equal(byReihenfolge.H5.status, 'freilos');
    assert.equal(byReihenfolge.H5.kaempfer1_id, t2._id);
    assert.equal(byReihenfolge.H5.kaempfer2_id, null);
    assert.equal(byReihenfolge.H5.sieger_id, t2._id);
    assert.equal(byReihenfolge.H5.unterbewertung_kaempfer1, 10);
    assert.equal(byReihenfolge.H5.unterbewertung_kaempfer2, 0);

    for (let i = 1; i <= 16; i++) {
        if (i === 1 || i === 5) continue;
        const h = byReihenfolge[`H${i}`];
        assert.equal(h.status, 'freilos', `H${i} status`);
        assert.equal(h.kaempfer1_id, null, `H${i} kaempfer1`);
        assert.equal(h.kaempfer2_id, null, `H${i} kaempfer2`);
        assert.equal(h.sieger_id, null, `H${i} sieger`);
    }
});

test('aktualisiereTurnier wendet die Kaskade an und befüllt einen Folgekampf, sobald beide Quellkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const h1 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H1', status: 'beendet', kaempfer1_id: 'teilnehmer:x', kaempfer2_id: 'teilnehmer:y', sieger_id: 'teilnehmer:x' });
    const h2 = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'H2', status: 'beendet', kaempfer1_id: 'teilnehmer:z', kaempfer2_id: 'teilnehmer:w', sieger_id: 'teilnehmer:w' });
    await kaempfeRepository.create({
        pool_id: pool._id, reihenfolge_nummer: 'H17', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null,
        kaempfer1_quelle_kampf_id: h1._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: h2._id, kaempfer2_quelle_typ: 'sieger'
    });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const h17 = kaempfe.find(k => k.reihenfolge_nummer === 'H17');
    assert.equal(h17.status, 'bereit');
    assert.equal(h17.kaempfer1_id, 'teilnehmer:x');
    assert.equal(h17.kaempfer2_id, 'teilnehmer:w');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1, T27 und T28 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T27', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T28', status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle drei Abschlusskämpfe fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T27', status: 'freilos' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'T28', status: 'bereit' });

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
