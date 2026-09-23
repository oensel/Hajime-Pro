import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { wendeKaempfeKaskadeAn } from '../../../../src/db/kaskaden/kaempfeKaskade.js';

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

test('wendeKaempfeKaskadeAn befüllt einen wartenden Folgekampf, sobald beide Vorkämpfe beendet sind', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const kampfA = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet', sieger_id: 'teilnehmer:1' });
    const kampfB = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:3', kaempfer2_id: 'teilnehmer:4', status: 'beendet', sieger_id: 'teilnehmer:3' });
    const kampfC = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: null, status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfA._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: kampfB._id, kaempfer2_quelle_typ: 'sieger'
    });

    await wendeKaempfeKaskadeAn(repo, poolId);

    const aktualisiert = await repo.findById(kampfC._id);
    assert.equal(aktualisiert.status, 'bereit');
    assert.equal(aktualisiert.kaempfer1_id, 'teilnehmer:1');
    assert.equal(aktualisiert.kaempfer2_id, 'teilnehmer:3');
});

test('wendeKaempfeKaskadeAn kaskadiert über mehrere Runden hinweg, wenn Freilose entstehen', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    // Doppeltes Freilos: kein Sieger feststellbar.
    const kampfA = await repo.create({ pool_id: poolId, kaempfer1_id: null, kaempfer2_id: null, status: 'freilos', sieger_id: null });
    // Einfaches Freilos: automatischer Sieg von teilnehmer:1.
    const kampfB = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: null, status: 'freilos', sieger_id: 'teilnehmer:1' });
    const kampfC = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: null, status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfA._id, kaempfer1_quelle_typ: 'sieger',
        kaempfer2_quelle_kampf_id: kampfB._id, kaempfer2_quelle_typ: 'sieger'
    });
    const kampfD = await repo.create({
        pool_id: poolId,
        kaempfer1_id: null, kaempfer2_id: 'teilnehmer:5', status: 'angelegt',
        kaempfer1_quelle_kampf_id: kampfC._id, kaempfer1_quelle_typ: 'sieger'
    });

    await wendeKaempfeKaskadeAn(repo, poolId);

    // kampf C: doppeltes Freilos (A) + einfaches Freilos (B) -> C wird selbst zum einfachen
    // Freilos mit teilnehmer:1 als automatischem Sieger.
    const aktualisiertC = await repo.findById(kampfC._id);
    assert.equal(aktualisiertC.status, 'freilos');
    assert.equal(aktualisiertC.sieger_id, 'teilnehmer:1');

    // kampf D: kann erst befüllt werden, NACHDEM C aufgelöst wurde -- beweist, dass die
    // Kaskade mehrfach durchläuft, statt nur einmal Patches anzuwenden.
    const aktualisiertD = await repo.findById(kampfD._id);
    assert.equal(aktualisiertD.status, 'bereit');
    assert.equal(aktualisiertD.kaempfer1_id, 'teilnehmer:1');
    assert.equal(aktualisiertD.kaempfer2_id, 'teilnehmer:5');
});

test('wendeKaempfeKaskadeAn lässt bereits entschiedene Kämpfe unverändert', async () => {
    const repo = await neuesRepository();
    const poolId = 'pool:1';

    const kampf = await repo.create({ pool_id: poolId, kaempfer1_id: 'teilnehmer:1', kaempfer2_id: 'teilnehmer:2', status: 'beendet', sieger_id: 'teilnehmer:1' });

    const ergebnis = await wendeKaempfeKaskadeAn(repo, poolId);

    assert.equal(ergebnis.length, 1);
    assert.equal(ergebnis[0].status, 'beendet');
    assert.equal(ergebnis[0].sieger_id, 'teilnehmer:1');
});
