import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { ladeUebersicht, ladeUrkundenDatenJePool } from '../../src/services/urkundenDaten.js';

test('Der Sammelpool "Verspätet" erscheint weder in der Urkunden-Übersicht noch in den Urkunden-Daten', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const [turnier] = await knex('turniere').insert({
            bezeichnung: 'T', ort: 'O', datum: '2026-10-10', ausrichter: 'A'
        }).returning('id');
        const turnierId = turnier.id ?? turnier;
        const poolBasis = { turnier_id: turnierId, modus: 'Jeder-gegen-Jeden', status: 'abgeschlossen' };
        const [p1] = await knex('pools').insert({
            ...poolBasis, bezeichnung: 'U11 m -30kg', altersklasse: 'U11', geschlecht: 'm', gewichtsklasse: '-30kg'
        }).returning('id');
        const [p2] = await knex('pools').insert({
            ...poolBasis, bezeichnung: 'Verspätet', altersklasse: 'Verspätet', geschlecht: 'mixed', gewichtsklasse: '-',
            verspaetet: true
        }).returning('id');
        const regulaerId = p1.id ?? p1;
        const sammelPoolId = p2.id ?? p2;
        const tn = (poolId, nachname) => ({
            turnier_id: turnierId, pool_id: poolId, judopass_id: nachname, vorname: 'V', nachname,
            verein: 'V', geburtsjahr: 2015, lizenz_ablauf: '2027-01-01', geschlecht: 'm', gewicht: 28,
            altersklasse: 'U11', gewichtsklasse: '-30kg'
        });
        await knex('turnier_teilnehmer').insert([tn(regulaerId, 'Regulaer'), tn(sammelPoolId, 'Nachzuegler')]);

        const uebersicht = await ladeUebersicht(knex, turnierId);
        assert.deepEqual(uebersicht.pools.map(p => p.bezeichnung), ['U11 m -30kg']);
        const jePool = await ladeUrkundenDatenJePool(knex, turnierId, { platzbereich: 'alle', poolIds: null, reihenfolge: 'absteigend' });
        assert.ok(jePool.every(p => p.poolId !== sammelPoolId));
    } finally {
        await db.stoppe();
    }
});
