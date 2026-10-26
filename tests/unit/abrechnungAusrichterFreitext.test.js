import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'abrechnung-test-schluessel-mit-mindestens-32-zeichen';

const { ladeAbrechnung } = await import('../../src/services/abrechnung.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('Abrechnung: Kämpfer unter der Freitext-Schreibweise des Ausrichters sind weder Nicht zugeordnet noch abgerechnet', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const v = id((await knex('vereine').insert({ name: 'Judo-Club Gastgeber e.V.' }).returning('id'))[0]);
        const t = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: 'JC Gastgeber', verein_id: v,
            status: 'veroeffentlicht', startgeld: 8, zurueckgespielt_am: knex.fn.now()
        }).returning('id'))[0]);
        await knex('turnier_zahlwege').insert({
            turnier_id: t, verein_name: 'JC A', zahlweg: 'ueberweisung', rechnung_email: 'k@x.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1'
        });
        let nr = 0;
        for (const verein of ['JC A', 'JC Gastgeber', ' jc gastgeber ', 'Judo-Club Gastgeber e.V.']) {
            nr += 1;
            await knex('turnier_teilnehmer').insert({
                turnier_id: t, judopass_id: `F-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm', verein,
                gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
            });
        }
        const turnier = await knex('turniere').where({ id: t }).first();
        const a = await ladeAbrechnung(knex, turnier);
        assert.equal(a.bereit, true);
        assert.deepEqual(a.nichtZugeordnet, []);
        assert.equal(a.vereine.length, 1);
        assert.equal(a.vereine[0].anzahl, 1);
        assert.equal(a.summeCent, 800);
    } finally {
        await stoppe();
    }
});
