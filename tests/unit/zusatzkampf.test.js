import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legeZusatzkampfAn } from '../../src/controllers/kampfController.js';
import { schliessePool } from '../../src/controllers/poolController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const idVon = (z) => (typeof z === 'object' ? z.id : z);

async function baueDreierKreis(knex, { modus = 'Jeder-gegen-Jeden', status = 'kaempfe_beendet' } = {}) {
    const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2027-01-01', ausrichter: 'A' }).returning('id');
    const turnierId = idVon(t);
    const [m] = await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id');
    const matteId = idVon(m);
    const [p] = await knex('pools').insert({
        turnier_id: turnierId, kampfflaeche_id: matteId, bezeichnung: 'U15 m -46', modus, altersklasse: 'U15',
        geschlecht: 'm', gewichtsklasse: '-46', status
    }).returning('id');
    const poolId = idVon(p);
    const ids = [];
    for (const name of ['Anton', 'Bernd', 'Carl']) {
        const [x] = await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, pool_id: poolId, judopass_id: name, vorname: name, nachname: name, geburtsjahr: 2012, gewicht: 45, altersklasse: 'U15', gewichtsklasse: '-46',
            lizenz_ablauf: '2030-01-01', geschlecht: 'm', verein: 'JC'
        }).returning('id');
        ids.push(idVon(x));
    }
    // Kreis: A schlägt B, B schlägt C, C schlägt A
    const paare = [[0, 1, 0], [1, 2, 1], [2, 0, 2]];
    for (const [i, [a, b, sieger]] of paare.entries()) {
        await knex('kaempfe').insert({
            pool_id: poolId, status: 'beendet', reihenfolge_nummer: i + 1, kaempfer1_id: ids[a], kaempfer2_id: ids[b],
            sieger_id: ids[sieger], kampfzeit_in_sekunden: 100, unterbewertung_kaempfer1: 7, unterbewertung_kaempfer2: 0, matten_reihenfolge: i
        });
    }
    return { poolId, matteId, ids };
}

test('Zusatzkampf: legt den Kampf an, nimmt den Pool aus der Prüfung und stellt den Kampf auf die Matte', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const { poolId, ids } = await baueDreierKreis(knex);
        const kampfId = await legeZusatzkampfAn(knex, poolId, ids[0], ids[1]);

        const kampf = await knex('kaempfe').where({ id: kampfId }).first();
        assert.equal(kampf.status, 'bereit');
        assert.equal(kampf.pool_id, poolId);
        assert.deepEqual([kampf.kaempfer1_id, kampf.kaempfer2_id], [ids[0], ids[1]]);
        assert.equal(Number(kampf.reihenfolge_nummer), 4);
        assert.notEqual(kampf.matten_reihenfolge, null);
        assert.equal((await knex('pools').where({ id: poolId }).first()).status, 'gestartet');

        // Der offene Pool lässt sich nicht abschließen, bis der Kampf beendet ist
        await assert.rejects(() => schliessePool(knex, poolId), { statusCode: 400 });
    } finally {
        await db.stoppe();
    }
});

test('Zusatzkampf: nur in Pools in Prüfung, nur Jeder-gegen-Jeden, nur Kämpfer des Pools', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const laufend = await baueDreierKreis(knex, { status: 'gestartet' });
        await assert.rejects(() => legeZusatzkampfAn(knex, laufend.poolId, laufend.ids[0], laufend.ids[1]), { statusCode: 409 });

        const ko = await baueDreierKreis(knex, { modus: 'Doppel-KO-8' });
        await assert.rejects(() => legeZusatzkampfAn(knex, ko.poolId, ko.ids[0], ko.ids[1]), { statusCode: 409 });

        const pruefung = await baueDreierKreis(knex);
        await assert.rejects(() => legeZusatzkampfAn(knex, pruefung.poolId, pruefung.ids[0], pruefung.ids[0]), { statusCode: 400 });
        await assert.rejects(() => legeZusatzkampfAn(knex, pruefung.poolId, pruefung.ids[0], laufend.ids[0]), { statusCode: 409 });
        await assert.rejects(() => legeZusatzkampfAn(knex, 999999, 1, 2), { statusCode: 404 });
        assert.equal((await knex('kaempfe').where({ pool_id: pruefung.poolId })).length, 3);
    } finally {
        await db.stoppe();
    }
});
