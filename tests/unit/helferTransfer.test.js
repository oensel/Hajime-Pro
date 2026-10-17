import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Helferplan im Turnier-Export/-Import (Helferverwaltung, Spec Abschnitte 7 und 8): Anzeigenamen statt
// Konten, Import als name_manuell, alte Dateien ohne helferplan, Turnierzeit und Waagenanzahl, und das
// Ersetzen nur des Helferplans (Aktualisierung aus der Cloud).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { baueTurnierExport, importiereTurnierDaten } = await import('../../src/controllers/turnierController.js');
const { ersetzeHelferplan } = await import('../../src/services/helferTransfer.js');
const plan = await import('../../src/services/helferPlan.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

// Turnier mit 2 Matten, Waage, eigener Tätigkeit; zwei Einsätze (Konto + manueller Name).
async function baueQuellTurnier(knex) {
    const verein = id((await knex('vereine').insert({ name: 'JC Transfer' }).returning('id'))[0]);
    await knex('benutzer').insert({
        id: 'u-konto-1', email: 'geheim.konto@test.de', vorname: 'Klara', nachname: 'Konto', password_hash: 'hash-xyz'
    });
    await knex('benutzer_vereine').insert({ benutzer_id: 'u-konto-1', verein_id: verein, freigegeben: 1, rolle: 'helfer' });
    const turnierId = id((await knex('turniere').insert({
        bezeichnung: 'Transferpokal', ort: 'Halle', datum: '2030-03-01', ausrichter: 'JC Transfer', verein_id: verein,
        beginn_min: 540, ende_min: 960, waagen_anzahl: 2, status: 'veroeffentlicht'
    }).returning('id'))[0]);
    await knex('kampfflaechen').insert([
        { turnier_id: turnierId, bezeichnung: 'Matte 1' },
        { turnier_id: turnierId, bezeichnung: 'Matte 2' }
    ]);
    await plan.synchronisiereStandardTaetigkeiten(knex, turnierId);
    await plan.legeTaetigkeitAn(knex, turnierId, { bezeichnung: 'Kuchenverkauf', bedarf: 3 });
    const p = await plan.ladePlan(knex, turnierId);
    const matte2 = p.taetigkeiten.find(t => t.bezeichnung === 'Kampfgericht Matte 2');
    const kuchen = p.taetigkeiten.find(t => t.bezeichnung === 'Kuchenverkauf');
    await plan.traegeEin(knex, { slotId: matte2.slots[0].id, benutzerId: 'u-konto-1', durchId: 'u-konto-1', alsOrga: true });
    await plan.traegeManuellEin(knex, { slotId: kuchen.slots[1].id, name: 'Oma Erna', durchId: null });
    return turnierId;
}

// Vergleichbare Form des Plans (ohne IDs).
async function planForm(knex, turnierId) {
    const p = await plan.ladePlan(knex, turnierId);
    return p.taetigkeiten.map(t => ({
        art: t.art, bezeichnung: t.bezeichnung, bedarf: t.bedarf,
        slots: t.slots.map(s => ({ von: s.von_min, bis: s.bis_min, bedarf: s.bedarf, namen: s.einsaetze.map(e => e.name) }))
    }));
}

test('Helferplan-Export: Anzeigenamen ohne E-Mail, Passwort-Hash und Benutzer-IDs', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const turnierId = await baueQuellTurnier(knex);
        const daten = await baueTurnierExport(knex, turnierId);
        const text = JSON.stringify(daten);

        assert.ok(daten.helferplan, 'helferplan fehlt im Export');
        assert.ok(text.includes('Klara Konto'));
        assert.ok(text.includes('Oma Erna'));
        assert.ok(!text.includes('geheim.konto@test.de'), 'E-Mail im Export');
        assert.ok(!text.includes('hash-xyz'), 'Passwort-Hash im Export');
        assert.ok(!/password/i.test(text), '„password“ im Export');
        assert.ok(!text.includes('u-konto-1'), 'Benutzer-ID im Export');
        assert.ok(!text.includes('benutzer_id'), 'Feld benutzer_id im Export');

        const matte2 = daten.helferplan.taetigkeiten.find(t => t.bezeichnung === 'Kampfgericht Matte 2');
        assert.equal(matte2.art, 'matte');
        assert.equal(matte2.kampfflaeche_ref, 1, 'Index der Kampffläche im Export');
        assert.deepEqual(matte2.slots[0].einsaetze, [{ name: 'Klara Konto' }]);
        assert.equal(daten.helferplan.taetigkeiten.find(t => t.art === 'frei').kampfflaeche_ref, null);

        assert.equal(daten.turnier.beginn_min, 540);
        assert.equal(daten.turnier.ende_min, 960);
        assert.equal(daten.turnier.waagen_anzahl, 2);
    } finally {
        await db.stoppe();
    }
});

