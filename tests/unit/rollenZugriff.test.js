import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Rollenbasierte Zugriffsprüfung (Helferverwaltung, Spec Abschnitt 3): Verwaltung nur für Admin/Benutzer des
// ausrichtenden Vereins oder den Super-Admin, nie für reine Helfer oder nicht freigegebene Mitglieder.
// Die Middlewares prüfen nur außerhalb des Einzelbenutzerbetriebs, daher läuft dieser Test als Cloud.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const {
    hatVereinsZugriffAufTurnier, ladeBenutzerMitAktivemVerein, ladeVereineFuerBenutzer, setzeAktivenVerein,
    hatHelferZugriffAufVerein, ladeVereinIdsMitRolle
} = await import('../../src/utils/vereinHelper.js');
const { requireTournamentEditAccess, requireVereinFreigabe, requireRolle } = await import('../../src/middleware/auth.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function rufeMiddleware(mw, { userId, params = {}, query = {}, body = {}, baseUrl = '/api/turniere' }) {
    const req = { user: { id: userId }, params, query, body, baseUrl };
    const res = fakeRes();
    let weiter = false;
    await mw(req, res, () => { weiter = true; });
    return { weiter, status: res.statusCode, body: res.body, req };
}

test('Rollen: Turnierzugriff, Middlewares und Vereinslisten', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const vereinA = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vereinB = id((await knex('vereine').insert({ name: 'JC Fremd' }).returning('id'))[0]);

        const benutzer = ['admin', 'benutzer', 'helfer', 'offen', 'fremd', 'super', 'doppel'];
        for (const b of benutzer) {
            await knex('benutzer').insert({ id: `u-${b}`, email: `${b}@test.de`, vorname: b, nachname: 'Test' });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true, super_admin_modus: true });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: vereinA, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-benutzer', verein_id: vereinA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-helfer', verein_id: vereinA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-offen', verein_id: vereinA, freigegeben: 0, rolle: null },
            { benutzer_id: 'u-fremd', verein_id: vereinB, freigegeben: 1, rolle: 'admin' },
            // Dasselbe Konto: Admin in B, nur Helfer in A
            { benutzer_id: 'u-doppel', verein_id: vereinB, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-doppel', verein_id: vereinA, freigegeben: 1, rolle: 'helfer' }
        ]);
        for (const b of ['admin', 'benutzer', 'helfer', 'offen']) {
            await setzeAktivenVerein(knex, `u-${b}`, vereinA);
        }
        await setzeAktivenVerein(knex, 'u-fremd', vereinB);
        await setzeAktivenVerein(knex, 'u-doppel', vereinB);

        const turnierId = id((await knex('turniere').insert({
            bezeichnung: 'Pokal', ort: 'Halle', datum: '2026-12-01', ausrichter: 'JC Ausrichter', verein_id: vereinA
        }).returning('id'))[0]);
        const turnier = await knex('turniere').where({ id: turnierId }).first();

        // ladeBenutzerMitAktivemVerein liefert verein_rolle
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-admin')).verein_rolle, 'admin');
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-helfer')).verein_rolle, 'helfer');
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-offen')).verein_rolle, null);
        assert.equal((await ladeBenutzerMitAktivemVerein(knex, 'u-super')).verein_rolle, null);

        // hatVereinsZugriffAufTurnier
        const zugriff = async (u) => hatVereinsZugriffAufTurnier(await ladeBenutzerMitAktivemVerein(knex, u), turnier);
        assert.equal(await zugriff('u-admin'), true);
        assert.equal(await zugriff('u-benutzer'), true);
        assert.equal(await zugriff('u-super'), true, 'Super-Admin ohne Mitgliedschaft im Turnier-Verein');
        assert.equal(await zugriff('u-helfer'), false);
        assert.equal(await zugriff('u-offen'), false);
        assert.equal(await zugriff('u-fremd'), false);
        assert.equal(await zugriff('u-doppel'), false);
        // Auch eine nicht freigegebene Mitgliedschaft mit (inkonsistenter) Rolle reicht nicht
        assert.equal(hatVereinsZugriffAufTurnier({ verein_id: vereinA, verein_freigegeben: 0, verein_rolle: 'admin' }, turnier), false);

        // requireTournamentEditAccess
        const edit = requireTournamentEditAccess(knex);
        const aufruf = (userId) => rufeMiddleware(edit, { userId, params: { id: String(turnierId) } });
        for (const u of ['u-admin', 'u-benutzer', 'u-super']) {
            const r = await aufruf(u);
            assert.equal(r.weiter, true, `${u} darf bearbeiten`);
            assert.equal(r.req.tournament.id, turnierId);
        }
        for (const u of ['u-helfer', 'u-offen', 'u-fremd']) {
            const r = await aufruf(u);
            assert.equal(r.weiter, false, `${u} darf nicht bearbeiten`);
            assert.equal(r.status, 403);
        }
        // Review Focus: Konto ist nur Helfer im Turnier-Verein, wechselt per setzeAktivenVerein dorthin → trotzdem 403
        await setzeAktivenVerein(knex, 'u-doppel', vereinA);
        const doppel = await aufruf('u-doppel');
        assert.equal(doppel.weiter, false);
        assert.equal(doppel.status, 403);

        // requireVereinFreigabe: freigegeben UND mindestens Benutzer (oder Super-Admin)
        const freigabe = requireVereinFreigabe(knex);
        for (const u of ['u-admin', 'u-benutzer', 'u-super']) {
            assert.equal((await rufeMiddleware(freigabe, { userId: u })).weiter, true, u);
        }
        for (const u of ['u-helfer', 'u-offen', 'u-doppel']) {
            const r = await rufeMiddleware(freigabe, { userId: u });
            assert.equal(r.weiter, false, u);
            assert.equal(r.status, 403);
        }

        // requireRolle
        const nurAdmin = requireRolle(knex, 'admin');
        assert.equal((await rufeMiddleware(nurAdmin, { userId: 'u-admin' })).weiter, true);
        assert.equal((await rufeMiddleware(nurAdmin, { userId: 'u-super' })).weiter, true);
        for (const u of ['u-benutzer', 'u-helfer', 'u-offen']) {
            const r = await rufeMiddleware(nurAdmin, { userId: u });
            assert.equal(r.weiter, false, u);
            assert.equal(r.status, 403);
            assert.equal(typeof r.body.error, 'string');
        }
        const abHelfer = requireRolle(knex, 'helfer');
        assert.equal((await rufeMiddleware(abHelfer, { userId: 'u-helfer' })).weiter, true);
        assert.equal((await rufeMiddleware(abHelfer, { userId: 'u-offen' })).status, 403);

        // ladeVereineFuerBenutzer enthält rolle
        const vereineDoppel = await ladeVereineFuerBenutzer(knex, 'u-doppel');
        assert.deepEqual(vereineDoppel.map(v => [v.name, v.rolle, v.freigegeben]),
            [['JC Ausrichter', 'helfer', true], ['JC Fremd', 'admin', true]]);
        assert.deepEqual((await ladeVereineFuerBenutzer(knex, 'u-offen')).map(v => v.rolle), [null]);

        // hatHelferZugriffAufVerein: jede freigegebene Mitgliedschaft oder Super-Admin
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-helfer', vereinA), true);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-admin', vereinA), true);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-super', vereinA), true);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-offen', vereinA), false);
        assert.equal(await hatHelferZugriffAufVerein(knex, 'u-fremd', vereinA), false);

        // ladeVereinIdsMitRolle
        assert.deepEqual(await ladeVereinIdsMitRolle(knex, 'u-doppel', 'benutzer'), [vereinB]);
        assert.deepEqual((await ladeVereinIdsMitRolle(knex, 'u-doppel', 'helfer')).sort((a, b) => a - b), [vereinA, vereinB].sort((a, b) => a - b));
        assert.deepEqual(await ladeVereinIdsMitRolle(knex, 'u-offen', 'helfer'), []);
        assert.deepEqual(await ladeVereinIdsMitRolle(knex, 'u-benutzer', 'admin'), []);
    } finally {
        await db.stoppe();
    }
});

