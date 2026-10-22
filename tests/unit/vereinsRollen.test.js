import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Vereinsverwaltung mit Rollen (Helferverwaltung, Spec Abschnitte 2–4): Freigabe mit Rollenwahl,
// Rollenwechsel, Empfänger der Beitrittsanfrage und Schutz des letzten Admins.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const {
    entscheideAnfrage, aendereRolle, entferneMitglied, ladeEmpfaengerFuerAnfrage, istLetzterAdmin
} = await import('../../src/services/vereinsRollen.js');
const {
    leaveVerein, approveMember, getMitglieder, benachrichtigeUeberBeitrittsanfrage, removeMember
} = await import('../../src/controllers/vereinController.js');
const { ensureSuperAdmin, SUPER_ADMIN_EMAIL } = await import('../../src/utils/superAdmin.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

async function legeBenutzerAn(knex, namen) {
    for (const n of namen) {
        await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test' });
    }
}

test('Vereinsrollen: Freigabe, Empfänger, letzter Admin, Austritt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const verein = id((await knex('vereine').insert({ name: 'JC Rollen' }).returning('id'))[0]);
        await legeBenutzerAn(knex, ['admin', 'helfer', 'neu1', 'neu2', 'neu3', 'super1', 'super2']);
        await knex('benutzer').whereIn('id', ['u-super1', 'u-super2']).update({ ist_super_admin: true, super_admin_modus: true });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-admin', verein_id: verein, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-helfer', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-neu1', verein_id: verein, freigegeben: 0 },
            { benutzer_id: 'u-neu2', verein_id: verein, freigegeben: 0 },
            { benutzer_id: 'u-neu3', verein_id: verein, freigegeben: 0 }
        ]);
        const mitglied = (b) => knex('benutzer_vereine').where({ benutzer_id: b, verein_id: verein }).first();

        // (a) Helfer darf nicht freigeben, Admin darf
        const helferVersuch = await entscheideAnfrage(knex, {
            vereinId: verein, benutzerId: 'u-neu1', entscheiderId: 'u-helfer', entscheidung: 'freigeben', rolle: 'benutzer'
        });
        assert.deepEqual([helferVersuch.ok, helferVersuch.status], [false, 403]);
        assert.equal((await mitglied('u-neu1')).freigegeben, 0);

        // (b) ohne gültige Rolle → 400, mit 'helfer' setzt Rolle und Entscheider
        for (const rolle of [undefined, '', 'chef']) {
            const r = await entscheideAnfrage(knex, {
                vereinId: verein, benutzerId: 'u-neu1', entscheiderId: 'u-admin', entscheidung: 'freigeben', rolle
            });
            assert.deepEqual([r.ok, r.status], [false, 400], `Rolle ${rolle}`);
        }
        const freigabe = await entscheideAnfrage(knex, {
            vereinId: verein, benutzerId: 'u-neu1', entscheiderId: 'u-admin', entscheidung: 'freigeben', rolle: 'helfer'
        });
        assert.deepEqual(freigabe, { ok: true });
        const neu1 = await mitglied('u-neu1');
        assert.equal(neu1.freigegeben, 1);
        assert.equal(neu1.rolle, 'helfer');
        assert.equal(neu1.entschieden_von, 'u-admin');
        assert.ok(neu1.entschieden_am);
        // bereits freigegeben → 409
        const doppelt = await entscheideAnfrage(knex, {
            vereinId: verein, benutzerId: 'u-neu1', entscheiderId: 'u-admin', entscheidung: 'freigeben', rolle: 'admin'
        });
        assert.deepEqual([doppelt.ok, doppelt.status], [false, 409]);
        // Super-Admin ohne Mitgliedschaft darf entscheiden; Ablehnen löscht die Mitgliedschaft
        await knex('benutzer').where({ id: 'u-neu2' }).update({ aktiver_verein_id: verein });
        const ablehnen = await entscheideAnfrage(knex, {
            vereinId: verein, benutzerId: 'u-neu2', entscheiderId: 'u-super1', entscheidung: 'ablehnen'
        });
        assert.deepEqual(ablehnen, { ok: true });
        assert.equal(await mitglied('u-neu2'), undefined);
        assert.equal((await knex('benutzer').where({ id: 'u-neu2' }).first()).aktiver_verein_id, null);

        // Route /approve: ohne rolle → 400, mit rolle → ok
        const ohneRolle = fakeRes();
        await approveMember(knex, { user: { id: 'u-admin' }, body: { userId: 'u-neu3', vereinId: verein } }, ohneRolle);
        assert.equal(ohneRolle.statusCode, 400);
        const mitRolle = fakeRes();
        await approveMember(knex, { user: { id: 'u-admin' }, body: { userId: 'u-neu3', vereinId: verein, rolle: 'benutzer' } }, mitRolle);
        assert.equal(mitRolle.statusCode, 200, JSON.stringify(mitRolle.body));
        assert.equal((await mitglied('u-neu3')).rolle, 'benutzer');

        // Mitgliederliste: nur Admin/Super-Admin
        const liste = fakeRes();
        await getMitglieder(knex, { user: { id: 'u-admin' }, query: { vereinId: String(verein) } }, liste);
        assert.equal(liste.statusCode, 200);
        assert.deepEqual(liste.body.map(m => [m.email, m.rolle, m.status]).sort(), [
            ['admin@test.de', 'admin', 'freigegeben'],
            ['helfer@test.de', 'helfer', 'freigegeben'],
            ['neu1@test.de', 'helfer', 'freigegeben'],
            ['neu3@test.de', 'benutzer', 'freigegeben']
        ]);
        const listeHelfer = fakeRes();
        await getMitglieder(knex, { user: { id: 'u-helfer' }, query: { vereinId: String(verein) } }, listeHelfer);
        assert.equal(listeHelfer.statusCode, 403);

        // (c) Empfänger: Vereins-Admins, ohne Admin alle Super-Admins
        assert.deepEqual(await ladeEmpfaengerFuerAnfrage(knex, verein), ['admin@test.de']);
        const ohneAdmin = id((await knex('vereine').insert({ name: 'JC Ohne Admin' }).returning('id'))[0]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-helfer', verein_id: ohneAdmin, freigegeben: 1, rolle: 'benutzer' });
        assert.deepEqual((await ladeEmpfaengerFuerAnfrage(knex, ohneAdmin)).sort(), ['super1@test.de', 'super2@test.de']);

        // (d) einziger Admin: weder herabstufen noch entfernen
        assert.equal(await istLetzterAdmin(knex, verein, 'u-admin'), true);
        assert.equal(await istLetzterAdmin(knex, verein, 'u-helfer'), false);
        const herab = await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-admin', neueRolle: 'benutzer', durchId: 'u-admin' });
        assert.deepEqual([herab.ok, herab.status], [false, 409]);
        const entfernen = await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-admin', durchId: 'u-admin' });
        assert.deepEqual([entfernen.ok, entfernen.status], [false, 409]);
        const austritt = fakeRes();
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-admin', verein_id: ohneAdmin, freigegeben: 0 });
        await leaveVerein(knex, { user: { id: 'u-admin' }, body: { vereinId: verein } }, austritt);
        assert.equal(austritt.statusCode, 409);
        assert.equal((await mitglied('u-admin')).rolle, 'admin');
        // Helfer darf keine Rollen ändern; ungültige Rolle → 400
        const helferAendert = await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-neu1', neueRolle: 'admin', durchId: 'u-helfer' });
        assert.deepEqual([helferAendert.ok, helferAendert.status], [false, 403]);
        const ungueltig = await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-neu1', neueRolle: 'chef', durchId: 'u-admin' });
        assert.deepEqual([ungueltig.ok, ungueltig.status], [false, 400]);
        // Super-Admin darf den letzten Admin herabstufen (und wieder hochstufen)
        assert.deepEqual(await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-admin', neueRolle: 'benutzer', durchId: 'u-super1' }), { ok: true });
        assert.equal((await mitglied('u-admin')).rolle, 'benutzer');
        assert.deepEqual(await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-admin', neueRolle: 'admin', durchId: 'u-super1' }), { ok: true });
        // mit zweitem Admin geht es
        assert.deepEqual(await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-neu1', neueRolle: 'admin', durchId: 'u-admin' }), { ok: true });
        assert.equal(await istLetzterAdmin(knex, verein, 'u-admin'), false);
        assert.deepEqual(await aendereRolle(knex, { vereinId: verein, benutzerId: 'u-admin', neueRolle: 'benutzer', durchId: 'u-admin' }), { ok: true });
        // neu1 ist jetzt einziger Admin; Entfernen durch Super-Admin geht trotzdem
        const superEntfernt = await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-neu1', durchId: 'u-super2' });
        assert.equal(superEntfernt.ok, true);
        assert.equal(await mitglied('u-neu1'), undefined);
        // Ein Benutzer darf kein anderes Mitglied entfernen, ein Admin schon
        await knex('benutzer_vereine').where({ benutzer_id: 'u-admin', verein_id: verein }).update({ rolle: 'admin' });
        const benutzerEntfernt = await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-helfer', durchId: 'u-neu3' });
        assert.deepEqual([benutzerEntfernt.ok, benutzerEntfernt.status], [false, 403]);
        assert.equal((await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-helfer', durchId: 'u-admin' })).ok, true);
        assert.equal(await mitglied('u-helfer'), undefined);

        // (e) leaveVerein: letztes Vereinsmitglied löscht den Verein wie bisher
        const solo = id((await knex('vereine').insert({ name: 'JC Solo' }).returning('id'))[0]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-neu3', verein_id: solo, freigegeben: 1, rolle: 'admin' });
        await knex('benutzer').where({ id: 'u-neu3' }).update({ aktiver_verein_id: solo });
        const soloRes = fakeRes();
        await leaveVerein(knex, { user: { id: 'u-neu3' }, body: { vereinId: solo } }, soloRes);
        assert.equal(soloRes.statusCode, 200, JSON.stringify(soloRes.body));
        assert.deepEqual(soloRes.body, { success: true, verein_geloescht: true });
        assert.equal(await knex('vereine').where({ id: solo }).first(), undefined);
        assert.equal((await knex('benutzer').where({ id: 'u-neu3' }).first()).aktiver_verein_id, verein);
        // einziger Verein kann weiterhin nicht verlassen werden
        const einziger = fakeRes();
        await leaveVerein(knex, { user: { id: 'u-neu3' }, body: { vereinId: verein } }, einziger);
        assert.equal(einziger.statusCode, 409);

        // Selbstentfernung über den Service/die Route: einziger Verein → 409 (Invariante wie leaveVerein)
        const nurEiner = await entferneMitglied(knex, { vereinId: verein, benutzerId: 'u-neu3', durchId: 'u-neu3' });
        assert.deepEqual([nurEiner.ok, nurEiner.status], [false, 409]);
        assert.match(nurEiner.error, /einzigen Verein/);
        assert.ok(await mitglied('u-neu3'));
        // aus einem von zwei Vereinen → ok, aktiver Verein springt auf den verbleibenden
        const zweiter = id((await knex('vereine').insert({ name: 'JC Zweit' }).returning('id'))[0]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-neu3', verein_id: zweiter, freigegeben: 1, rolle: 'helfer' });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-admin', verein_id: zweiter, freigegeben: 1, rolle: 'admin' });
        await knex('benutzer').where({ id: 'u-neu3' }).update({ aktiver_verein_id: zweiter });
        const routeRes = fakeRes();
        await removeMember(knex, { user: { id: 'u-neu3' }, body: { userId: 'u-neu3', vereinId: zweiter } }, routeRes);
        assert.equal(routeRes.statusCode, 200, JSON.stringify(routeRes.body));
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: 'u-neu3', verein_id: zweiter }).first(), undefined);
        assert.equal((await knex('benutzer').where({ id: 'u-neu3' }).first()).aktiver_verein_id, verein);

        // entscheideAnfrage ohne entscheiderId nur mit ausdrücklichem perToken
        await legeBenutzerAn(knex, ['token1']);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-token1', verein_id: verein, freigegeben: 0 });
        for (const entscheiderId of [null, undefined]) {
            const r = await entscheideAnfrage(knex, {
                vereinId: verein, benutzerId: 'u-token1', entscheiderId, entscheidung: 'freigeben', rolle: 'helfer'
            });
            assert.deepEqual([r.ok, r.status], [false, 403], `entscheiderId ${entscheiderId}`);
        }
        assert.deepEqual(await entscheideAnfrage(knex, {
            vereinId: verein, benutzerId: 'u-token1', entscheiderId: null, perToken: true, entscheidung: 'freigeben', rolle: 'helfer'
        }), { ok: true });
        const token1 = await mitglied('u-token1');
        assert.deepEqual([token1.freigegeben, token1.rolle, token1.entschieden_von], [1, 'helfer', null]);

        // Benachrichtigung geht an ladeEmpfaengerFuerAnfrage (Admins bzw. Super-Admins)
        const gesendet = [];
        const sende = async (mail) => { gesendet.push(mail); };
        const antragsteller = { vorname: 'Neu', nachname: 'Ling', email: 'neu@test.de' };
        await benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, verein, 'JC Rollen', sende);
        await benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, ohneAdmin, 'JC Ohne Admin', sende);
        assert.deepEqual(gesendet[0].to, ['admin@test.de']);
        assert.deepEqual([...gesendet[1].to].sort(), ['super1@test.de', 'super2@test.de']);

        // ensureSuperAdmin: Mitgliedschaft im Verein "Administration" freigegeben mit Rolle admin, auch nachträglich
        await ensureSuperAdmin(knex);
        const sa = await knex('benutzer').where({ email: SUPER_ADMIN_EMAIL }).first();
        const saMitglied = () => knex('benutzer_vereine').where({ benutzer_id: sa.id }).first();
        assert.deepEqual([(await saMitglied()).freigegeben, (await saMitglied()).rolle], [1, 'admin']);
        await knex('benutzer_vereine').where({ benutzer_id: sa.id }).update({ freigegeben: 0, rolle: null });
        await ensureSuperAdmin(knex);
        assert.deepEqual([(await saMitglied()).freigegeben, (await saMitglied()).rolle], [1, 'admin']);
    } finally {
        await db.stoppe();
    }
});