test('Turnier-Import: Helferplan als name_manuell, Turnierzeit und Waagenanzahl überleben die Rundreise', async () => {
    const quelle = await starteTestPostgres();
    const ziel = await starteTestPostgres();
    try {
        const quellId = await baueQuellTurnier(quelle.knex);
        const daten = JSON.parse(JSON.stringify(await baueTurnierExport(quelle.knex, quellId)));

        const { turnierId } = await importiereTurnierDaten(ziel.knex, null, daten);
        const t = await ziel.knex('turniere').where({ id: turnierId }).first();
        assert.equal(t.beginn_min, 540);
        assert.equal(t.ende_min, 960);
        assert.equal(t.waagen_anzahl, 2);

        assert.deepEqual(await planForm(ziel.knex, turnierId), await planForm(quelle.knex, quellId));

        const einsaetze = await ziel.knex('helfer_einsaetze').select('benutzer_id', 'name_manuell').orderBy('name_manuell');
        assert.deepEqual(einsaetze, [
            { benutzer_id: null, name_manuell: 'Klara Konto' },
            { benutzer_id: null, name_manuell: 'Oma Erna' }
        ]);

        // Matten-Tätigkeit hängt an der importierten Kampffläche gleicher Position
        const flaechen = await ziel.knex('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id');
        const matte2 = await ziel.knex('helfer_taetigkeiten').where({ turnier_id: turnierId, bezeichnung: 'Kampfgericht Matte 2' }).first();
        assert.equal(matte2.kampfflaeche_id, flaechen[1].id);

        // Laden des Plans legt keine doppelten Matten/Waagen an
        await plan.synchronisiereStandardTaetigkeiten(ziel.knex, turnierId);
        assert.deepEqual(await planForm(ziel.knex, turnierId), await planForm(quelle.knex, quellId));
    } finally {
        await quelle.stoppe();
        await ziel.stoppe();
    }
});

test('Turnier-Import: alte Datei ohne helferplan und ohne Turnierzeit', async () => {
    const db = await starteTestPostgres();
    try {
        const daten = {
            turnier: { id: 77, bezeichnung: 'Altdatei', ort: 'Halle', datum: '2030-04-01', ausrichter: 'JC Alt', altersklassen: [] },
            kampfflaechen: [{ id: 5, bezeichnung: 'Matte 1' }], pools: [], teilnehmer: [], kaempfe: []
        };
        const { turnierId } = await importiereTurnierDaten(db.knex, null, daten);
        const t = await db.knex('turniere').where({ id: turnierId }).first();
        assert.equal(t.beginn_min, null);
        assert.equal(t.ende_min, null);
        assert.equal(t.waagen_anzahl, 1);
        assert.equal((await db.knex('helfer_taetigkeiten').where({ turnier_id: turnierId })).length, 0);
    } finally {
        await db.stoppe();
    }
});

test('ersetzeHelferplan: ersetzt nur den Helferplan des Turniers', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const turnierId = await baueQuellTurnier(knex);
        const andereId = id((await knex('turniere').insert({
            bezeichnung: 'Anderes', ort: 'X', datum: '2030-09-09', ausrichter: 'JC Transfer', beginn_min: 600, ende_min: 900
        }).returning('id'))[0]);
        await plan.legeTaetigkeitAn(knex, andereId, { bezeichnung: 'Bleibt', bedarf: 1 });
        const flaechenVorher = await knex('kampfflaechen').where({ turnier_id: turnierId }).orderBy('id');

        await knex.transaction(trx => ersetzeHelferplan(trx, turnierId, {
            taetigkeiten: [
                { art: 'matte', bezeichnung: 'Kampfgericht Matte 2', bedarf: 2, reihenfolge: 2, kampfflaeche_ref: 1,
                    slots: [{ von_min: 540, bis_min: 660, bedarf: 2, einsaetze: [{ name: 'Neu Eins' }, { name: '  ' }] }] },
                { art: 'frei', bezeichnung: 'Parkplatz', bedarf: 1, reihenfolge: 1, kampfflaeche_ref: 9,
                    slots: [{ von_min: 600, bis_min: 720, bedarf: 1, einsaetze: [{ name: 'Neu Zwei' }] }] }
            ]
        }));

        const neu = await knex('helfer_taetigkeiten').where({ turnier_id: turnierId }).orderBy('id');
        assert.deepEqual(neu.map(t => [t.art, t.bezeichnung, t.kampfflaeche_id]), [
            ['matte', 'Kampfgericht Matte 2', flaechenVorher[1].id],
            ['frei', 'Parkplatz', null]
        ]);
        const namen = (await knex('helfer_einsaetze as e').join('helfer_slots as s', 's.id', 'e.slot_id')
            .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id').where('t.turnier_id', turnierId)
            .orderBy('e.name_manuell').select('e.name_manuell', 'e.benutzer_id'));
        assert.deepEqual(namen, [{ name_manuell: 'Neu Eins', benutzer_id: null }, { name_manuell: 'Neu Zwei', benutzer_id: null }]);

        // anderes Turnier und Kampfflächen unverändert
        assert.equal((await knex('helfer_taetigkeiten').where({ turnier_id: andereId })).length, 1);
        assert.equal((await knex('kampfflaechen').where({ turnier_id: turnierId })).length, 2);
    } finally {
        await db.stoppe();
    }
});
