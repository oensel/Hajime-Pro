import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// „Anstehende Turniere“: Super-Admins sehen die Turniere aller Vereine, auch Entwürfe anderer Vereine; Vereins-Admins
// sehen fremde Entwürfe weiterhin nicht.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'turniere-super-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

test('Turnierliste: Super-Admin sieht alle anstehenden Turniere aller Vereine, Vereins-Admin nicht fremde Entwürfe', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.use(express.json());
    app.use('/api/turniere', getTurnierRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const hole = async (benutzerId, pfad) => {
        const res = await fetch(basis + pfad, { headers: { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } });
        return { status: res.status, daten: await res.json().catch(() => null) };
    };
    try {
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const n of ['super', 'adminA']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true, super_admin_modus: true });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-super', verein_id: vA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-adminA', verein_id: vA, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-super', 'u-adminA']).update({ aktiver_verein_id: vA });
        const turnier = async (verein, name, datum, status) => id((await knex('turniere').insert({
            bezeichnung: name, ort: 'Ort', datum, ausrichter: 'X', verein_id: verein, status
        }).returning('id'))[0]);
        const tA = await turnier(vA, 'Eigenes A', '2099-03-01', 'veroeffentlicht');
        const tBoeffentlich = await turnier(vB, 'Öffentlich B', '2099-04-01', 'veroeffentlicht');
        const tBentwurf = await turnier(vB, 'Entwurf B', '2099-05-01', 'entwurf');
        await turnier(vB, 'Vergangen B', '2000-01-01', 'abgeschlossen');

        const namen = (r) => r.daten.map(t => t.bezeichnung).sort();
        const admin = await hole('u-adminA', '/api/turniere?zukuenftig=true');
        assert.equal(admin.status, 200);
        assert.deepEqual(namen(admin), ['Eigenes A', 'Öffentlich B']); // Entwurf B bleibt verborgen

        const superAdmin = await hole('u-super', '/api/turniere?zukuenftig=true');
        assert.equal(superAdmin.status, 200);
        assert.deepEqual(namen(superAdmin), ['Eigenes A', 'Entwurf B', 'Öffentlich B']); // alle Vereine, keine vergangenen
        assert.ok(superAdmin.daten.every(t => t.verein_id === vA || t.verein_id === vB));

        // Einzelabruf eines fremden Entwurfs
        assert.equal((await hole('u-super', `/api/turniere/${tBentwurf}`)).status, 200);
        assert.ok([tA, tBoeffentlich].every(Boolean));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
