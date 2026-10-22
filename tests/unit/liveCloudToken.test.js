import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeToken, pruefeToken, sperreToken, sperreAelterTokens, listeTokens, fuehreTokenBefehlAus } from '../../src/liveCloud/token.js';

let db;
before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });

test('Token: erzeugen, prüfen, nur der Hash liegt in der Datenbank', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'Slave Halle 1' });
    assert.match(token, /^hjl_[0-9a-f]{64}$/);
    const zeile = await knex('live_ingest_tokens').where({ id }).first();
    assert.notEqual(zeile.token_hash, token);
    assert.equal(zeile.token_hash.length, 64);
    assert.deepEqual(await pruefeToken(knex, token), { id, turnierKey: null });
    assert.equal(await pruefeToken(knex, 'hjl_falsch'), null);
    assert.equal(await pruefeToken(knex, undefined), null);
});

test('Token: Sperren wirkt sofort, Bindung an ein Turnier wird geliefert', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'gebunden', turnierKey: '77' });
    assert.deepEqual(await pruefeToken(knex, token), { id, turnierKey: '77' });
    assert.equal(await sperreToken(knex, id), true);
    assert.equal(await pruefeToken(knex, token), null);
    assert.equal(await sperreToken(knex, 99999), false);
});

test('Token: zuletzt_genutzt wird höchstens einmal je Minute geschrieben', async () => {
    const { knex } = db;
    const { id, token } = await erzeugeToken(knex, { name: 'zeit' });
    const t0 = new Date('2026-10-12T10:00:00Z');
    await pruefeToken(knex, token, { jetzt: () => t0 });
    await pruefeToken(knex, token, { jetzt: () => new Date(t0.getTime() + 20_000) });
    assert.equal(new Date((await knex('live_ingest_tokens').where({ id }).first()).zuletzt_genutzt).getTime(), t0.getTime());
    await pruefeToken(knex, token, { jetzt: () => new Date(t0.getTime() + 90_000) });
    assert.equal(new Date((await knex('live_ingest_tokens').where({ id }).first()).zuletzt_genutzt).getTime(), t0.getTime() + 90_000);
});

test('Befehle des Skripts: erzeugen, liste, sperren', async () => {
    const { knex } = db;
    const ausgabe = await fuehreTokenBefehlAus(knex, ['erzeugen', '--name', 'Befehl']);
    assert.match(ausgabe.join('\n'), /hjl_[0-9a-f]{64}/);
    const liste = await fuehreTokenBefehlAus(knex, ['liste']);
    assert.match(liste.join('\n'), /Befehl/);
    const eintraege = await listeTokens(knex);
    const id = eintraege.find(e => e.name === 'Befehl').id;
    assert.match((await fuehreTokenBefehlAus(knex, ['sperren', String(id)])).join('\n'), /gesperrt/);
    await assert.rejects(() => fuehreTokenBefehlAus(knex, ['unbekannt']), /Befehl/);
});

test('Token: sperreAelterTokens sperrt nur ältere aktive Tokens desselben Turniers', async () => {
    const { knex } = db;
    const a = await erzeugeToken(knex, { name: 'a', turnierKey: '7' });
    const b = await erzeugeToken(knex, { name: 'b', turnierKey: '7' });
    const neu = await erzeugeToken(knex, { name: 'neu', turnierKey: '7' });
    const fremd = await erzeugeToken(knex, { name: 'fremd', turnierKey: '8' });
    const frei = await erzeugeToken(knex, { name: 'ungebunden' });
    assert.equal(await sperreAelterTokens(knex, '7', neu.id), 2);
    assert.equal(await pruefeToken(knex, a.token), null);
    assert.equal(await pruefeToken(knex, b.token), null);
    assert.deepEqual(await pruefeToken(knex, neu.token), { id: neu.id, turnierKey: '7' });
    assert.deepEqual(await pruefeToken(knex, fremd.token), { id: fremd.id, turnierKey: '8' });
    assert.deepEqual(await pruefeToken(knex, frei.token), { id: frei.id, turnierKey: null });
    assert.equal(await sperreAelterTokens(knex, '7', neu.id), 0);
});
