import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
// Hallen-Server (Einzelbenutzerbetrieb)
process.env.BETRIEBSMODUS = 'server';
process.env.DB_HOST = '127.0.0.1';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { createTurnier, updateTurnier } = await import('../../src/controllers/turnierController.js');
const id = (r) => (typeof r === 'object' ? r.id : r);

function aufruf(fn, knex, req) {
    return new Promise((resolve, reject) => {
        const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code || 200, ...b }); return this; } };
        fn(knex, { app: { get: () => null }, params: {}, user: { id: 'u' }, ...req }, res).catch(reject);
    });
}

test('Hallen-Server: Cloud-Turnier mit Startgeld ohne IBAN bleibt speicherbar, lokal angelegtes nicht', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const v = id((await knex('vereine').insert({ name: 'JC H' }).returning('id'))[0]);
        const basis = { bezeichnung: 'Cup', ort: 'Halle', ausrichter: 'JC H', datum: '2031-05-01', anzahl_kampfflaechen: 1, startgeld: 8 };
        const cloud = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2031-05-01', ausrichter: 'JC H', verein_id: v, startgeld: 8, urspruengliche_id: 4711
        }).returning('id'))[0]);
        const lokal = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2031-05-02', ausrichter: 'JC H', verein_id: v, startgeld: 8
        }).returning('id'))[0]);

        let r = await aufruf(updateTurnier, knex, { params: { id: String(cloud) }, body: { ...basis } });
        assert.equal(r.code, 200, JSON.stringify(r));
        r = await aufruf(updateTurnier, knex, { params: { id: String(lokal) }, body: { ...basis, datum: '2031-05-02' } });
        assert.equal(r.code, 400, JSON.stringify(r));
        r = await aufruf(createTurnier, knex, { body: { ...basis, datum: '2031-05-03' } });
        assert.equal(r.code, 400, JSON.stringify(r));
    } finally {
        await stoppe();
    }
});
