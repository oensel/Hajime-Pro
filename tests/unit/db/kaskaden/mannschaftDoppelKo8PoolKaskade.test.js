import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createMannschaftskaempfeRepository } from '../../../../src/db/repositories/mannschaftskaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftDoppelKo8PoolKaskade.js';

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
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db),
        poolsRepository: createPoolsRepository(db)
    };
}

test('initialisierePool füllt bei 8 Mannschaften das Raster in Anmeldereihenfolge ohne Freilose', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const m = [];
    for (let i = 0; i < 8; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: 'pool:1', verein: `Team ${i + 1}` }));
    }

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    assert.equal(begegnungen.length, 11);
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    assert.equal(byReihenfolge.H1.mannschaft1_id, m[0]._id);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m[1]._id);
    assert.equal(byReihenfolge.H1.status, 'bereit');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m[2]._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, m[3]._id);
    assert.equal(byReihenfolge.H3.mannschaft1_id, m[4]._id);
    assert.equal(byReihenfolge.H3.mannschaft2_id, m[5]._id);
    assert.equal(byReihenfolge.H4.mannschaft1_id, m[6]._id);
    assert.equal(byReihenfolge.H4.mannschaft2_id, m[7]._id);

    for (const nr of ['H5', 'H6', 'T1', 'T2', 'T3', 'T4', 'F']) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
    }

    // verknuepfeQuellenFuerMannschaftsPool wurde aufgerufen.
    assert.equal(byReihenfolge.H5.mannschaft1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H5.mannschaft1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H5.mannschaft2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F.mannschaft1_quelle_kampf_id, byReihenfolge.H5._id);
});

test('initialisierePool weist Freilose an den korrekten Rasterpositionen zu, ohne unterbewertung-Felder', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const m1 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team B' });

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    // Freilos-Indices [7,0,4,3] -> Raster: [null, m1, m2, null, null, null, null, null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.mannschaft1_id, null);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m1._id);
    assert.equal(byReihenfolge.H1.sieger_mannschaft_id, m1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, undefined);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m2._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, null);
    assert.equal(byReihenfolge.H2.sieger_mannschaft_id, m2._id);

    for (const nr of ['H3', 'H4']) {
        assert.equal(byReihenfolge[nr].status, 'freilos');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
        assert.equal(byReihenfolge[nr].mannschaft2_id, null);
        assert.equal(byReihenfolge[nr].sieger_mannschaft_id, null);
    }
});

test('initialisierePool ruft aktualisiereMannschaftsPool auf und erzeugt bei konfigurierten Gewichtsklassen einen Einzelkampf für H1', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    const m = [];
    for (let i = 0; i < 8; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: pool._id, verein: `Team ${i + 1}` }));
        await mannschaftMitgliederRepository.create({ mannschaft_id: m[i]._id, turnier_teilnehmer_id: `teilnehmer:${i}`, gewichtsklasse: '-60kg' });
    }

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, pool._id);

    const begegnungen = await mannschaftskaempfeRepository.findByPool(pool._id);
    const h1 = begegnungen.find(b => b.reihenfolge_nummer === 'H1');
    assert.equal(h1.status, 'bereit');
    const kaempfe = await kaempfeRepository.query({ mannschaftskampf_id: h1._id });
    assert.equal(kaempfe.length, 1);
    assert.equal(kaempfe[0].kaempfer1_id, 'teilnehmer:0');
    assert.equal(kaempfe[0].kaempfer2_id, 'teilnehmer:1');
});
