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
import { initialisierePool } from '../../../../src/db/kaskaden/mannschaftDoppelKo16PoolKaskade.js';

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

test('initialisierePool füllt bei 16 Mannschaften das Raster in Anmeldereihenfolge ohne Freilose', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const m = [];
    for (let i = 0; i < 16; i++) {
        m.push(await mannschaftenRepository.create({ pool_id: 'pool:1', verein: `Team ${i + 1}` }));
    }

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    assert.equal(begegnungen.length, 27);
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    const erwartetePaare = [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]];
    erwartetePaare.forEach(([i, j], idx) => {
        const h = byReihenfolge[`H${idx + 1}`];
        assert.equal(h.mannschaft1_id, m[i]._id, `H${idx + 1} mannschaft1`);
        assert.equal(h.mannschaft2_id, m[j]._id, `H${idx + 1} mannschaft2`);
        assert.equal(h.status, 'bereit');
    });

    const huellenReihenfolgeNummern = [
        'H9', 'H10', 'H11', 'H12', 'T1', 'T2', 'T3', 'T4',
        'H13', 'H14', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10',
        'F1', 'T11', 'T12'
    ];
    assert.equal(huellenReihenfolgeNummern.length, 19);
    for (const nr of huellenReihenfolgeNummern) {
        assert.equal(byReihenfolge[nr].status, 'angelegt');
        assert.equal(byReihenfolge[nr].mannschaft1_id, null);
    }

    // verknuepfeQuellenFuerMannschaftsPool wurde aufgerufen.
    assert.equal(byReihenfolge.H9.mannschaft1_quelle_kampf_id, byReihenfolge.H1._id);
    assert.equal(byReihenfolge.H9.mannschaft1_quelle_typ, 'sieger');
    assert.equal(byReihenfolge.H9.mannschaft2_quelle_kampf_id, byReihenfolge.H2._id);
    assert.equal(byReihenfolge.F1.mannschaft1_quelle_kampf_id, byReihenfolge.H13._id);
});

test('initialisierePool weist Freilose an den korrekten 16er-Rasterpositionen zu, ohne unterbewertung-Felder', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const m1 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team A' });
    const m2 = await mannschaftenRepository.create({ pool_id: 'pool:1', verein: 'Team B' });

    await initialisierePool(kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository, 'pool:1');

    const begegnungen = await mannschaftskaempfeRepository.findByPool('pool:1');
    const byReihenfolge = Object.fromEntries(begegnungen.map(b => [b.reihenfolge_nummer, b]));

    // Freilos-Indices [15,0,8,7,4,11,12,3] klemmen bei F=14 auf alle 8 -> Raster: [null,m1,m2,null,...,null]
    assert.equal(byReihenfolge.H1.status, 'freilos');
    assert.equal(byReihenfolge.H1.mannschaft1_id, null);
    assert.equal(byReihenfolge.H1.mannschaft2_id, m1._id);
    assert.equal(byReihenfolge.H1.sieger_mannschaft_id, m1._id);
    assert.equal(byReihenfolge.H1.unterbewertung_kaempfer1, undefined);

    assert.equal(byReihenfolge.H2.status, 'freilos');
    assert.equal(byReihenfolge.H2.mannschaft1_id, m2._id);
    assert.equal(byReihenfolge.H2.mannschaft2_id, null);
    assert.equal(byReihenfolge.H2.sieger_mannschaft_id, m2._id);

    for (let i = 3; i <= 8; i++) {
        const h = byReihenfolge[`H${i}`];
        assert.equal(h.status, 'freilos', `H${i} status`);
        assert.equal(h.mannschaft1_id, null, `H${i} mannschaft1`);
        assert.equal(h.mannschaft2_id, null, `H${i} mannschaft2`);
        assert.equal(h.sieger_mannschaft_id, null, `H${i} sieger`);
    }
});

test('initialisierePool ruft aktualisiereMannschaftsPool auf und erzeugt bei konfigurierten Gewichtsklassen einen Einzelkampf für H1', async () => {
    const { kaempfeRepository, mannschaftskaempfeRepository, mannschaftenRepository, mannschaftMitgliederRepository, poolsRepository } = await neueRepositories();
    const pool = await poolsRepository.create({ mannschafts_gewichtsklassen: JSON.stringify(['-60kg']) });
    const m = [];
    for (let i = 0; i < 16; i++) {
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
