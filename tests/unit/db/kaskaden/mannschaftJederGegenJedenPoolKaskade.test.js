import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftJederGegenJedenPoolKaskade.js';

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
        mannschaftskaempfeRepository: createMannschaftskaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}

test('initialisierePool erzeugt bei 2 Mannschaften genau eine Begegnung', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const m1 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team B' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 1);
    assert.equal(begegnungen[0].reihenfolge_nummer, '1');
    assert.equal(begegnungen[0].mannschaft1_id, m1._id);
    assert.equal(begegnungen[0].mannschaft2_id, m2._id);
    assert.equal(begegnungen[0].status, 'bereit');
    assert.equal(begegnungen[0].sieger_mannschaft_id, null);
});

test('initialisierePool erzeugt bei 4 Mannschaften 6 Begegnungen gemäß der festen Paarungstabelle', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    const mannschaften = {};
    for (const name of ['A', 'B', 'C', 'D']) {
        mannschaften[name] = await mannschaftenRepository.create({ pool_id: pool._id, verein: `Team ${name}` });
    }

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 6);
    assert.deepEqual(begegnungen.map(b => b.reihenfolge_nummer), ['1', '2', '3', '4', '5', '6']);

    // Feste Paarungstabelle für n=4 (0-indiziert nach Anmeldereihenfolge): [0,1],[2,3],[0,3],[1,2],[0,2],[1,3]
    const erwartetePaare = [['A', 'B'], ['C', 'D'], ['A', 'D'], ['B', 'C'], ['A', 'C'], ['B', 'D']];
    assert.deepEqual(
        begegnungen.map(b => [b.mannschaft1_id, b.mannschaft2_id]),
        erwartetePaare.map(([n1, n2]) => [mannschaften[n1]._id, mannschaften[n2]._id])
    );
});

test('initialisierePool schließt den Pool bei genau 1 Mannschaft direkt ab, ohne Begegnungen anzulegen', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({});
    await mannschaftenRepository.create({ pool_id: pool._id, verein: 'Team A' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 0);
    const aktualisierterPool = await poolsRepository.findById(pool._id);
    assert.equal(aktualisierterPool.status, 'abgeschlossen');
});

test('initialisierePool legt bei 0 Mannschaften keine Begegnungen an und lässt den Pool unverändert', async () => {
    const { mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ status: 'geplant' });

    await initialisierePool(mannschaftskaempfeRepository, mannschaftenRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    assert.equal(begegnungen.length, 0);
    const unveraenderterPool = await poolsRepository.findById(pool._id);
    assert.equal(unveraenderterPool.status, 'geplant');
});
