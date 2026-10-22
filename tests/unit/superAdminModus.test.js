import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin-Modus (Spec docs/specs/2026-10-22-super-admin-modus-design.md): ein Super-Admin hat die globalen Rechte
// nur im Super-Admin-Modus; in einem Verein gelten allein die Rechte seiner Rolle dort (auch auf dem Server).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const {
    hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein, setzeAktivenVerein, setzeSuperAdminModus, hatHelferZugriffAufVerein
} = await import('../../src/utils/vereinHelper.js');
const { requireSuperAdmin, requireRolle, requireTournamentEditAccess } = await import('../../src/middleware/auth.js');
const { baueAnmeldeAntwort } = await import('../../src/controllers/authController.js');
const { wechsleAktivenVerein } = await import('../../src/controllers/vereinController.js');
const { createTurnier } = await import('../../src/controllers/turnierController.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function rufe(mw, userId, extra = {}) {
    const req = { user: { id: userId }, params: {}, query: {}, body: {}, baseUrl: '/api/turniere', ...extra };
    const res = fakeRes();
    let weiter = false;
    await mw(req, res, () => { weiter = true; });
    return { weiter, status: res.statusCode, body: res.body };
}

test('Super-Admin-Modus: globale Rechte nur im Modus, im Verein gilt die Rolle', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const vereinA = id((await knex('vereine').insert({ name: 'JC Eigen' }).returning('id'))[0]);
        const vereinB = id((await knex('vereine').insert({ name: 'JC Fremd' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'Uper', ist_super_admin: true, super_admin_modus: true },
            { id: 'u-normal', email: 'normal@test.de', vorname: 'N', nachname: 'Ormal' }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-super', verein_id: vereinA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-normal', verein_id: vereinA, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').where({ id: 'u-super' }).update({ aktiver_verein_id: vereinA });
        const turnierId = id((await knex('turniere').insert({
            bezeichnung: 'Pokal', ort: 'Halle', datum: '2026-12-01', ausrichter: 'JC Fremd', verein_id: vereinB
        }).returning('id'))[0]);
        const turnier = await knex('turniere').where({ id: turnierId }).first();
        const zugriff = async () => hatVereinsZugriffAufTurnier(await ladeBenutzerMitAktivemVerein(knex, 'u-super'), turnier);
        const turnierBearbeiten = () => rufe(requireTournamentEditAccess(knex), 'u-super', { params: { id: String(turnierId) } });

        // Super-Admin-Modus: globale Rechte, auch ohne Mitgliedschaft im Turnier-Verein
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-super')).super_admin_aktiv, true);
        assert.equal(await zugriff(), true);
        assert.equal((await turnierBearbeiten()).weiter, true);
        assert.equal((await rufe(requireSuperAdmin(knex), 'u-super')).weiter, true);
        assert.equal((await rufe(requireRolle(knex, 'admin'), 'u-super')).weiter, true);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-super', vereinB), true);

        // In den Verein wechseln: nur noch die Rolle dort (Helfer) zählt
        await setzeAktivenVerein(knex, 'u-super', vereinA);
        const imVerein = await ladeBenutzerMitAktivemVerein(knex, 'u-super');
        assert.equal(imVerein.super_admin_aktiv, false);
        assert.equal(imVerein.ist_super_admin, true, 'das Konto bleibt Super-Admin');
        assert.equal(await zugriff(), false);
        assert.equal((await turnierBearbeiten()).status, 403);
        const keinSuper = await rufe(requireSuperAdmin(knex), 'u-super');
        assert.equal(keinSuper.weiter, false);
        assert.equal(keinSuper.status, 403);
        assert.match(keinSuper.body.error, /Super-Admin-Modus/);
        assert.equal((await rufe(requireRolle(knex, 'admin'), 'u-super')).status, 403);
        assert.equal((await rufe(requireRolle(knex, 'helfer'), 'u-super')).weiter, true);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-super', vereinB), false);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-super', vereinA), true);

        // Zurück in den Super-Admin-Modus; der zuletzt gewählte Verein bleibt gemerkt
        await setzeSuperAdminModus(knex, 'u-super');
        const zurueck = await ladeBenutzerMitAktivemVerein(knex, 'u-super');
        assert.equal(zurueck.super_admin_aktiv, true);
        assert.equal(zurueck.aktiver_verein_id, vereinA);
        assert.equal(await zugriff(), true);

        // Nur Super-Admins können in den Modus wechseln; ein normales Konto bleibt ohne globale Rechte
        await assert.rejects(setzeSuperAdminModus(knex, 'u-normal'), /Nur Super-Admins/);
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-normal')).super_admin_aktiv, false);
        assert.equal((await rufe(requireSuperAdmin(knex), 'u-normal')).status, 403);
        // Ein Konto mit gesetztem Modus-Flag, aber ohne Super-Admin-Merkmal, gewinnt nichts
        await knex('benutzer').where({ id: 'u-normal' }).update({ super_admin_modus: true });
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-normal')).super_admin_aktiv, false);

        // Wechsel-Endpunkt: { superAdmin: true } und { vereinId }
        const wechsel = async (userId, body) => {
            const res = fakeRes();
            await wechsleAktivenVerein(knex, { user: { id: userId }, body }, res);
            return res;
        };
        await setzeAktivenVerein(knex, 'u-super', vereinA);
        assert.equal((await wechsel('u-super', { superAdmin: true })).statusCode, 200);
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-super')).super_admin_aktiv, true);
        assert.equal((await wechsel('u-super', { vereinId: vereinA })).statusCode, 200);
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-super')).super_admin_aktiv, false);
        assert.equal((await wechsel('u-super', { vereinId: vereinB })).statusCode, 400, 'kein Wechsel in einen Fremdverein');
        assert.equal((await wechsel('u-normal', { superAdmin: true })).statusCode, 400);

        // Turnier anlegen: im Super-Admin-Modus muss der ausrichtende Verein aus der Liste gewählt werden
        const anlegen = async (userId, body) => {
            const res = fakeRes();
            await createTurnier(knex, {
                user: { id: userId }, app: { get: () => undefined },
                body: { bezeichnung: 'Neu', ausrichter: 'X', ort: 'Halle', datum: '2027-03-01', anzahl_kampfflaechen: 1, altersklassen: {}, ...body }
            }, res);
            return res;
        };
        await setzeSuperAdminModus(knex, 'u-super');
        const ohneVerein = await anlegen('u-super', {});
        assert.equal(ohneVerein.statusCode, 400);
        assert.match(ohneVerein.body.error, /Verein aus der Liste/);
        assert.equal((await anlegen('u-super', { verein_id: 99999 })).statusCode, 400);
        const mitVerein = await anlegen('u-super', { verein_id: vereinB });
        assert.ok(mitVerein.statusCode < 300, JSON.stringify(mitVerein.body));
        assert.equal((await knex('turniere').where({ bezeichnung: 'Neu' }).first()).verein_id, vereinB);
        // Im Vereinsmodus zählt der aktive Verein; eine mitgeschickte verein_id wird ignoriert
        await setzeAktivenVerein(knex, 'u-super', vereinA);
        await knex('turniere').where({ bezeichnung: 'Neu' }).delete();
        const imVereinAngelegt = await anlegen('u-super', { verein_id: vereinB, datum: '2027-03-02' });
        assert.ok(imVereinAngelegt.statusCode < 300, JSON.stringify(imVereinAngelegt.body));
        assert.equal((await knex('turniere').where({ bezeichnung: 'Neu' }).first()).verein_id, vereinA);

        // Login: ein Super-Admin startet immer im Super-Admin-Modus, ein normales Konto nie
        await setzeAktivenVerein(knex, 'u-super', vereinA);
        const antwort = await baueAnmeldeAntwort(knex, await knex('benutzer').where({ id: 'u-super' }).first());
        assert.equal(antwort.user.super_admin_aktiv, true);
        assert.equal(antwort.user.ist_super_admin, true);
        const normal = await baueAnmeldeAntwort(knex, await knex('benutzer').where({ id: 'u-normal' }).first());
        assert.equal(normal.user.super_admin_aktiv, false);
    } finally {
        await db.stoppe();
    }
});
