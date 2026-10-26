import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
// Duplizieren gibt es nur im Einzelbenutzerbetrieb (Hallen-Server).
process.env.BETRIEBSMODUS = 'server';
process.env.DB_HOST = '127.0.0.1';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { dupliziereTurnier } = await import('../../src/controllers/turnierController.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('Duplizieren: Zahlweg-Flag wird zurückgesetzt und nur für den Ausrichter neu abgeleitet', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const quelle = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2028-03-04', ausrichter: 'JC Ausrichter', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2028-03-01',
            zahlungsziel_tage: 30, rechnung_hinweis: 'Danke'
        }).returning('id'))[0]);
        await knex('turnier_zahlwege').insert({
            turnier_id: quelle, verein_name: 'JC Fremd', zahlweg: 'bar',
            rechnung_email: 'a@b.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1'
        });
        let nr = 0;
        for (const verein of ['JC Ausrichter', 'JC Fremd']) {
            nr += 1;
            await knex('turnier_teilnehmer').insert({
                turnier_id: quelle, judopass_id: `D-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm', verein,
                gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012,
                startgeld_zahlweg_gesichert: true
            });
        }
        let antwort;
        const res = { status(c) { this.code = c; return this; }, json(b) { antwort = { code: this.code, ...b }; return this; } };
        await dupliziereTurnier(knex, {
            params: { id: String(quelle) }, body: { datum: '2029-05-05', teilnehmerUebernehmen: true },
            app: { get: () => null }
        }, res);
        assert.equal(antwort.code, 201, JSON.stringify(antwort));
        const flags = Object.fromEntries((await knex('turnier_teilnehmer').where({ turnier_id: antwort.turnierId }))
            .map((t) => [t.verein, t.startgeld_zahlweg_gesichert]));
        assert.deepEqual(flags, { 'JC Ausrichter': true, 'JC Fremd': false });
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: antwort.turnierId })).length, 0);
        const kopie = await knex('turniere').where({ id: antwort.turnierId }).first();
        assert.equal(kopie.zahlungsziel_tage, 30);
        assert.equal(kopie.rechnung_hinweis, 'Danke');
    } finally {
        await stoppe();
    }
});
