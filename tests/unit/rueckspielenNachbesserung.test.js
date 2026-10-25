import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { uebernehmeNeueZahlwege, synchronisiereNachRueckspielen } = await import('../../src/services/rueckspielen.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

test('Zurückspielen: neue Vereine werden ohne Beachtung von Groß-/Kleinschreibung und Leerraum abgeglichen', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const t = id((await knex('turniere').insert({ bezeichnung: 'Cup', ort: 'O', datum: '2031-06-01', ausrichter: 'JC Gast' }).returning('id'))[0]);
        await knex('turnier_zahlwege').insert({ turnier_id: t, verein_name: 'JC X', zahlweg: 'ueberweisung', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1' });
        const zeile = (name) => ({ verein_name: name, zahlweg: 'bar', rechnung_email: 'n@b.de', rechnung_ansprechperson: 'N', rechnung_anschrift: 'Weg 2' });
        const n = await uebernehmeNeueZahlwege(knex, t, [zeile('jc x'), zeile(' JC X '), zeile('jc gast'), zeile('JC Neu'), zeile('jc neu')]);
        assert.equal(n, 1);
        const namen = (await knex('turnier_zahlwege').where({ turnier_id: t }).orderBy('id')).map((z) => z.verein_name);
        assert.deepEqual(namen, ['JC X', 'JC Neu']);
    } finally {
        await stoppe();
    }
});

test('Zurückspielen: Fehler beim Ableiten der Zahlweg-Flags nach dem Commit wird protokolliert, nicht geworfen', async () => {
    const meldungen = [];
    const original = console.error;
    console.error = (...a) => meldungen.push(a.join(' '));
    try {
        assert.equal(await synchronisiereNachRueckspielen({}, 42), false);
    } finally {
        console.error = original;
    }
    assert.equal(meldungen.length, 1);
    assert.match(meldungen[0], /Turnier 42/);
});
