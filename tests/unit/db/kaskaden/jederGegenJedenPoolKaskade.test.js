import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool, aktualisiereTurnier } from '../../../../src/db/kaskaden/jederGegenJedenPoolKaskade.js';

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

test('initialisierePool erzeugt bei 2 Teilnehmern genau einen Kampf', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const t1 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 70 });
    const t2 = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 80 });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].reihenfolge_nummer, 1);
    assert.equal(kaempfe[0].kaempfer1_id, t1._id);
    assert.equal(kaempfe[0].kaempfer2_id, t2._id);
    assert.equal(kaempfe[0].status, 'bereit');
});

test('initialisierePool erzeugt bei 4 Teilnehmern 6 Kämpfe gemäß der festen Paarungstabelle', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const teilnehmer = {};
    for (const gewicht of [60, 65, 70, 75]) {
        teilnehmer[gewicht] = await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht });
    }

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 6);
    assert.deepEqual(kaempfe.map(k => k.reihenfolge_nummer), [1, 2, 3, 4, 5, 6]);

    // Feste Paarungstabelle für n=4 (0-indiziert nach Gewicht sortiert): [0,1],[2,3],[0,3],[1,2],[0,2],[1,3]
    const erwartetePaare = [
        [60, 65], [70, 75], [60, 75], [65, 70], [60, 70], [65, 75]
    ];
    assert.deepEqual(
        kaempfe.map(k => [k.kaempfer1_id, k.kaempfer2_id]),
        erwartetePaare.map(([g1, g2]) => [teilnehmer[g1]._id, teilnehmer[g2]._id])
    );
});

test('initialisierePool schließt den Pool bei genau 1 Teilnehmer direkt ab, ohne Kämpfe anzulegen', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await turnierTeilnehmerRepository.create({ pool_id: pool._id, gewicht: 70 });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'abgeschlossen');
});

test('initialisierePool legt bei 0 Teilnehmern keine Kämpfe an und lässt den Pool unverändert', async () => {
    const { kaempfeRepository, turnierTeilnehmerRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await initialisierePool(kaempfeRepository, turnierTeilnehmerRepository, poolsRepository, pool._id);

    const kaempfe = await kaempfeRepository.findByPool(pool._id);
    assert.equal(kaempfe.length, 0);
    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});

test('aktualisiereTurnier setzt den Pool-Status auf kaempfe_beendet, wenn alle Kämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const kampf = await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 1, status: 'bereit' });
    await kaempfeRepository.update(kampf._id, { status: 'beendet' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'kaempfe_beendet');
});

test('aktualisiereTurnier lässt den Pool unverändert, solange nicht alle Kämpfe beendet sind', async () => {
    const { kaempfeRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await kaempfeRepository.create({ pool_id: pool._id, reihenfolge_nummer: 1, status: 'bereit' });

    await aktualisiereTurnier(kaempfeRepository, poolsRepository, pool._id);

    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, undefined);
});
