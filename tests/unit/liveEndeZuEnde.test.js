import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';
import { ladeSnapshots } from '../../src/live/snapshot.js';
import { erzeugeUplink } from '../../src/live/uplink.js';
import { starteLiveDienst } from '../../src/live/dienst.js';

test('Prozesskette: Freigabe → Snapshot an lokales Ziel → Rücknahme bei Widerruf', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    const empfangen = [];
    const server = http.createServer((req, res) => {
        const teile = [];
        req.on('data', d => teile.push(d));
        req.on('end', () => {
            empfangen.push({ auth: req.headers.authorization, body: JSON.parse(zlib.gunzipSync(Buffer.concat(teile)).toString('utf8')) });
            res.statusCode = 204;
            res.end();
        });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}/api/live/ingest`;
    let live;
    let dienst;
    try {
        const [{ id: turnierId }] = await knex('turniere').insert({
            bezeichnung: 'Live', ort: 'O', datum: '2026-10-12', ausrichter: 'A', urspruengliche_id: 77, live_freigabe: true
        }).returning('id');
        await legeLiveRolleAn(knex, { passwort: 'pw', datenbank: verbindung.database });
        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'pw' } });

        const uplink = erzeugeUplink({ url, token: 'tok', log: { warn() {}, log() {} } });
        dienst = starteLiveDienst({
            ladeSnapshots: () => ladeSnapshots(live, { geheimnis: 'g' }),
            uplink, log: { log() {}, warn() {}, error() {} }, setzeTimer: () => 0, loescheTimer: () => {}
        });

        await dienst.tick();
        assert.equal(empfangen.length, 1);
        assert.equal(empfangen[0].auth, 'Bearer tok');
        assert.equal(empfangen[0].body.turnierKey, '77');
        assert.equal(empfangen[0].body.name, 'Live');

        await knex('turniere').where({ id: turnierId }).update({ live_freigabe: false });
        await dienst.tick();
        assert.equal(empfangen.length, 2);
        assert.equal(empfangen[1].body.zurueckgezogen, true);

        await dienst.tick();
        assert.equal(empfangen.length, 2);
    } finally {
        if (dienst) dienst.stoppe();
        if (live) await live.destroy();
        await new Promise(r => server.close(r));
        await db.stoppe();
    }
});
