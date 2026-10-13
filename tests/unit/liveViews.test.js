import test from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

test('Migration: live_freigabe-Spalte und Views im Schema live', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        assert.equal(await knex.schema.hasColumn('turniere', 'live_freigabe'), true);
        const [{ id: turnierId }] = await knex('turniere').insert({
            bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A'
        }).returning('id');
        const t = await knex('turniere').where({ id: turnierId }).first();
        assert.equal(t.live_freigabe, false);

        await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster',
            geschlecht: 'w', verein: 'JC Muster', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012
        });

        const zeilen = await knex.raw('select * from live.teilnehmer');
        assert.equal(zeilen.rows.length, 1);
        const z = zeilen.rows[0];
        assert.equal(z.vorname, 'Anna');
        assert.match(z.passnummer_hash, /^[0-9a-f]{64}$/);
        for (const verboten of ['judopass_id', 'gewicht', 'geburtsjahr', 'geburtsdatum', 'iban', 'email']) {
            assert.equal(verboten in z, false, `Spalte ${verboten} darf nicht in live.teilnehmer stehen`);
        }
        assert.equal('gewicht_rang' in z, true);
        assert.equal(z.nur_mannschaft, false);
        for (const view of ['turniere', 'kampfflaechen', 'pools', 'kaempfe']) {
            const r = await knex.raw(`select * from live.${view} limit 0`);
            assert.ok(Array.isArray(r.fields), view);
        }
        for (const view of ['turniere', 'pools']) {
            const r = await knex.raw(`select farbe_kaempfer2 from live.${view} limit 0`);
            assert.equal(r.fields[0].name, 'farbe_kaempfer2', view);
        }
    } finally {
        await db.stoppe();
    }
});

test('Teilnehmerschlüssel: ohne Passnummer unterscheidbar, über Re-Import stabil', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const neuesTurnier = async () => (await knex('turniere').insert({
            bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A', urspruengliche_id: 200
        }).returning('id'))[0].id;
        const basis = { vorname: 'Anna', nachname: 'Muster', geschlecht: 'w', verein: 'JC Muster', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012 };
        const t1 = await neuesTurnier();
        const t2 = await neuesTurnier(); // Re-Import desselben Cloud-Turniers: lokal andere ID
        await knex('turnier_teilnehmer').insert([
            { ...basis, turnier_id: t1, judopass_id: '' },
            { ...basis, turnier_id: t1, judopass_id: '', vorname: 'Berta', gewicht: 50 },
            { ...basis, turnier_id: t2, judopass_id: '' }
        ]);
        const zeilen = (await knex.raw('select turnier_id, vorname, passnummer_hash, gewicht_rang from live.teilnehmer order by id')).rows;
        assert.notEqual(zeilen[0].passnummer_hash, zeilen[1].passnummer_hash, 'ohne Passnummer müssen Teilnehmer unterscheidbar bleiben');
        assert.equal(zeilen[0].passnummer_hash, zeilen[2].passnummer_hash, 'derselbe Judoka im Re-Import behält den Schlüssel');
        assert.equal(Number(zeilen[0].gewicht_rang), 1);
        assert.equal(Number(zeilen[1].gewicht_rang), 2); // 50 kg ist schwerer als 40 kg (ohne Pool bilden alle eine Gruppe)
    } finally {
        await db.stoppe();
    }
});

test('View live.teilnehmer: nur_mannschaft für Mannschaftsmitglieder ohne Einzelwettkampf', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const [{ id: turnierId }] = await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A' }).returning('id');
        const basis = { turnier_id: turnierId, nachname: 'M', geschlecht: 'w', verein: 'V', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012 };
        const ids = (await knex('turnier_teilnehmer').insert([
            { ...basis, judopass_id: 'A', vorname: 'NurTeam' },
            { ...basis, judopass_id: 'B', vorname: 'TeamUndEinzel', auch_einzelwettkampf: true },
            { ...basis, judopass_id: 'C', vorname: 'Einzel' }
        ]).returning('id')).map(r => r.id);
        const [{ id: mannschaftId }] = await knex('mannschaften').insert({ turnier_id: turnierId, bezeichnung: 'Team', verein: 'V' }).returning('id');
        await knex('mannschaft_mitglieder').insert([
            { mannschaft_id: mannschaftId, turnier_teilnehmer_id: ids[0], gewichtsklasse: '-44' },
            { mannschaft_id: mannschaftId, turnier_teilnehmer_id: ids[1], gewichtsklasse: '-50' }
        ]);
        const zeilen = (await knex.raw('select vorname, nur_mannschaft from live.teilnehmer')).rows;
        const flag = Object.fromEntries(zeilen.map(z => [z.vorname, z.nur_mannschaft]));
        assert.deepEqual(flag, { NurTeam: true, TeamUndEinzel: false, Einzel: false });
    } finally {
        await db.stoppe();
    }
});
