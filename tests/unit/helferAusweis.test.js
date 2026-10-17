import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { starteTestPostgres } from '../helpers/testPostgres.js';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { erzeugeAusweisPdf } = await import('../../src/services/helferAusweis.js');
const { ladeAusweiseRoute } = await import('../../src/controllers/helferPlanController.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

async function aufbau(knex, personen, einsaetzeJe = 1) {
    const verein = id((await knex('vereine').insert({ name: 'JC Ausweis ' + Math.random() }).returning('id'))[0]);
    const turnier = id((await knex('turniere').insert({
        bezeichnung: 'Pokal', ort: 'Halle', datum: '2026-11-01', ausrichter: 'JC', verein_id: verein
    }).returning('id'))[0]);
    const t = id((await knex('helfer_taetigkeiten').insert({
        turnier_id: turnier, art: 'frei', bezeichnung: 'Matte 1', bedarf: 5
    }).returning('id'))[0]);
    for (const p of personen) {
        if (p.konto) {
            await knex('benutzer').insert({ id: p.konto, email: `${p.konto}@t.de`, vorname: p.vorname, nachname: p.nachname });
        }
    }
    for (let i = 0; i < einsaetzeJe; i++) {
        const slot = id((await knex('helfer_slots').insert({
            taetigkeit_id: t, von_min: 540 + i * 30, bis_min: 570 + i * 30, bedarf: 10
        }).returning('id'))[0]);
        for (const p of personen) {
            if (p.ohneEinsatz) continue;
            await knex('helfer_einsaetze').insert(p.konto
                ? { slot_id: slot, benutzer_id: p.konto }
                : { slot_id: slot, name_manuell: p.manuell });
        }
    }
    return turnier;
}

const seiten = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

test('Helferausweise: Seiten, Filter, Umlaute, viele Einsätze, Route', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const t1 = await aufbau(knex, [
            { konto: 'u1', vorname: 'Jörg', nachname: 'Müller' },
            { konto: 'u2', vorname: 'Anna', nachname: 'Beck' },
            { manuell: 'Bärbel Groß' },
            { konto: 'u3', vorname: 'Ohne', nachname: 'Einsatz', ohneEinsatz: true }
        ]);
        assert.equal(await seiten(await erzeugeAusweisPdf(knex, t1)), 1);
        assert.equal(await seiten(await erzeugeAusweisPdf(knex, t1, { benutzerIds: ['u1'] })), 1);

        const t2 = await aufbau(knex, [
            { konto: 'a1', vorname: 'A', nachname: 'Eins' }, { konto: 'a2', vorname: 'A', nachname: 'Zwei' },
            { konto: 'a3', vorname: 'A', nachname: 'Drei' }, { konto: 'a4', vorname: 'A', nachname: 'Vier' },
            { manuell: 'Fünf Manuell' }
        ]);
        assert.equal(await seiten(await erzeugeAusweisPdf(knex, t2)), 2);
        assert.equal(await seiten(await erzeugeAusweisPdf(knex, t2, { benutzerIds: ['a1', 'a2'] })), 1);

        const t3 = await aufbau(knex, [{ konto: 'v1', vorname: 'Viel', nachname: 'Beschäftigt' }], 12);
        assert.equal(await seiten(await erzeugeAusweisPdf(knex, t3)), 1);

        // leeres Turnier
        const leer = await aufbau(knex, [{ konto: 'x1', vorname: 'X', nachname: 'Y', ohneEinsatz: true }]);
        await assert.rejects(erzeugeAusweisPdf(knex, leer), (e) => e.statusCode === 404);

        const antwort = () => {
            const r = { kopf: {}, code: 200 };
            r.status = (c) => { r.code = c; return r; };
            r.json = (d) => { r.body = d; return r; };
            r.setHeader = (k, v) => { r.kopf[k] = v; };
            r.send = (b) => { r.body = b; return r; };
            return r;
        };
        const res404 = antwort();
        await ladeAusweiseRoute(knex, { params: { turnierId: leer }, query: {}, tournament: { id: leer } }, res404);
        assert.equal(res404.code, 404);
        const resOk = antwort();
        await ladeAusweiseRoute(knex, { params: { turnierId: t1 }, query: { ids: 'u1,u2' }, tournament: { id: t1 } }, resOk);
        assert.equal(resOk.code, 200);
        assert.equal(resOk.kopf['Content-Type'], 'application/pdf');
        assert.match(resOk.kopf['Content-Disposition'], /inline; filename="helferausweise.pdf"/);
    } finally {
        await db.stoppe();
    }
});
