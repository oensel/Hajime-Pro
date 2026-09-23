import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { wendeMannschaftsKaskadeAn } from '../../../../src/db/kaskaden/mannschaftsKaskade.js';

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
    return createMannschaftskaempfeRepository(db);
}

test('wendeMannschaftsKaskadeAn befüllt eine wartende Folge-Begegnung, sobald beide Vorbegegnungen beendet sind', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnungA = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', status: 'beendet', sieger_mannschaft_id: 'mannschaft:1' });
    const begegnungB = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:3', mannschaft2_id: 'mannschaft:4', status: 'beendet', sieger_mannschaft_id: 'mannschaft:3' });
    const begegnungC = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: null, status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungA._id, mannschaft1_quelle_typ: 'sieger',
        mannschaft2_quelle_kampf_id: begegnungB._id, mannschaft2_quelle_typ: 'sieger'
    });

    await wendeMannschaftsKaskadeAn(repo, poolId);

    const aktualisiert = await repo.findById(begegnungC._id);
    assert.equal(aktualisiert.status, 'bereit');
    assert.equal(aktualisiert.mannschaft1_id, 'mannschaft:1');
    assert.equal(aktualisiert.mannschaft2_id, 'mannschaft:3');
});

test('wendeMannschaftsKaskadeAn kaskadiert über mehrere Runden hinweg, wenn Freilose entstehen', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnungA = await repo.create({ pool_id: poolId, mannschaft1_id: null, mannschaft2_id: null, status: 'freilos', sieger_mannschaft_id: null });
    const begegnungB = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: null, status: 'freilos', sieger_mannschaft_id: 'mannschaft:1' });
    const begegnungC = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: null, status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungA._id, mannschaft1_quelle_typ: 'sieger',
        mannschaft2_quelle_kampf_id: begegnungB._id, mannschaft2_quelle_typ: 'sieger'
    });
    const begegnungD = await repo.create({
        pool_id: poolId,
        mannschaft1_id: null, mannschaft2_id: 'mannschaft:5', status: 'angelegt',
        mannschaft1_quelle_kampf_id: begegnungC._id, mannschaft1_quelle_typ: 'sieger'
    });

    await wendeMannschaftsKaskadeAn(repo, poolId);

    const aktualisiertC = await repo.findById(begegnungC._id);
    assert.equal(aktualisiertC.status, 'freilos');
    assert.equal(aktualisiertC.sieger_mannschaft_id, 'mannschaft:1');

    const aktualisiertD = await repo.findById(begegnungD._id);
    assert.equal(aktualisiertD.status, 'bereit');
    assert.equal(aktualisiertD.mannschaft1_id, 'mannschaft:1');
    assert.equal(aktualisiertD.mannschaft2_id, 'mannschaft:5');
});

test('wendeMannschaftsKaskadeAn lässt bereits entschiedene Begegnungen unverändert', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const begegnung = await repo.create({ pool_id: poolId, mannschaft1_id: 'mannschaft:1', mannschaft2_id: 'mannschaft:2', status: 'beendet', sieger_mannschaft_id: 'mannschaft:1' });

    const ergebnis = await wendeMannschaftsKaskadeAn(repo, poolId);

    assert.equal(ergebnis.length, 1);
    assert.equal(ergebnis[0].status, 'beendet');
    assert.equal(ergebnis[0].sieger_mannschaft_id, 'mannschaft:1');
});
