import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// GET des Helferplans gleicht die Standard-Tätigkeiten (Matten, Waagen) nur für laufende bzw. künftige Turniere ab
// (Status entwurf/veroeffentlicht und Datum ab heute, Europe/Berlin); abgeschlossene, abgesagte oder vergangene
// Turniere werden nur gelesen.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { ladePlanRoute } = await import('../../src/controllers/helferPlanController.js');
const plan = await import('../../src/services/helferPlan.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

test('Helferplan-GET: Abgleich nur für aktive, künftige Turniere', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const turnier = async (status, datum) => {
            const tid = id((await knex('turniere').insert({
                bezeichnung: `T ${status} ${datum}`, ort: 'Halle', datum, ausrichter: 'JC', status, beginn_min: 540, ende_min: 780
            }).returning('id'))[0]);
            await knex('kampfflaechen').insert({ turnier_id: tid, bezeichnung: 'Matte 1' });
            return tid;
        };
        const anzahl = async (tid) => (await knex('helfer_taetigkeiten').where({ turnier_id: tid })).length;
        const lade = async (tid) => {
            const res = fakeRes();
            await ladePlanRoute(knex, { params: { turnierId: String(tid) }, query: {}, tournament: { id: tid } }, res);
            assert.equal(res.statusCode, 200, JSON.stringify(res.body));
        };

        const abgeschlossen = await turnier('abgeschlossen', '2099-05-01');
        const abgesagt = await turnier('abgesagt', '2099-05-01');
        const vergangen = await turnier('veroeffentlicht', '2000-05-01');
        const kuenftig = await turnier('veroeffentlicht', '2099-05-01');
        const entwurf = await turnier('entwurf', '2099-05-01');

        for (const tid of [abgeschlossen, abgesagt, vergangen]) {
            await lade(tid);
            assert.equal(await anzahl(tid), 0, `kein Abgleich für Turnier ${tid}`);
        }
        for (const tid of [kuenftig, entwurf]) {
            await lade(tid);
            assert.ok(await anzahl(tid) > 0, `Abgleich für Turnier ${tid}`);
        }

        // vorhandene Tätigkeiten eines abgeschlossenen Turniers bleiben unverändert (auch bei geänderten Matten)
        await knex('turniere').where({ id: kuenftig }).update({ status: 'abgeschlossen' });
        const vorher = await knex('helfer_taetigkeiten').where({ turnier_id: kuenftig }).orderBy('id');
        await knex('kampfflaechen').insert({ turnier_id: kuenftig, bezeichnung: 'Matte 2' });
        await lade(kuenftig);
        assert.deepEqual(await knex('helfer_taetigkeiten').where({ turnier_id: kuenftig }).orderBy('id'), vorher);

        // Hilfsfunktion meldet, ob abgeglichen wurde
        assert.equal(await plan.synchronisiereWennAktiv(knex, entwurf), true);
        assert.equal(await plan.synchronisiereWennAktiv(knex, abgesagt), false);
    } finally {
        await db.stoppe();
    }
});
