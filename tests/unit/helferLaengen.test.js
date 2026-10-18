import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Längen im Helferplan: Bezeichnungen und Namen höchstens 255 Zeichen (Spaltenbreite). Über die Oberfläche → 400,
// beim Turnier-Import wird gekappt, damit eine präparierte Datei nicht den ganzen Import abbricht.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const plan = await import('../../src/services/helferPlan.js');
const { ersetzeHelferplan } = await import('../../src/services/helferTransfer.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const LANG = 'x'.repeat(256);

async function erwarte400(promise, muster) {
    await assert.rejects(promise, (e) => { assert.equal(e.status, 400); assert.match(e.message, muster); return true; });
}

test('Helferplan: zu lange Bezeichnung oder Name → 400, Import kappt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const turnierId = id((await knex('turniere').insert({
            bezeichnung: 'Längenpokal', ort: 'Halle', datum: '2030-03-01', ausrichter: 'JC', beginn_min: 540, ende_min: 780,
            status: 'veroeffentlicht'
        }).returning('id'))[0]);

        await erwarte400(plan.legeTaetigkeitAn(knex, turnierId, { bezeichnung: LANG, bedarf: 1 }),
            /^Die Bezeichnung ist zu lang \(höchstens 255 Zeichen\)\.$/);
        const { id: tid } = await plan.legeTaetigkeitAn(knex, turnierId, { bezeichnung: 'y'.repeat(255), bedarf: 1 });
        await erwarte400(plan.aendereTaetigkeit(knex, tid, { bezeichnung: LANG }), /Bezeichnung ist zu lang/);

        const slot = (await plan.ladePlan(knex, turnierId)).taetigkeiten.find(t => t.id === tid).slots[0];
        await erwarte400(plan.traegeManuellEin(knex, { slotId: slot.id, name: LANG, durchId: null }), /Name ist zu lang/);
        assert.ok((await plan.traegeManuellEin(knex, { slotId: slot.id, name: 'n'.repeat(255), durchId: null })).id);

        // Import: Bezeichnung gekappt, unbekannte Art → 'frei'
        await knex.transaction(trx => ersetzeHelferplan(trx, turnierId, {
            taetigkeiten: [{ art: 'boese', bezeichnung: 'z'.repeat(400), bedarf: 1, reihenfolge: 1,
                slots: [{ von_min: 540, bis_min: 600, bedarf: 1, einsaetze: [{ name: 'e'.repeat(300) }] }] }]
        }));
        const t = await knex('helfer_taetigkeiten').where({ turnier_id: turnierId }).first();
        assert.deepEqual([t.art, t.bezeichnung.length], ['frei', 255]);
    } finally {
        await db.stoppe();
    }
});
