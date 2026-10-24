import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const zw = await import('../../src/services/zahlwege.js');
const tc = await import('../../src/controllers/teilnehmerController.js');
const pc = await import('../../src/controllers/poolController.js');
const { mapTeilnehmer } = await import('../../src/models/teilnehmerModel.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const EINGABE = { zahlweg: 'ueberweisung', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };
const morgen = () => new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

test('Kampfbereitschaft nutzt den abgeleiteten Zahlstatus', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: morgen(), ausrichter: 'JC Ausrichter', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 8, anmeldeschluss: morgen()
        }).returning('*'))[0];
        const speichere = (vereinName, eingabe) => zw.speichereZahlweg(knex, { turnier: t, vereinName, vereinId: null, benutzerId: 'u', eingabe });
        await speichere('JC A', EINGABE);
        await speichere('JC B', { ...EINGABE, zahlweg: 'bar' });

        let n = 0;
        const anlegen = async (verein, kontext) => {
            n += 1;
            return id(await tc.legeTeilnehmerAn(knex, {
                turnier_id: t.id, vorname: 'V', nachname: `N${n}`, geburtsjahr: 2012, geschlecht: 'm', verein,
                gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', gewogen: true, judopass_id: `P${n}`
            }, kontext));
        };
        const status = async (i) => (await knex('turnier_teilnehmer').where({ id: i }).first());
        const privilegiert = { istGastgeberVerein: true, istPrivilegiert: true, userVereinName: null };

        const a = await status(await anlegen('JC A', privilegiert));
        assert.equal(a.status, 'kampfbereit');
        assert.equal(a.startgeld_zahlweg_gesichert, true);
        const b = await status(await anlegen('JC B', privilegiert));
        assert.equal(b.status, 'angemeldet');
        assert.equal(b.startgeld_zahlweg_gesichert, false);
        const o = await status(await anlegen('JC Ausrichter', privilegiert));
        assert.equal(o.status, 'kampfbereit');

        // Pool-Prüfung
        assert.equal(pc.istTeilnehmerStartberechtigt(a, t, null), true);
        assert.equal(pc.istTeilnehmerStartberechtigt(b, t, null), false);
        assert.equal(pc.istTeilnehmerStartberechtigt({ ...b, startgeld_bezahlt: true }, t, null), true);

        // Bestätigen: A geht, B nicht
        await knex('turnier_teilnehmer').where({ id: a.id }).update({ status: 'angemeldet' });
        await tc.bestaetigeKampfbereitschaft(knex, a.id, privilegiert);
        await assert.rejects(() => tc.bestaetigeKampfbereitschaft(knex, b.id, privilegiert), /Startgeld ist noch nicht bezahlt/);

        // Model
        assert.equal(mapTeilnehmer(a).startgeldZahlwegGesichert, true);
        assert.equal(mapTeilnehmer(b).startgeldZahlwegGesichert, false);

        // kostenloses Turnier: unverändert kampfbereit, Flag false
        const gratis = (await knex('turniere').insert({
            bezeichnung: 'G', ort: 'O', datum: morgen(), ausrichter: 'JC Ausrichter', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 0, anmeldeschluss: morgen()
        }).returning('*'))[0];
        const g = await status(id(await tc.legeTeilnehmerAn(knex, {
            turnier_id: gratis.id, vorname: 'V', nachname: 'G', geburtsjahr: 2012, geschlecht: 'm', verein: 'JC B',
            gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', gewogen: true
        }, privilegiert)));
        assert.equal(g.status, 'kampfbereit');
    } finally {
        await stoppe();
    }
});
