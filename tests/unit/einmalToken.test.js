import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Einmal-Token (Helferverwaltung, Spec Abschnitt 4): E-Mail-Bestätigung und Freischaltungs-Links.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { erzeugeToken, pruefeToken, verbrauchePruefe } = await import('../../src/services/einmalToken.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('Einmal-Token: gültig, einmalig, ablaufend, zweckgebunden, nur als Hash gespeichert', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const verein = id((await knex('vereine').insert({ name: 'JC Token' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-t', email: 't@test.de', vorname: 'T', nachname: 'Oken' });

        // gültig
        const token = await erzeugeToken(knex, { benutzerId: 'u-t', zweck: 'freischaltung', vereinId: verein });
        assert.equal(typeof token, 'string');
        assert.ok(token.length >= 32);
        const geprueft = await pruefeToken(knex, token, 'freischaltung');
        assert.equal(geprueft.benutzer_id, 'u-t');
        assert.equal(geprueft.verein_id, verein);

        // pruefeToken verbraucht nicht (auch mehrfach)
        assert.ok(await pruefeToken(knex, token, 'freischaltung'));
        const zeile = await knex('token_einmal').where({ id: geprueft.id }).first();
        assert.equal(zeile.benutzt_am, null);

        // in der DB steht nie der Klartext
        const alle = await knex('token_einmal').select('*');
        for (const z of alle) {
            assert.ok(!Object.values(z).some(v => v === token), 'Klartext-Token in der DB');
        }
        assert.match(zeile.token_hash, /^[0-9a-f]{64}$/);

        // falscher Zweck → null
        assert.equal(await pruefeToken(knex, token, 'email'), null);
        assert.equal(await verbrauchePruefe(knex, token, 'email'), null);
        assert.equal((await knex('token_einmal').where({ id: geprueft.id }).first()).benutzt_am, null);

        // verbrauchen: erster Aufruf liefert die Zeile, zweiter null
        const verbraucht = await verbrauchePruefe(knex, token, 'freischaltung');
        assert.equal(verbraucht.benutzer_id, 'u-t');
        assert.equal(verbraucht.verein_id, verein);
        assert.equal(await verbrauchePruefe(knex, token, 'freischaltung'), null);
        assert.equal(await pruefeToken(knex, token, 'freischaltung'), null);

        // gleichzeitig verbrauchen: genau einer gewinnt
        const parallel = await erzeugeToken(knex, { benutzerId: 'u-t', zweck: 'email' });
        const ergebnisse = await Promise.all([1, 2, 3].map(() => verbrauchePruefe(knex, parallel, 'email')));
        assert.equal(ergebnisse.filter(Boolean).length, 1);

        // abgelaufen → null
        const alt = await erzeugeToken(knex, { benutzerId: 'u-t', zweck: 'email', gueltigStunden: 48 });
        const altId = (await pruefeToken(knex, alt, 'email')).id;
        await knex('token_einmal').where({ id: altId }).update({ laeuft_ab_am: knex.raw("now() - interval '1 minute'") });
        assert.equal(await pruefeToken(knex, alt, 'email'), null);
        assert.equal(await verbrauchePruefe(knex, alt, 'email'), null);

        // unbekannt / leer → null
        assert.equal(await pruefeToken(knex, 'gibt-es-nicht', 'email'), null);
        assert.equal(await pruefeToken(knex, '', 'email'), null);
        assert.equal(await verbrauchePruefe(knex, undefined, 'email'), null);

        // ungültiger Zweck beim Erzeugen
        await assert.rejects(() => erzeugeToken(knex, { benutzerId: 'u-t', zweck: 'quatsch' }));
    } finally {
        await db.stoppe();
    }
});
