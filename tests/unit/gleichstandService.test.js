// Grenzfälle der Gleichstands-Entscheidung am Server (src/services/gleichstandService.js) gegen ein eingebettetes PostgreSQL:
// gleichzeitige Anträge und Ergebnis-Korrekturen nach einer Entscheidung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entscheideNachSiegzeitAm, legeStichkaempfeAn } from '../../src/services/gleichstandService.js';
import { aktualisiereKampf, setzeKampfZurueck } from '../../src/controllers/kampfController.js';
import { schliessePool } from '../../src/controllers/poolController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const idVon = (z) => (typeof z === 'object' ? z.id : z);

// Dreierkreis A schlägt B, B schlägt C, C schlägt A; zeiten: Kampfzeit der drei Kämpfe in Sekunden
async function baueDreierKreis(knex, zeiten = [30, 50, 70]) {
    const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2027-01-01', ausrichter: 'A' }).returning('id');
    const turnierId = idVon(t);
    const [m] = await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id');
    const [p] = await knex('pools').insert({
        turnier_id: turnierId, kampfflaeche_id: idVon(m), bezeichnung: 'U15 m -46', modus: 'Jeder-gegen-Jeden', altersklasse: 'U15',
        geschlecht: 'm', gewichtsklasse: '-46', status: 'kaempfe_beendet'
    }).returning('id');
    const poolId = idVon(p);
    const ids = [];
    for (const name of ['Anton', 'Bernd', 'Carl']) {
        const [x] = await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, pool_id: poolId, judopass_id: name, vorname: name, nachname: name, geburtsjahr: 2012, gewicht: 45,
            altersklasse: 'U15', gewichtsklasse: '-46', lizenz_ablauf: '2030-01-01', geschlecht: 'm', verein: 'JC'
        }).returning('id');
        ids.push(idVon(x));
    }
    const kampfIds = [];
    for (const [i, [a, b]] of [[0, 1], [1, 2], [2, 0]].entries()) {
        const [k] = await knex('kaempfe').insert({
            pool_id: poolId, status: 'beendet', reihenfolge_nummer: i + 1, kaempfer1_id: ids[a], kaempfer2_id: ids[b],
            sieger_id: ids[a], kampfzeit_in_sekunden: zeiten[i], unterbewertung_kaempfer1: 10, unterbewertung_kaempfer2: 0, matten_reihenfolge: i
        }).returning('id');
        kampfIds.push(idVon(k));
    }
    return { poolId, ids, kampfIds };
}

const entscheidungVon = async (knex, poolId) => (await knex('pools').where({ id: poolId }).first()).gleichstand_entscheidung;

test('Gleichzeitige Anträge: die Stichkämpfe entstehen nur einmal, der zweite Antrag wird abgelehnt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const { poolId } = await baueDreierKreis(knex, [60, 60, 60]);
        const ergebnisse = await Promise.allSettled([legeStichkaempfeAn(knex, poolId, 'pool'), legeStichkaempfeAn(knex, poolId, 'pool')]);
        assert.deepEqual(ergebnisse.map(e => e.status).sort(), ['fulfilled', 'rejected']);
        assert.equal(ergebnisse.find(e => e.status === 'rejected').reason.statusCode, 409);
        assert.equal((await knex('kaempfe').where({ pool_id: poolId, status: 'bereit' })).length, 3);
    } finally {
        await db.stoppe();
    }
});

test('Gleichzeitig Siegzeit und Stichkampf: nur eine Entscheidung gilt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const { poolId } = await baueDreierKreis(knex);
        const ergebnisse = await Promise.allSettled([entscheideNachSiegzeitAm(knex, poolId, 'pool'), legeStichkaempfeAn(knex, poolId, 'pool')]);
        assert.deepEqual(ergebnisse.map(e => e.status).sort(), ['fulfilled', 'rejected']);
        const stich = (await knex('kaempfe').where({ pool_id: poolId, status: 'bereit' })).length;
        const entscheidung = await entscheidungVon(knex, poolId);
        assert.ok((stich === 3) !== (entscheidung != null), `Stichkämpfe ${stich}, Entscheidung ${entscheidung}`);
    } finally {
        await db.stoppe();
    }
});

test('Korrektur der Kampfzeit nach der Entscheidung: die Entscheidung wird verworfen, der Pool ist wieder gesperrt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const { poolId, kampfIds } = await baueDreierKreis(knex);
        await entscheideNachSiegzeitAm(knex, poolId, 'pool');
        assert.notEqual(await entscheidungVon(knex, poolId), null);

        // nur die Reihenfolge auf der Matte ändern: Entscheidung bleibt
        await aktualisiereKampf(knex, kampfIds[0], { matten_reihenfolge: 5 });
        assert.notEqual(await entscheidungVon(knex, poolId), null);

        await aktualisiereKampf(knex, kampfIds[0], { kampfzeit_in_sekunden: 90 });
        assert.equal(await entscheidungVon(knex, poolId), null);
        await assert.rejects(() => schliessePool(knex, poolId), { statusCode: 409, code: 'gleichstand' });
    } finally {
        await db.stoppe();
    }
});

test('Zurücksetzen eines Kampfes nach der Entscheidung verwirft sie ebenfalls', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const { poolId, kampfIds } = await baueDreierKreis(knex);
        await entscheideNachSiegzeitAm(knex, poolId, 'pool');
        await setzeKampfZurueck(knex, kampfIds[1]);
        assert.equal(await entscheidungVon(knex, poolId), null);
        assert.equal((await knex('pools').where({ id: poolId }).first()).status, 'gestartet');
    } finally {
        await db.stoppe();
    }
});