// Fix Runde 1: Der Vereinsnamen-Pfad (Teilnehmer/Mannschaften eines Fremdvereins) gilt nur für Admin/Benutzer.
// Ein reiner Helfer ist dort wie ein Konto ohne Verein. Und createTurnier verlangt einen aktiven Verein.
test('Rollen: Fremdvereins-Pfad für Teilnehmer/Mannschaften und Turnier anlegen', async () => {
    const { createTeilnehmer } = await import('../../src/controllers/teilnehmerController.js');
    const { updateMannschaft } = await import('../../src/controllers/mannschaftController.js');
    const { createTurnier } = await import('../../src/controllers/turnierController.js');
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const vereinA = id((await knex('vereine').insert({ name: 'JC Gast' }).returning('id'))[0]);
        const vereinC = id((await knex('vereine').insert({ name: 'JC Host' }).returning('id'))[0]);
        for (const b of ['admin', 'benutzer', 'helfer', 'super']) {
            await knex('benutzer').insert({ id: `g-${b}`, email: `g-${b}@test.de`, vorname: b, nachname: 'Gast' });
        }
        await knex('benutzer').where({ id: 'g-super' }).update({ ist_super_admin: true, super_admin_modus: true });
        await knex('benutzer_vereine').insert(['admin', 'benutzer', 'helfer'].map(r => (
            { benutzer_id: `g-${r}`, verein_id: vereinA, freigegeben: 1, rolle: r })));
        for (const b of ['admin', 'benutzer', 'helfer']) await setzeAktivenVerein(knex, `g-${b}`, vereinA);

        const turnierId = id((await knex('turniere').insert({
            bezeichnung: 'Offen', ort: 'Halle', datum: '2099-12-01', ausrichter: 'JC Host', verein_id: vereinC,
            status: 'veroeffentlicht'
        }).returning('id'))[0]);

        // Teilnehmer für den eigenen Verein bei einem fremden Turnier anmelden
        const melde = async (userId, vorname) => {
            const res = fakeRes();
            await createTeilnehmer(knex, { user: { id: userId }, body: {
                turnier_id: turnierId, vorname, nachname: 'Test', geburtsjahr: 2010, geschlecht: 'm', gewicht: 40, altersklasse: 'U18', gewichtsklasse: '-40', verein: 'JC Gast'
            } }, res);
            return res;
        };
        for (const u of ['g-admin', 'g-benutzer']) {
            const r = await melde(u, u);
            assert.equal(r.statusCode, 201, `${u}: ${JSON.stringify(r.body)}`);
        }
        const helferMeldung = await melde('g-helfer', 'Helfer');
        assert.notEqual(helferMeldung.statusCode, 201);
        assert.ok([400, 403].includes(helferMeldung.statusCode), JSON.stringify(helferMeldung.body));
        assert.equal(await knex('turnier_teilnehmer').where({ vorname: 'Helfer' }).first(), undefined);

        // Mannschaft des eigenen Vereins ändern
        const mannschaftId = id((await knex('mannschaften').insert({
            turnier_id: turnierId, verein: 'JC Gast', bezeichnung: 'Team 1'
        }).returning('id'))[0]);
        const aendere = async (userId, bezeichnung) => {
            const res = fakeRes();
            await updateMannschaft(knex, { user: { id: userId }, params: { id: String(mannschaftId) }, body: { bezeichnung } }, res);
            return res;
        };
        const helferMannschaft = await aendere('g-helfer', 'Helfer-Team');
        assert.equal(helferMannschaft.statusCode, 403);
        assert.equal((await knex('mannschaften').where({ id: mannschaftId }).first()).bezeichnung, 'Team 1');
        for (const u of ['g-admin', 'g-benutzer']) {
            const r = await aendere(u, `Team ${u}`);
            assert.notEqual(r.statusCode, 403, `${u}: ${JSON.stringify(r.body)}`);
            assert.equal((await knex('mannschaften').where({ id: mannschaftId }).first()).bezeichnung, `Team ${u}`);
        }

        // Super-Admin (Super-Admin-Modus) kann kein Turnier ohne gewählten ausrichtenden Verein anlegen
        const anzahlVorher = (await knex('turniere')).length;
        const res = fakeRes();
        await createTurnier(knex, { user: { id: 'g-super' }, app: { get: () => null }, body: {
            bezeichnung: 'Ohne Verein', ort: 'Halle', datum: '2099-12-02', ausrichter: 'X'
        } }, res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Bitte den ausrichtenden Verein aus der Liste wählen.');
        assert.equal((await knex('turniere')).length, anzahlVorher);
    } finally {
        await db.stoppe();
    }
});
