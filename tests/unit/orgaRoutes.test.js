import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Orga-Planer-API mit echtem JWT gegen ein eingebettetes PostgreSQL, Betriebsmodus cloud (Rechteprüfung aktiv).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'orga-routes-test-geheimnis';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { getOrgaRoutes } = await import('../../src/routes/orgaRoutes.js');
const { getOrgaHelferRoutes } = await import('../../src/routes/orgaHelferRoutes.js');
const { getEinladungRoutes } = await import('../../src/routes/einladungRoutes.js');
const { erzeugeEinladung } = await import('../../src/services/orgaEinladung.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const alle = (o) => o.phasen.flatMap((p) => p.aufgaben);

test('Orga-API: Rechte, Turnierbindung der Aufgaben-IDs, Helfer-Routen, Mitbringliste, Einladung', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    const app = express();
    app.use(express.json());
    app.use('/api/orga', getOrgaRoutes(knex, { sende: async (m) => { mails.push(m); } }));
    app.use('/api/helfer/orga', getOrgaHelferRoutes(knex));
    app.use('/api/einladung', getEinladungRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, methode, pfad, body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: {
                'Content-Type': 'application/json',
                ...(benutzerId ? { Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` } : {})
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    const get = (u, p) => aufruf(u, 'GET', p);
    const post = (u, p, b = {}) => aufruf(u, 'POST', p, b);
    const put = (u, p, b = {}) => aufruf(u, 'PUT', p, b);
    const del = (u, p) => aufruf(u, 'DELETE', p);

    try {
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        for (const n of ['helfer', 'helfer2', 'benutzer', 'fremd']) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test', email_bestaetigt_am: knex.fn.now() });
        }
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-helfer', verein_id: vA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-helfer2', verein_id: vA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-benutzer', verein_id: vA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-fremd', verein_id: vB, freigegeben: 1, rolle: 'admin' }
        ]);
        await knex('benutzer').whereIn('id', ['u-helfer', 'u-helfer2', 'u-benutzer']).update({ aktiver_verein_id: vA });
        await knex('benutzer').where({ id: 'u-fremd' }).update({ aktiver_verein_id: vB });
        const turnier = async (verein, name) => id((await knex('turniere').insert({
            bezeichnung: name, ort: 'Halle', datum: '2033-05-04', anmeldeschluss: '2033-04-20', ausrichter: 'JC', verein_id: verein, status: 'veroeffentlicht'
        }).returning('id'))[0]);
        const tA = await turnier(vA, 'Pokal A');
        const tB = await turnier(vB, 'Pokal B');

        // ohne Anmeldung / ohne Rolle benutzer
        assert.equal((await get(null, `/api/orga?turnierId=${tA}`)).status, 401);
        assert.equal((await get('u-helfer', `/api/orga?turnierId=${tA}`)).status, 403);
        assert.equal((await post('u-helfer', '/api/orga/aufgaben', { turnierId: tA, titel: 'x', phase: 'turniertag' })).status, 403);
        assert.equal((await get('u-fremd', `/api/orga?turnierId=${tA}`)).status, 403);

        // Vorlage wird beim ersten Laden einmal angelegt
        assert.equal(await knex('orga_aufgaben').where({ turnier_id: tA }).first() ?? null, null);
        const erst = await get('u-benutzer', `/api/orga?turnierId=${tA}`);
        assert.equal(erst.status, 200);
        const anzahl = (await knex('orga_aufgaben').where({ turnier_id: tA }).count('* as n').first()).n;
        await get('u-benutzer', `/api/orga?turnierId=${tA}`);
        assert.equal((await knex('orga_aufgaben').where({ turnier_id: tA }).count('* as n').first()).n, anzahl);
        assert.equal(erst.daten.turnier.bezeichnung, 'Pokal A');
        const wiegen = alle(erst.daten).find((a) => a.vorlage_key === 'wiegen');
        const catering = alle(erst.daten).find((a) => a.vorlage_key === 'catering');
        assert.equal(catering.mitbringliste, true);

        // Aufgabe von Turnier B über id: Orga von A bekommt 403, Fremd-Admin darf, unbekannte id 404
        await get('u-fremd', `/api/orga?turnierId=${tB}`);
        const aufgB = await knex('orga_aufgaben').where({ turnier_id: tB, vorlage_key: 'wiegen' }).first();
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${aufgB.id}/erledigt`, { erledigt: true })).status, 403);
        assert.equal((await put('u-benutzer', `/api/orga/aufgaben/${aufgB.id}`, { titel: 'Hack', turnierId: tA })).status, 403);
        assert.equal((await del('u-benutzer', `/api/orga/aufgaben/${aufgB.id}`)).status, 403);
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${aufgB.id}/zuweisen`, { frei: false })).status, 403);
        assert.equal((await post('u-helfer', `/api/orga/aufgaben/${wiegen.id}/erledigt`, { erledigt: true })).status, 403);
        assert.equal((await put('u-benutzer', '/api/orga/aufgaben/999999', { titel: 'x' })).status, 404);
        assert.equal((await knex('orga_aufgaben').where({ id: aufgB.id }).first()).titel, 'Wiegen');
        // eltern_id aus fremdem Turnier
        assert.equal((await post('u-benutzer', '/api/orga/aufgaben', { turnierId: tA, titel: 'P', eltern_id: aufgB.id })).status, 404);

        // Orga: anlegen, ändern, abhaken, löschen
        const neu = await post('u-benutzer', '/api/orga/aufgaben', { turnierId: tA, titel: 'Eigene', phase: 'turniertag', faellig_am: '2033-05-03' });
        assert.equal(neu.status, 201);
        assert.equal((await put('u-benutzer', `/api/orga/aufgaben/${neu.daten.id}`, { titel: 'Eigene 2' })).status, 200);
        assert.equal((await put('u-benutzer', `/api/orga/aufgaben/${neu.daten.id}`, { benutzer_id: 'u-fremd' })).status, 400);
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${neu.daten.id}/erledigt`, { erledigt: 'ja' })).status, 400);
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${neu.daten.id}/erledigt`, { erledigt: true })).status, 200);
        assert.equal((await del('u-benutzer', `/api/orga/aufgaben/${neu.daten.id}`)).status, 200);

        // Mitglieder, Nachladen
        const mitglieder = await get('u-benutzer', `/api/orga/mitglieder?turnierId=${tA}`);
        assert.deepEqual(mitglieder.daten.map((m) => m.id).sort(), ['u-benutzer', 'u-helfer', 'u-helfer2']);
        assert.deepEqual(Object.keys(mitglieder.daten[0]).sort(), ['email', 'id', 'nachname', 'vorname']);
        assert.equal((await get('u-helfer', `/api/orga/mitglieder?turnierId=${tA}`)).status, 403);
        const nachladen = await post('u-benutzer', '/api/orga/vorlage-nachladen', { turnierId: tA });
        assert.deepEqual([nachladen.status, nachladen.daten.angelegt], [200, 0]);

        // Zuweisen: Konto (Mail), Nichtmitglied 400
        const z = await post('u-benutzer', `/api/orga/aufgaben/${wiegen.id}/zuweisen`, { benutzerId: 'u-helfer' });
        assert.deepEqual([z.status, z.daten.modus], [200, 'konto']);
        assert.equal(mails.length, 1);
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${wiegen.id}/zuweisen`, { benutzerId: 'u-fremd' })).status, 400);
        const ez = await post('u-benutzer', `/api/orga/aufgaben/${catering.id}/zuweisen`, { name: 'Gast', email: 'gast@extern.de' });
        assert.deepEqual([ez.status, ez.daten.modus], [200, 'einladung']);
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${catering.id}/einladung-erneut`)).daten.modus, 'einladung');
        assert.equal((await post('u-benutzer', `/api/orga/aufgaben/${wiegen.id}/einladung-erneut`)).status, 400);

        // Helfer-App: meine Aufgaben, abhaken nur eigene
        const meine = await get('u-helfer', '/api/helfer/orga/meine');
        assert.equal(meine.status, 200);
        assert.deepEqual(meine.daten.aufgaben.map((a) => a.id), [wiegen.id]);
        assert.equal(meine.daten.aufgaben[0].turnier, 'Pokal A');
        assert.equal(meine.daten.aufgaben[0].faellig_am, '2033-05-04');
        assert.equal(meine.daten.aufgaben[0].status.status, 'offen');
        assert.equal((await post('u-helfer2', `/api/helfer/orga/aufgaben/${wiegen.id}/erledigt`, { erledigt: true })).status, 403);
        assert.equal((await post('u-helfer', `/api/helfer/orga/aufgaben/${wiegen.id}/erledigt`, { erledigt: true })).status, 200);
        assert.equal((await get('u-helfer', '/api/helfer/orga/meine')).daten.aufgaben[0].status.status, 'erledigt');
        assert.equal((await post('u-helfer', '/api/helfer/orga/aufgaben/999999/erledigt', { erledigt: true })).status, 404);
        assert.equal((await get(null, '/api/helfer/orga/meine')).status, 401);

        // Mitbringliste
        const mb = await post('u-helfer', '/api/helfer/orga/mitbringliste', { turnierId: tA, titel: 'Kuchen', menge: 2 });
        assert.equal(mb.status, 201);
        const eintrag = await knex('orga_aufgaben').where({ id: mb.daten.id }).first();
        assert.deepEqual([eintrag.art, eintrag.eltern_id, eintrag.erstellt_von, eintrag.name_frei], ['mitbringen', catering.id, 'u-helfer', 'helfer Test']);
        assert.equal((await post('u-fremd', '/api/helfer/orga/mitbringliste', { turnierId: tA, titel: 'x' })).status, 403);
        assert.equal((await put('u-helfer2', `/api/helfer/orga/mitbringliste/${mb.daten.id}`, { titel: 'Hack' })).status, 403);
        assert.equal((await put('u-helfer', `/api/helfer/orga/mitbringliste/${mb.daten.id}`, { titel: 'Torte' })).status, 200);
        assert.equal((await knex('orga_aufgaben').where({ id: mb.daten.id }).first()).titel, 'Torte');
        assert.equal((await del('u-helfer2', `/api/helfer/orga/mitbringliste/${mb.daten.id}`)).status, 403);
        assert.equal((await del('u-helfer', `/api/helfer/orga/mitbringliste/${mb.daten.id}`)).status, 200);
        const mb2 = await post('u-helfer', '/api/helfer/orga/mitbringliste', { turnierId: tA, titel: 'Salat' });
        assert.equal((await del('u-benutzer', `/api/helfer/orga/mitbringliste/${mb2.daten.id}`)).status, 200, 'Orga löscht jeden');
        // kein Mitbringeintrag über diese Route erreichbar
        assert.equal((await del('u-helfer', `/api/helfer/orga/mitbringliste/${wiegen.id}`)).status, 404);

        // Einladung öffentlich: nur E-Mail, Name, Verein
        const token = await erzeugeEinladung(knex, { email: 'neu@extern.de', name: 'Neu', vereinId: vA });
        const info = await get(null, `/api/einladung/${token}`);
        assert.equal(info.status, 200);
        assert.deepEqual(Object.keys(info.daten).sort(), ['email', 'kontoVorhanden', 'name', 'success', 'vereinName']);
        assert.equal(info.daten.vereinName, 'JC A');
        assert.equal((await get(null, '/api/einladung/falsch')).status, 404);
        assert.equal((await post(null, `/api/einladung/${token}`, { password: 'kurz', vorname: 'N', nachname: 'E' })).status, 400);
        const ein = await post(null, `/api/einladung/${token}`, { password: 'langes-passwort', vorname: 'Neu', nachname: 'Gast' });
        assert.equal(ein.status, 200, JSON.stringify(ein.daten));
        assert.ok(ein.daten.token);
        assert.equal(ein.daten.user.email, 'neu@extern.de');
        assert.equal((await get(null, `/api/einladung/${token}`)).status, 404, 'Token verbraucht');
        assert.equal((await get(ein.daten.user.id, '/api/helfer/orga/meine')).status, 200);
    } finally {
        server.close();
        await db.stoppe();
    }
});
