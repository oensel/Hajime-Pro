import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importWettkampfdaten } from '../../src/controllers/turnierController.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Der Sammelpool "Verspätet" (Nachzügler) muss einen Turnier-Export/-Import mit gesetztem Kennzeichen
// überstehen, sonst wird er zum gewöhnlichen Pool (Siegerliste, Urkunden, Matten ...).
test('Import übernimmt pools.verspaetet', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const [verein] = await knex('vereine').insert({ name: 'JC Import' }).returning('id');
        const [t] = await knex('turniere').insert({
            bezeichnung: 'Importtest', ort: 'Halle', datum: '2027-01-01', ausrichter: 'JC Import',
            verein_id: typeof verein === 'object' ? verein.id : verein
        }).returning('id');
        const turnierId = typeof t === 'object' ? t.id : t;

        await knex.transaction(async (trx) => {
            await importWettkampfdaten(trx, turnierId, {
                kampfflaechen: [],
                pools: [
                    { id: 1, bezeichnung: 'U11 m -30kg', altersklasse: 'U11', geschlecht: 'männlich', gewichtsklasse: '-30' },
                    { id: 2, bezeichnung: 'Verspätet', altersklasse: 'Verspätet', geschlecht: 'mixed', gewichtsklasse: '-', modus: 'Nicht startbereit', verspaetet: true }
                ],
                teilnehmer: [],
                kaempfe: []
            });
        });

        const pools = await knex('pools').where({ turnier_id: turnierId }).orderBy('id');
        assert.deepEqual(pools.map(p => [p.bezeichnung, !!p.verspaetet]), [['U11 m -30kg', false], ['Verspätet', true]]);
    } finally {
        await db.stoppe();
    }
});
