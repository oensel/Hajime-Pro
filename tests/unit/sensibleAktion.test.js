import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// pruefeSensibleAktion: nur Super-Admins im Super-Admin-Modus brauchen eine frische 2FA-Anmeldung (Claim zf) oder einen Code.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
delete process.env.SUPER_ADMIN_2FA;

const { pruefeSensibleAktion } = await import('../../src/utils/sensibleAktion.js');

const anfrage = (user, headers = {}) => ({ user, get: (name) => headers[String(name).toLowerCase()] });

test('pruefeSensibleAktion', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const verein = (await knex('vereine').insert({ name: 'JC S' }).returning('id'))[0];
        const vereinId = typeof verein === 'object' ? verein.id : verein;
        for (const n of ['admin', 'super', 'ruhend']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vereinId });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: vereinId, freigegeben: 1, rolle: 'admin' });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true, super_admin_modus: true });
        // Super-Admin-Konto, aber gerade im Verein unterwegs (Modus aus): gilt dort nur seine Rolle
        await knex('benutzer').where({ id: 'u-ruhend' }).update({ ist_super_admin: true, super_admin_modus: false });
        const jetzt = Math.floor(Date.now() / 1000);

        // Nicht-Super-Admin: immer ok, auch ohne zf und Code
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-admin' })), { ok: true });
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-admin' }), { frischeAnmeldungGenuegt: true }), { ok: true });
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-ruhend' })), { ok: true });

        // Super-Admin: frische Anmeldung genügt nur mit frischeAnmeldungGenuegt
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-super', zf: jetzt }), { frischeAnmeldungGenuegt: true }), { ok: true });
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-super', zf: jetzt - 590 }), { frischeAnmeldungGenuegt: true }), { ok: true });
        const ignoriert = await pruefeSensibleAktion(knex, anfrage({ id: 'u-super', zf: jetzt }), { frischeAnmeldungGenuegt: false });
        assert.equal(ignoriert.ok, false);
        assert.equal(ignoriert.status, 403);
        assert.equal(ignoriert.code, 'zwei_faktor');
        assert.equal(typeof ignoriert.error, 'string');
        const alt = await pruefeSensibleAktion(knex, anfrage({ id: 'u-super', zf: jetzt - 601 }), { frischeAnmeldungGenuegt: true });
        assert.equal(alt.ok, false);
        assert.equal(alt.code, 'zwei_faktor');
        // zf in der Zukunft gilt nicht
        const zukunft = await pruefeSensibleAktion(knex, anfrage({ id: 'u-super', zf: jetzt + 3600 }), { frischeAnmeldungGenuegt: true });
        assert.equal(zukunft.ok, false);
        // falscher Code → 403 zwei_faktor (nie 401)
        const falsch = await pruefeSensibleAktion(knex, anfrage({ id: 'u-super' }, { 'x-2fa-code': '123456' }));
        assert.equal(falsch.status, 403);
        assert.equal(falsch.code, 'zwei_faktor');

        // Ohne 2FA-Pflicht immer ok
        process.env.SUPER_ADMIN_2FA = 'false';
        assert.deepEqual(await pruefeSensibleAktion(knex, anfrage({ id: 'u-super' })), { ok: true });
        delete process.env.SUPER_ADMIN_2FA;
    } finally {
        await stoppe();
    }
});
