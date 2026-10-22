import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin-Verwaltung (Helferverwaltung, Spec 3.1): Liste aller Konten und Umschalter Super-Admin, nur für
// Super-Admins; der letzte Super-Admin kann sich nicht entziehen.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'nutzer-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getNutzerRoutes } = await import('../../src/routes/nutzerRoutes.js');
const { listeNutzer, setzeSuperAdmin } = await import('../../src/controllers/nutzerController.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

function fakeRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

test('Nutzer-Verwaltung: nur Super-Admins, ernennen, letzter Super-Admin bleibt', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.use(express.json());
    app.use('/api/nutzer', getNutzerRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}/api/nutzer`;
    const aufruf = (benutzerId, pfad = '', optionen = {}) => fetch(basis + pfad, {
        ...optionen,
        headers: {
            'Content-Type': 'application/json',
            ...(benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {})
        }
    });
    try {
        const verein = id((await knex('vereine').insert({ name: 'JC Nutzer' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'Uper', ist_super_admin: true, super_admin_modus: true, password_hash: 'geheim' },
            { id: 'u-admin', email: 'admin@test.de', vorname: 'A', nachname: 'Dmin', password_hash: 'geheim' }
        ]);
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-admin', verein_id: verein, freigegeben: 1, rolle: 'admin' });

        // --- Routen: ohne Anmeldung 401, Nicht-Super-Admin (auch Vereins-Admin) 403
        assert.equal((await aufruf(null)).status, 401);
        assert.equal((await aufruf('u-admin')).status, 403);
        const ernennenOhneRecht = await aufruf('u-admin', '/u-admin/super-admin', { method: 'POST', body: JSON.stringify({ wert: true }) });
        assert.equal(ernennenOhneRecht.status, 403);
        assert.equal((await knex('benutzer').where({ id: 'u-admin' }).first()).ist_super_admin, false);

        // --- Liste: alle Konten mit Mitgliedschaften, ohne Passwort-Hash
        const liste = await aufruf('u-super');
        assert.equal(liste.status, 200);
        const konten = await liste.json();
        const admin = konten.find(k => k.id === 'u-admin');
        assert.deepEqual(
            { vorname: admin.vorname, nachname: admin.nachname, email: admin.email, ist_super_admin: admin.ist_super_admin },
            { vorname: 'A', nachname: 'Dmin', email: 'admin@test.de', ist_super_admin: false });
        assert.deepEqual(admin.mitgliedschaften, [{ verein_id: verein, verein_name: 'JC Nutzer', rolle: 'admin', freigegeben: true }]);
        assert.equal(konten.find(k => k.id === 'u-super').ist_super_admin, true);
        assert.ok(konten.every(k => !('password_hash' in k)));

        // --- letzter Super-Admin kann sich nicht entziehen → 409
        const selbst = await aufruf('u-super', '/u-super/super-admin', { method: 'POST', body: JSON.stringify({ wert: false }) });
        assert.equal(selbst.status, 409);
        assert.equal((await knex('benutzer').where({ id: 'u-super' }).first()).ist_super_admin, true);

        // --- Validierung: wert muss boolean sein, Konto muss existieren
        const resWert = fakeRes();
        await setzeSuperAdmin(knex, { user: { id: 'u-super' }, params: { id: 'u-admin' }, body: { wert: 'ja' } }, resWert);
        assert.equal(resWert.statusCode, 400);
        const resUnbekannt = fakeRes();
        await setzeSuperAdmin(knex, { user: { id: 'u-super' }, params: { id: 'u-gibtsnicht' }, body: { wert: true } }, resUnbekannt);
        assert.equal(resUnbekannt.statusCode, 404);

        // --- Super-Admin ernennt weiteren Super-Admin; danach darf der erste abgeben
        const ernennen = await aufruf('u-super', '/u-admin/super-admin', { method: 'POST', body: JSON.stringify({ wert: true }) });
        assert.equal(ernennen.status, 200);
        assert.equal((await knex('benutzer').where({ id: 'u-admin' }).first()).ist_super_admin, true);
        const abgeben = await aufruf('u-super', '/u-super/super-admin', { method: 'POST', body: JSON.stringify({ wert: false }) });
        assert.equal(abgeben.status, 200);
        assert.equal((await knex('benutzer').where({ id: 'u-super' }).first()).ist_super_admin, false);

        // --- jetzt ist u-admin der letzte: weder selbst noch über die Liste entziehbar
        const resLetzter = fakeRes();
        await setzeSuperAdmin(knex, { user: { id: 'u-admin' }, params: { id: 'u-admin' }, body: { wert: false } }, resLetzter);
        assert.equal(resLetzter.statusCode, 409);

        const resListe = fakeRes();
        await listeNutzer(knex, { user: { id: 'u-admin' } }, resListe);
        assert.equal(resListe.statusCode, 200);
        assert.equal(resListe.body.find(k => k.id === 'u-super').ist_super_admin, false);

        // --- Vereinsübersicht: Bundesland, Benutzer- und Turnieranzahl, Turniere je Verein (nur Super-Admin)
        const verein2 = id((await knex('vereine').insert({ name: 'SV Zweiter', bundesland: 'Bayern' }).returning('id'))[0]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-super', verein_id: verein2, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-admin', verein_id: verein2, freigegeben: 0, rolle: null }
        ]);
        await knex('turniere').insert([
            { bezeichnung: 'Alt', ort: 'A', datum: '2030-01-10', ausrichter: 'X', verein_id: verein2, bundesland: 'Bayern', status: 'abgeschlossen' },
            { bezeichnung: 'Neu', ort: 'B', datum: '2031-05-20', ausrichter: 'X', verein_id: verein2, bundesland: 'Bayern', status: 'veroeffentlicht' },
            { bezeichnung: 'Mitte', ort: 'C', datum: '2030-09-01', ausrichter: 'X', verein_id: verein2, status: 'entwurf' }
        ]);
        assert.equal((await aufruf(null, '/vereine')).status, 401);
        assert.equal((await aufruf('u-super', '/vereine')).status, 403); // u-super hat die Rolle abgegeben
        assert.equal((await aufruf('u-super', `/vereine/${verein2}/turniere`)).status, 403);
        // u-admin ist inzwischen der einzige Super-Admin (siehe oben)
        const vereine = await (await aufruf('u-admin', '/vereine')).json();
        const v1 = vereine.find(v => v.name === 'JC Nutzer');
        const v2 = vereine.find(v => v.name === 'SV Zweiter');
        assert.deepEqual([v1.benutzer_anzahl, v1.turniere_anzahl, v1.bundesland], [1, 0, null]);
        assert.deepEqual([v2.benutzer_anzahl, v2.turniere_anzahl, v2.bundesland], [2, 3, 'Bayern']); // wartende Mitgliedschaft zählt mit
        assert.deepEqual(vereine.map(v => v.name), [...vereine.map(v => v.name)].sort((a, b) => a.localeCompare(b)));

        const turniere = await (await aufruf('u-admin', `/vereine/${verein2}/turniere`)).json();
        assert.equal(turniere.verein.name, 'SV Zweiter');
        assert.deepEqual(turniere.turniere.map(t => t.bezeichnung), ['Neu', 'Mitte', 'Alt']); // Wettkampftag absteigend
        assert.deepEqual(turniere.turniere.map(t => t.datum), ['2031-05-20', '2030-09-01', '2030-01-10']);
        assert.equal(turniere.turniere[0].teilnehmer_anzahl, 0);
        assert.equal((await aufruf('u-admin', '/vereine/99999999999/turniere')).status, 404);

        const setzen = (wert) => aufruf('u-admin', `/vereine/${verein2}`, { method: 'PUT', body: JSON.stringify({ bundesland: wert }) });
        assert.equal((await setzen('Hessen')).status, 200);
        assert.equal((await knex('vereine').where({ id: verein2 }).first()).bundesland, 'Hessen');
        assert.equal((await setzen('Atlantis')).status, 400);
        assert.equal((await setzen(5)).status, 400);
        assert.equal((await setzen('')).status, 200);
        assert.equal((await knex('vereine').where({ id: verein2 }).first()).bundesland, null);
        assert.equal((await aufruf('u-super', `/vereine/${verein2}`, { method: 'PUT', body: JSON.stringify({ bundesland: 'Bayern' }) })).status, 403);
        assert.equal((await aufruf('u-admin', '/vereine/99999999999', { method: 'PUT', body: JSON.stringify({ bundesland: 'Bayern' }) })).status, 404);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
