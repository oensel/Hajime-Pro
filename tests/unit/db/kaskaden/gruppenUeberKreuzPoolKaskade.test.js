import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/gruppenUeberKreuzPoolKaskade.js';

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

test('initialisierePool wirft einen Fehler, wenn nicht exakt 6 Teilnehmer registriert sind', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    for (let i = 0; i < 5; i++) {
        await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 50 + i });
    }

    await assert.rejects(
        () => initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id),
        { message: 'Das Gruppensystem über Kreuz benötigt exakt 6 Teilnehmer.' }
    );

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
});

test('initialisierePool teilt 6 Teilnehmer nach Gewicht auf zwei Gruppen auf und erzeugt Vorrunde plus Hüllen', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t = {};
    for (const gewicht of [50, 55, 60, 65, 70, 75]) {
        t[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 10);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));

    // Sortiert nach Gewicht: [50,55,60,65,70,75] -> poolA=[50,60,70] (Index 0,2,4), poolB=[55,65,75] (Index 1,3,5)
    assert.equal(byReihenfolge.V_A_1.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.V_A_1.kaempfer2_id, t[60]._id);
    assert.equal(byReihenfolge.V_A_1.gruppe, 'A');
    assert.equal(byReihenfolge.V_A_2.kaempfer1_id, t[50]._id);
    assert.equal(byReihenfolge.V_A_2.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.V_A_3.kaempfer1_id, t[60]._id);
    assert.equal(byReihenfolge.V_A_3.kaempfer2_id, t[70]._id);
    assert.equal(byReihenfolge.V_B_1.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.V_B_1.kaempfer2_id, t[65]._id);
    assert.equal(byReihenfolge.V_B_1.gruppe, 'B');
    assert.equal(byReihenfolge.V_B_2.kaempfer1_id, t[55]._id);
    assert.equal(byReihenfolge.V_B_2.kaempfer2_id, t[75]._id);
    assert.equal(byReihenfolge.V_B_3.kaempfer1_id, t[65]._id);
    assert.equal(byReihenfolge.V_B_3.kaempfer2_id, t[75]._id);

    for (const nr of ['HF1', 'HF2', 'F1', 'F2']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].kaempfer1_id, null);
    }

    // verknuepfeQuellenFuerPool wurde aufgerufen (nur für F1/F2, HF1/HF2 bleiben unverknüpft).
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_kampf_id, byReihenfolge.HF1._id);
    assert.equal(byReihenfolge.F1.kaempfer1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.F2.kaempfer1_quelle_kampf_id, byReihenfolge.HF1._id);
    assert.equal(byReihenfolge.F2.kaempfer1_quelle_typ, 'verlierer');
    assert.equal(byReihenfolge.HF1.kaempfer1_quelle_kampf_id, undefined);
});

test('aktualisiereTurnier berechnet die Halbfinal-Paarung aus der Vorrunden-Rangliste, sobald alle 6 Vorrundenkämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});

    // Gruppe A: pA1 gewinnt beide (2 Siege) -> Erster; pA2 gewinnt gegen pA3 (1 Sieg) -> Zweiter.
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_1', status: 'beendet', kaempfer1_id: 'pA1', kaempfer2_id: 'pA2', sieger_id: 'pA1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_2', status: 'beendet', kaempfer1_id: 'pA1', kaempfer2_id: 'pA3', sieger_id: 'pA1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_A_3', status: 'beendet', kaempfer1_id: 'pA2', kaempfer2_id: 'pA3', sieger_id: 'pA2', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    // Gruppe B: pB3 gewinnt beide seine Kämpfe (2 Siege) -> Erster; pB1 gewinnt gegen pB2 (1 Sieg) -> Zweiter.
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_1', status: 'beendet', kaempfer1_id: 'pB1', kaempfer2_id: 'pB2', sieger_id: 'pB1', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_2', status: 'beendet', kaempfer1_id: 'pB1', kaempfer2_id: 'pB3', sieger_id: 'pB3', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'V_B_3', status: 'beendet', kaempfer1_id: 'pB2', kaempfer2_id: 'pB3', sieger_id: 'pB3', unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0 });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'HF1', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'HF2', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    const byReihenfolge = Object.fromEntries(kaempfe.map(k => [k.reihenfolge_nummer, k]));
    assert.equal(byReihenfolge.HF1.status, 'bereit');
    assert.equal(byReihenfolge.HF1.kaempfer1_id, 'pA1');
    assert.equal(byReihenfolge.HF1.kaempfer2_id, 'pB1');
    assert.equal(byReihenfolge.HF2.status, 'bereit');
    assert.equal(byReihenfolge.HF2.kaempfer1_id, 'pB3');
    assert.equal(byReihenfolge.HF2.kaempfer2_id, 'pA2');
});

test('aktualisiereTurnier schließt den Pool ab, wenn F1 und F2 beendet oder freilos sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F2', status: 'freilos' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange F1 und F2 nicht beide fertig sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F1', status: 'beendet' });
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 'F2', status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});
