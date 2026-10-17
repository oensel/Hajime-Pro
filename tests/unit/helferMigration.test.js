import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

const LETZTE_VOR_HELFER = '20261017110000_live_views_kampfzeit.js';

test('Helfer-Migrationen: Bestandsdaten, Tabellen und Eindeutigkeit', async () => {
    const db = await starteTestPostgres({ migriere: false });
    const { knex } = db;
    try {
        // Bis vor die Helfer-Migrationen migrieren
        await knex.migrate.latest();
        for (let i = 0; i < 10; i++) {
            const aktuell = await knex.migrate.currentVersion();
            if (aktuell <= '20261017110000') break;
            await knex.migrate.down();
        }
        assert.equal(await knex.migrate.currentVersion(), '20261017110000');
        assert.ok(LETZTE_VOR_HELFER);

        const [v] = await knex('vereine').insert({ name: 'JC Test' }).returning('id');
        const vereinId = typeof v === 'object' ? v.id : v;
        for (const id of ['b-frei', 'b-offen']) {
            await knex('benutzer').insert({ id, email: id + '@test.de' });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'b-frei', verein_id: vereinId, freigegeben: 1 },
            { benutzer_id: 'b-offen', verein_id: vereinId, freigegeben: 0 }
        ]);

        await knex.migrate.latest();

        const frei = await knex('benutzer_vereine').where({ benutzer_id: 'b-frei' }).first();
        const offen = await knex('benutzer_vereine').where({ benutzer_id: 'b-offen' }).first();
        assert.equal(frei.rolle, 'admin');
        assert.equal(offen.rolle, null);
        for (const id of ['b-frei', 'b-offen']) {
            assert.notEqual((await knex('benutzer').where({ id }).first()).email_bestaetigt_am, null);
        }

        const [t] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-11-01', ausrichter: 'A' }).returning('id');
        const turnierId = typeof t === 'object' ? t.id : t;
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        assert.equal(turnier.waagen_anzahl, 1);
        assert.equal(turnier.beginn_min, null);

        for (const tabelle of ['token_einmal', 'helfer_taetigkeiten', 'helfer_slots', 'helfer_einsaetze']) {
            assert.ok(await knex.schema.hasTable(tabelle), tabelle);
        }

        const [ta] = await knex('helfer_taetigkeiten').insert({ turnier_id: turnierId, art: 'waage', bezeichnung: 'Waage 1', bedarf: 2 }).returning('id');
        const taId = typeof ta === 'object' ? ta.id : ta;
        const [s] = await knex('helfer_slots').insert({ taetigkeit_id: taId, von_min: 480, bis_min: 540, bedarf: 2 }).returning('id');
        const slotId = typeof s === 'object' ? s.id : s;
        await knex('helfer_einsaetze').insert({ slot_id: slotId, benutzer_id: 'b-frei' });
        await assert.rejects(knex('helfer_einsaetze').insert({ slot_id: slotId, benutzer_id: 'b-frei' }));
        // Manuelle Einträge (benutzer_id NULL) dürfen mehrfach vorkommen
        await knex('helfer_einsaetze').insert([{ slot_id: slotId, name_manuell: 'A' }, { slot_id: slotId, name_manuell: 'B' }]);

        // Rückwärts-Migration läuft
        // alle Helferverwaltungs-Migrationen (ab 20261018100000) zurücknehmen, auch später hinzugekommene
        for (let i = 0; i < 10 && await knex.schema.hasColumn('benutzer_vereine', 'rolle'); i++) {
            await knex.migrate.down();
        }
        assert.equal(await knex.schema.hasTable('helfer_slots'), false);
        assert.equal(await knex.schema.hasColumn('benutzer_vereine', 'rolle'), false);
    } finally {
        await db.stoppe();
    }
});
