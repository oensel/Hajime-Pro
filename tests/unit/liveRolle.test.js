import test from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';

test('Rolle live_ro: liest nur die Views, schreibt nichts, sieht keine Basistabellen', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    let live;
    try {
        await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A' });
        await legeLiveRolleAn(knex, { passwort: 'pw\'mit"Zeichen', datenbank: verbindung.database });
        await legeLiveRolleAn(knex, { passwort: 'zweiterLauf', datenbank: verbindung.database }); // idempotent

        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'zweiterLauf' } });
        const turniere = await live.raw('select id, live_freigabe from live.turniere');
        assert.equal(turniere.rows.length, 1);

        await assert.rejects(live.raw('select * from public.turniere'), /permission denied/);
        await assert.rejects(live.raw('select * from public.turnier_teilnehmer'), /permission denied/);
        await assert.rejects(live.raw('update live.turniere set live_freigabe = true'), /read-only|permission denied|cannot/i);
        await assert.rejects(live.raw('delete from live.kaempfe'), /read-only|permission denied|cannot/i);

        const t = await live.raw('show statement_timeout');
        assert.equal(t.rows[0].statement_timeout, '3s');
        const ro = await live.raw('show default_transaction_read_only');
        assert.equal(ro.rows[0].default_transaction_read_only, 'on');
    } finally {
        if (live) await live.destroy();
        await db.stoppe();
    }
});

test('legeLiveRolleAn lehnt ungültige Rollennamen ab', async () => {
    await assert.rejects(legeLiveRolleAn({}, { passwort: 'x', rolle: 'a; drop table x', datenbank: 'd' }), /Rollenname/);
});
