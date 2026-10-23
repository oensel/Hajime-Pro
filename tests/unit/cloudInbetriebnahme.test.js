import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { verifyPassword } from '../../src/utils/password.js';
import { SUPER_ADMIN_EMAIL } from '../../src/utils/superAdmin.js';

const TEST_PASSWORT = 'Test-Passwort-123';
const VOR_MIGRATION = '20261024100000';

async function zurueckBisVorMigration(knex) {
    for (let i = 0; i < 100; i++) {
        if ((await knex.migrate.currentVersion()) <= VOR_MIGRATION) break;
        await knex.migrate.down();
    }
    assert.equal(await knex.migrate.currentVersion(), VOR_MIGRATION);
}

async function bisVorMigration(knex) {
    process.env.BETRIEBSMODUS = 'server';
    delete process.env.CLOUD_INBETRIEBNAHME;
    delete process.env.SUPER_ADMIN_INITIAL_PASSWORD;
    await knex.migrate.latest();
    await zurueckBisVorMigration(knex);
}

test('Cloud-Inbetriebnahme: Super-Admin und Bundesland', async () => {
    const db = await starteTestPostgres({ migriere: false });
    const { knex } = db;
    const vorher = process.env.BETRIEBSMODUS;
    try {
        await bisVorMigration(knex);
        await knex('vereine').insert([{ name: 'JC Senden' }, { name: 'JC Hessen', bundesland: 'Hessen' }]);

        // Kein Cloud-Modus: nichts wird angelegt
        await knex.migrate.latest();
        assert.equal(await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first(), undefined);

        await zurueckBisVorMigration(knex);
        process.env.BETRIEBSMODUS = 'cloud';
        await knex.migrate.latest();
        assert.equal(await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first(), undefined, 'ohne Freigabe-Variable nichts anlegen');
        await zurueckBisVorMigration(knex);
        process.env.CLOUD_INBETRIEBNAHME = 'true';
        process.env.SUPER_ADMIN_INITIAL_PASSWORD = TEST_PASSWORT;
        await knex.migrate.latest();

        const konto = await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first();
        assert.ok(konto.ist_super_admin);
        assert.ok(konto.super_admin_modus);
        assert.ok(konto.email_bestaetigt_am);
        assert.ok(verifyPassword(TEST_PASSWORT, konto.password_hash));
        assert.equal((await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL })).length, 1);

        const m = await knex('benutzer_vereine').where({ benutzer_id: konto.id });
        assert.equal(m.length, 1);
        assert.equal(m[0].rolle, 'admin');

        assert.equal((await knex('vereine').where({ name: 'JC Senden' }).first()).bundesland, 'Nordrhein-Westfalen');
        assert.equal((await knex('vereine').where({ name: 'JC Hessen' }).first()).bundesland, 'Hessen');
    } finally {
        delete process.env.CLOUD_INBETRIEBNAHME;
        delete process.env.SUPER_ADMIN_INITIAL_PASSWORD;
        if (vorher === undefined) delete process.env.BETRIEBSMODUS; else process.env.BETRIEBSMODUS = vorher;
        await db.stoppe?.();
    }
});

test('Cloud-Inbetriebnahme: bisheriges Konto admin@example.org wird umbenannt', async () => {
    const db = await starteTestPostgres({ migriere: false });
    const { knex } = db;
    const vorher = process.env.BETRIEBSMODUS;
    try {
        await bisVorMigration(knex);
        await knex('benutzer').insert({ id: 'alt', email: 'admin@example.org', password_hash: 'x:y', ist_super_admin: true });
        process.env.BETRIEBSMODUS = 'cloud';
        process.env.CLOUD_INBETRIEBNAHME = 'true';
        process.env.SUPER_ADMIN_INITIAL_PASSWORD = TEST_PASSWORT;
        await knex.migrate.latest();
        const konto = await knex('benutzer').where({ id: 'alt' }).first();
        assert.equal(konto.email, SUPER_ADMIN_EMAIL);
        assert.ok(verifyPassword(TEST_PASSWORT, konto.password_hash));
        assert.equal((await knex('benutzer').where({ ist_super_admin: true })).length, 1);
    } finally {
        delete process.env.CLOUD_INBETRIEBNAHME;
        delete process.env.SUPER_ADMIN_INITIAL_PASSWORD;
        if (vorher === undefined) delete process.env.BETRIEBSMODUS; else process.env.BETRIEBSMODUS = vorher;
        await db.stoppe?.();
    }
});
