import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect, ensureDatabase } from '../../../../src/db/couch.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';
import { createPoolsRepository } from '../../../../src/db/repositories/poolsRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createKaempfeRepository } from '../../../../src/db/repositories/kaempfeRepository.js';
import { createMannschaftenRepository } from '../../../../src/db/repositories/mannschaftenRepository.js';
import { createMannschaftMitgliederRepository } from '../../../../src/db/repositories/mannschaftMitgliederRepository.js';
import { importiereWettkampfdaten, exportiereWettkampfdaten } from '../../../../src/db/offline/turnierWettkampfdaten.js';

let server;
let nano;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
});

after(async () => {
    await server.close();
});

async function neueRepos() {
    const db = await ensureDatabase(nano, `test-${randomUUID()}`);
    return {
        kampfflaechenRepository: createKampfflaechenRepository(db),
        poolsRepository: createPoolsRepository(db),
        turnierTeilnehmerRepository: createTurnierTeilnehmerRepository(db),
        kaempfeRepository: createKaempfeRepository(db),
        mannschaftenRepository: createMannschaftenRepository(db),
        mannschaftMitgliederRepository: createMannschaftMitgliederRepository(db)
    };
}

test('importiereWettkampfdaten schreibt Fremdschlüssel über alle sechs Entitätstypen korrekt um', async () => {
    const repos = await neueRepos();

    const daten = {
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1', status: 'frei' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A', modus: 'Jeder-gegen-Jeden' }],
        teilnehmer: [
            { id: 100, pool_id: 10, judopass_id: 'J1', vorname: 'Max', nachname: 'Mustermann', geburtsjahr: 2000, geschlecht: 'm', verein: 'TV Muster', gewicht: 70 },
            { id: 101, pool_id: 10, judopass_id: 'J2', vorname: 'Erika', nachname: 'Musterfrau', geburtsjahr: 2001, geschlecht: 'w', verein: 'TV Muster', gewicht: 65 }
        ],
        kaempfe: [
            { id: 1000, pool_id: 10, kaempfer1_id: 100, kaempfer2_id: 101, status: 'wartet', reihenfolge_nummer: 'H1' },
            { id: 1001, pool_id: 10, status: 'angelegt', reihenfolge_nummer: 'F', kaempfer1_quelle_kampf_id: 1000, kaempfer1_quelle_typ: 'sieger' }
        ],
        mannschaften: [{ id: 5000, pool_id: 10, verein: 'TV Muster', bezeichnung: 'Team 1' }],
        mannschaft_mitglieder: [{ mannschaft_id: 5000, turnier_teilnehmer_id: 100, gewichtsklasse: '-60kg' }]
    };

    const ergebnis = await importiereWettkampfdaten(repos, daten);
    assert.deepEqual(ergebnis, { kampfflaechen: 1, pools: 1, teilnehmer: 2, kaempfe: 2 });

    const pools = await repos.poolsRepository.findAll();
    const kampfflaechen = await repos.kampfflaechenRepository.findAll();
    assert.equal(pools[0].kampfflaeche_id, kampfflaechen[0]._id);

    const teilnehmer = await repos.turnierTeilnehmerRepository.findAll();
    const teilnehmerVonPool = teilnehmer.filter((t) => t.pool_id === pools[0]._id);
    assert.equal(teilnehmerVonPool.length, 2);

    const kaempfe = await repos.kaempfeRepository.findByPool(pools[0]._id);
    const h1 = kaempfe.find((k) => k.reihenfolge_nummer === 'H1');
    const finale = kaempfe.find((k) => k.reihenfolge_nummer === 'F');
    assert.equal(h1.status, 'bereit');
    assert.equal(finale.kaempfer1_quelle_kampf_id, h1._id);

    const mannschaften = await repos.mannschaftenRepository.query({});
    assert.equal(mannschaften[0].pool_id, pools[0]._id);

    const mitglieder = await repos.mannschaftMitgliederRepository.findByMannschaft(mannschaften[0]._id);
    assert.equal(mitglieder.length, 1);
    assert.equal(mitglieder[0].turnier_teilnehmer_id, teilnehmerVonPool.find((t) => t.judopass_id === 'J1')._id);
});

test('exportiereWettkampfdaten liest alle sechs Entitätstypen einer Turnier-Datenbank zurück', async () => {
    const repos = await neueRepos();
    await importiereWettkampfdaten(repos, {
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A' }],
        teilnehmer: [{ id: 100, pool_id: 10, vorname: 'Max', nachname: 'Mustermann' }],
        kaempfe: [{ id: 1000, pool_id: 10, kaempfer1_id: 100, status: 'angelegt' }],
        mannschaften: [],
        mannschaft_mitglieder: []
    });

    const exportiert = await exportiereWettkampfdaten(repos);
    assert.equal(exportiert.kampfflaechen.length, 1);
    assert.equal(exportiert.pools.length, 1);
    assert.equal(exportiert.teilnehmer.length, 1);
    assert.equal(exportiert.kaempfe.length, 1);
    assert.equal(exportiert.mannschaften.length, 0);
    assert.equal(exportiert.mannschaft_mitglieder.length, 0);
});

test('exportiereWettkampfdaten gefolgt von importiereWettkampfdaten erhält alle Fremdschlüssel (Round-Trip)', async () => {
    const repos = await neueRepos();
    await importiereWettkampfdaten(repos, {
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A' }],
        teilnehmer: [
            { id: 100, pool_id: 10, vorname: 'Max', nachname: 'Mustermann' },
            { id: 101, pool_id: 10, vorname: 'Erika', nachname: 'Musterfrau' }
        ],
        kaempfe: [{ id: 1000, pool_id: 10, kaempfer1_id: 100, kaempfer2_id: 101, sieger_id: 100, status: 'beendet' }],
        mannschaften: [],
        mannschaft_mitglieder: []
    });

    const exportiert = await exportiereWettkampfdaten(repos);

    const zielRepos = await neueRepos();
    const ergebnis = await importiereWettkampfdaten(zielRepos, exportiert);
    assert.deepEqual(ergebnis, { kampfflaechen: 1, pools: 1, teilnehmer: 2, kaempfe: 1 });

    const neuePools = await zielRepos.poolsRepository.findAll();
    const neueKampfflaechen = await zielRepos.kampfflaechenRepository.findAll();
    assert.equal(neuePools[0].kampfflaeche_id, neueKampfflaechen[0]._id);

    const neueKaempfe = await zielRepos.kaempfeRepository.findByPool(neuePools[0]._id);
    assert.equal(neueKaempfe[0].status, 'beendet');
    assert.notEqual(neueKaempfe[0].kaempfer1_id, undefined);
    assert.notEqual(neueKaempfe[0].kaempfer1_id, null);
    assert.notEqual(neueKaempfe[0].sieger_id, null);
});
