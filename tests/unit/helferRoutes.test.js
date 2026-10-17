import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// API der Helferverwaltung (Spec 4.2, 5, 6): Helfer-App unter /api/helfer, Orga-Plan unter /api/helfer-plan,
// echte Router mit echtem JWT gegen ein eingebettetes PostgreSQL. Läuft als Cloud (Rechteprüfung aktiv).
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'helfer-routes-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getHelferRoutes } = await import('../../src/routes/helferRoutes.js');
const { getHelferPlanRoutes } = await import('../../src/routes/helferPlanRoutes.js');
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');
const { stelleSicherDassGehoertZu } = await import('../../src/controllers/helferPlanController.js');
const { hashPassword, verifyPassword } = await import('../../src/utils/password.js');

const id = (r) => (typeof r === 'object' ? r.id : r);

const DATUM = '2030-05-04';
const VOR_FRIST = new Date('2030-05-01T10:00:00Z');
const NACH_FRIST = new Date('2030-05-04T07:00:00Z'); // 09:00 Berlin (MESZ) am Turniertag

async function legeTurnierAn(knex, { vereinId, datum = DATUM, status = 'veroeffentlicht', name }) {
    const turnierId = id((await knex('turniere').insert({
        bezeichnung: name, ort: 'Halle', datum, ausrichter: 'JC', verein_id: vereinId, status,
        beginn_min: 540, ende_min: 1020
    }).returning('id'))[0]);
    await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' });
    return turnierId;
}

test('Helfer-API und Helferplan-API: Rechte, Eintragen, Frist, Fremdturniere, Mails, Profil', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    let uhr = VOR_FRIST;
    const mails = [];
    const sende = async (mail) => { mails.push(mail); };

    const app = express();
    app.use(express.json());
    app.use('/api/helfer', getHelferRoutes(knex, { jetzt: () => uhr, sende }));
    app.use('/api/helfer-plan', getHelferPlanRoutes(knex, { jetzt: () => uhr, sende }));
    app.use('/api/turniere', getTurnierRoutes(knex));
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
    const del = (u, p, b) => aufruf(u, 'DELETE', p, b);

    try {
        const vereinA = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vereinB = id((await knex('vereine').insert({ name: 'JC Fremd' }).returning('id'))[0]);
        const vereinC = id((await knex('vereine').insert({ name: 'JC Dritter' }).returning('id'))[0]);
        for (const n of ['helfer', 'helfer2', 'benutzer', 'super', 'fremd', 'fremdhelfer', 'offen']) {
            await knex('benutzer').insert({
                id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'Test',
                email_bestaetigt_am: knex.fn.now(), password_hash: hashPassword('altes-passwort')
            });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-helfer', verein_id: vereinA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-helfer2', verein_id: vereinA, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-benutzer', verein_id: vereinA, freigegeben: 1, rolle: 'benutzer' },
            { benutzer_id: 'u-fremd', verein_id: vereinB, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-fremdhelfer', verein_id: vereinB, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-offen', verein_id: vereinA, freigegeben: 0, rolle: null }
        ]);
        await knex('benutzer').whereIn('id', ['u-helfer', 'u-helfer2', 'u-benutzer', 'u-offen']).update({ aktiver_verein_id: vereinA });
        await knex('benutzer').whereIn('id', ['u-fremd', 'u-fremdhelfer']).update({ aktiver_verein_id: vereinB });

        const tA = await legeTurnierAn(knex, { vereinId: vereinA, name: 'Pokal A' });
        const tEntwurf = await legeTurnierAn(knex, { vereinId: vereinA, status: 'entwurf', name: 'Entwurf A' });
        const tVergangen = await legeTurnierAn(knex, { vereinId: vereinA, datum: '2020-01-01', name: 'Alt A' });
        const tB = await legeTurnierAn(knex, { vereinId: vereinB, name: 'Pokal B' });

        // --- ohne Anmeldung 401
        assert.equal((await get(null, '/api/helfer/turniere')).status, 401);
        assert.equal((await get(null, `/api/helfer-plan/${tA}`)).status, 401);

        // --- Orga (Benutzer) öffnet den Plan: Standard-Tätigkeiten entstehen
        const planRes = await get('u-benutzer', `/api/helfer-plan/${tA}`);
        assert.equal(planRes.status, 200, JSON.stringify(planRes.daten));
        assert.deepEqual(planRes.daten.taetigkeiten.map(t => t.bezeichnung), ['Kampfgericht Matte 1', 'Waage 1']);
        const matte = planRes.daten.taetigkeiten[0];
        const slot1 = matte.slots[0].id; // 09:00–11:00
        const slot2 = matte.slots[1].id; // 11:00–13:00
        assert.equal((await get('u-fremd', `/api/helfer-plan/${tB}`)).status, 200);
        const taetigkeitB = (await knex('helfer_taetigkeiten').where({ turnier_id: tB }).first()).id;
        const slotB = (await knex('helfer_slots').where({ taetigkeit_id: taetigkeitB }).orderBy('von_min').first()).id;

        // --- Helfer: Turnierliste nur eigener Vereine, nur veröffentlicht und ab heute
        const listeHelfer = await get('u-helfer', '/api/helfer/turniere');
        assert.equal(listeHelfer.status, 200);
        assert.deepEqual(listeHelfer.daten.map(t => t.id), [tA]);
        assert.equal(listeHelfer.daten[0].bezeichnung, 'Pokal A');
        assert.equal(listeHelfer.daten[0].datum, DATUM);
        assert.equal(listeHelfer.daten[0].offeneDienste, 8, '4 Slots Matte + 4 Slots Waage, alle offen');
        assert.deepEqual((await get('u-fremdhelfer', '/api/helfer/turniere')).daten.map(t => t.id), [tB]);
        assert.deepEqual((await get('u-offen', '/api/helfer/turniere')).daten, []);
        assert.deepEqual((await get('u-super', '/api/helfer/turniere')).daten.map(t => t.id).sort((a, b) => a - b), [tA, tB].sort((a, b) => a - b));

        // --- Dienste: Fremdverein 403, nicht freigegeben 403, Entwurf 404
        assert.equal((await get('u-helfer', `/api/helfer/turniere/${tB}/dienste`)).status, 403);
        assert.equal((await get('u-fremdhelfer', `/api/helfer/turniere/${tA}/dienste`)).status, 403);
        assert.equal((await get('u-offen', `/api/helfer/turniere/${tA}/dienste`)).status, 403);
        assert.equal((await get('u-helfer', `/api/helfer/turniere/${tEntwurf}/dienste`)).status, 404);
        assert.equal((await get('u-helfer', '/api/helfer/turniere/999999/dienste')).status, 404);
        assert.equal((await get('u-super', `/api/helfer/turniere/${tB}/dienste`)).status, 200);

        // --- Eintragen: ok, der zweite Helfer sieht weniger freie Plätze
        const ein = await post('u-helfer', '/api/helfer/einsaetze', { slotId: slot1 });
        assert.equal(ein.status, 201, JSON.stringify(ein.daten));
        const einsatzHelfer = ein.daten.id;
        const dienste2 = await get('u-helfer2', `/api/helfer/turniere/${tA}/dienste`);
        assert.equal(dienste2.status, 200);
        const s1Fuer2 = dienste2.daten.dienste.find(d => d.slotId === slot1);
        assert.equal(s1Fuer2.frei, 1);
        assert.equal(s1Fuer2.eingetragen, false);
        const s1Fuer1 = (await get('u-helfer', `/api/helfer/turniere/${tA}/dienste`)).daten.dienste.find(d => d.slotId === slot1);
        assert.equal(s1Fuer1.eingetragen, true);
        // Ohne Mitgliedschaft im Turnier-Verein kein Eintragen
        assert.equal((await post('u-fremdhelfer', '/api/helfer/einsaetze', { slotId: slot1 })).status, 403);
        assert.equal((await post('u-helfer', '/api/helfer/einsaetze', { slotId: slotB })).status, 403);
        assert.equal((await post('u-helfer', '/api/helfer/einsaetze', {})).status, 400);
        // Überlappung: 409 mit code
        const waageSlot1 = planRes.daten.taetigkeiten[1].slots[0].id;
        const ueber = await post('u-helfer', '/api/helfer/einsaetze', { slotId: waageSlot1 });
        assert.equal(ueber.status, 409);
        assert.equal(ueber.daten.code, 'ueberlappung');

        // --- Benutzer (nicht Helfer) darf sich selbst eintragen; danach ist der Slot voll und verschwindet
        assert.equal((await post('u-benutzer', '/api/helfer/einsaetze', { slotId: slot1 })).status, 201);
        assert.equal((await get('u-helfer2', `/api/helfer/turniere/${tA}/dienste`)).daten.dienste.some(d => d.slotId === slot1), false);
        assert.equal((await post('u-helfer2', '/api/helfer/einsaetze', { slotId: slot1 })).daten.code, 'voll');

        // --- Helfer auf dem Orga-Plan: 403 (lesen und schreiben)
        assert.equal((await get('u-helfer', `/api/helfer-plan/${tA}`)).status, 403);
        assert.equal((await post('u-helfer', `/api/helfer-plan/${tA}/taetigkeiten`, { bezeichnung: 'X', bedarf: 1 })).status, 403);
        assert.equal((await put('u-helfer', `/api/helfer-plan/taetigkeiten/${matte.id}`, { bedarf: 5 })).status, 403);
        assert.equal((await post('u-helfer', `/api/helfer-plan/slots/${slot2}/einsaetze`, { benutzerId: 'u-helfer' })).status, 403);
        assert.equal((await get('u-helfer', `/api/helfer-plan/${tA}/mitglieder`)).status, 403);

        // --- Benutzer pflegt den Plan
        const neu = await post('u-benutzer', `/api/helfer-plan/${tA}/taetigkeiten`, { bezeichnung: 'Waffelstand', bedarf: 3 });
        assert.equal(neu.status, 201, JSON.stringify(neu.daten));
        const waffel = neu.daten.id;
        assert.equal((await put('u-benutzer', `/api/helfer-plan/taetigkeiten/${waffel}`, { bezeichnung: 'Waffeln' })).status, 200);
        const extraSlot = await post('u-benutzer', `/api/helfer-plan/taetigkeiten/${waffel}/slots`, { von_min: 1020, bis_min: 1080 });
        assert.equal(extraSlot.status, 201, JSON.stringify(extraSlot.daten));
        assert.equal((await post('u-benutzer', `/api/helfer-plan/taetigkeiten/${waffel}/slots`, { von_min: 1030, bis_min: 1080 })).status, 400);
        assert.equal((await del('u-benutzer', `/api/helfer-plan/slots/${extraSlot.daten.id}`)).status, 200);
        assert.equal((await put('u-benutzer', `/api/helfer-plan/taetigkeiten/${matte.id}`, { bezeichnung: 'Anders' })).status, 409);
        const mitglieder = await get('u-benutzer', `/api/helfer-plan/${tA}/mitglieder`);
        assert.equal(mitglieder.status, 200);
        assert.deepEqual(mitglieder.daten.map(m => m.id).sort(), ['u-benutzer', 'u-helfer', 'u-helfer2']);
        assert.equal(mitglieder.daten.find(m => m.id === 'u-helfer').name, 'helfer Test');
        assert.ok(mitglieder.daten.every(m => !('email' in m) && !('password_hash' in m)));

        // --- Slot-Zeit ändern: Bestätigung (409 + code/daten), dann Mail an die Eingetragenen
        const ohneBestaetigung = await put('u-benutzer', `/api/helfer-plan/slots/${slot1}`, { von_min: 570, bis_min: 660 });
        assert.equal(ohneBestaetigung.status, 409);
        assert.equal(ohneBestaetigung.daten.code, 'bestaetigung_noetig');
        assert.equal(ohneBestaetigung.daten.daten.anzahl, 2);
        assert.equal(mails.length, 0);
        const mitBestaetigung = await put('u-benutzer', `/api/helfer-plan/slots/${slot1}`, { von_min: 570, bis_min: 660, bestaetigt: true });
        assert.equal(mitBestaetigung.status, 200, JSON.stringify(mitBestaetigung.daten));
        assert.deepEqual(mails.map(m => m.to).sort(), ['benutzer@test.de', 'helfer@test.de']);
        const mailHelfer = mails.find(m => m.to === 'helfer@test.de');
        assert.match(mailHelfer.text, /Dein Dienst „Kampfgericht Matte 1“/);
        assert.match(mailHelfer.text, /ist jetzt von 09:30 bis 11:00 Uhr/);
        assert.match(mailHelfer.text, /04\.05\.2030/);
        // Nur Bedarf geändert: keine Mail
        mails.length = 0;
        assert.equal((await put('u-benutzer', `/api/helfer-plan/slots/${slot1}`, { bedarf: 3 })).status, 200);
        assert.equal(mails.length, 0);
        // Mail-Fehler bricht die Änderung nicht ab
        const appFehler = express();
        appFehler.use(express.json());
        appFehler.use('/api/helfer-plan', getHelferPlanRoutes(knex, { jetzt: () => uhr, sende: async () => { throw new Error('SMTP kaputt'); } }));
        const serverFehler = await new Promise((resolve) => { const s = appFehler.listen(0, '127.0.0.1', () => resolve(s)); });
        try {
            const r = await fetch(`http://127.0.0.1:${serverFehler.address().port}/api/helfer-plan/slots/${slot1}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: 'u-benutzer' }, process.env.JWT_SECRET)}` },
                body: JSON.stringify({ von_min: 540, bis_min: 660 })
            });
            assert.equal(r.status, 200);
        } finally {
            await new Promise((resolve) => serverFehler.close(resolve));
        }

        // --- Meine Dienste: ohne vergangene Turniere
        const altTaetigkeit = id((await knex('helfer_taetigkeiten').insert({ turnier_id: tVergangen, art: 'frei', bezeichnung: 'Alt', bedarf: 1 }).returning('id'))[0]);
        const altSlot = id((await knex('helfer_slots').insert({ taetigkeit_id: altTaetigkeit, von_min: 540, bis_min: 660, bedarf: 1 }).returning('id'))[0]);
        await knex('helfer_einsaetze').insert({ slot_id: altSlot, benutzer_id: 'u-helfer' });
        const meine = await get('u-helfer', '/api/helfer/meine-dienste');
        assert.equal(meine.status, 200);
        assert.deepEqual(meine.daten.map(d => d.einsatzId), [einsatzHelfer]);
        assert.equal(meine.daten[0].turnier.id, tA);
        assert.equal(meine.daten[0].darfAustragen, true);

        // --- Frist: nach Turniertag 08:00 darf der Helfer nicht mehr, die Orga schon
        uhr = NACH_FRIST;
        const austragenSpaet = await del('u-helfer', `/api/helfer/einsaetze/${einsatzHelfer}`);
        assert.equal(austragenSpaet.status, 403);
        assert.equal(austragenSpaet.daten.code, 'frist');
        assert.equal((await post('u-helfer2', '/api/helfer/einsaetze', { slotId: slot2 })).status, 403);
        assert.equal((await get('u-helfer', '/api/helfer/meine-dienste')).daten[0].darfAustragen, false);
        const orgaEin = await post('u-benutzer', `/api/helfer-plan/slots/${slot2}/einsaetze`, { benutzerId: 'u-helfer2' });
        assert.equal(orgaEin.status, 201, JSON.stringify(orgaEin.daten));
        const manuell = await post('u-benutzer', `/api/helfer-plan/slots/${slot2}/einsaetze`, { name: 'Oma Erna' });
        assert.equal(manuell.status, 201);
        assert.equal((await post('u-benutzer', `/api/helfer-plan/slots/${slot2}/einsaetze`, {})).status, 400);
        assert.equal((await del('u-benutzer', `/api/helfer-plan/einsaetze/${orgaEin.daten.id}`)).status, 200);
        // Eigenen Einsatz eines anderen über die Helfer-Route austragen: 403
        uhr = VOR_FRIST;
        assert.equal((await del('u-helfer2', `/api/helfer/einsaetze/${einsatzHelfer}`)).status, 403);
        assert.equal((await del('u-helfer', '/api/helfer/einsaetze/999999')).status, 404);

        // --- Super-Admin darf überall
        assert.equal((await get('u-super', `/api/helfer-plan/${tA}`)).status, 200);
        assert.equal((await put('u-super', `/api/helfer-plan/slots/${slotB}`, { bedarf: 4 })).status, 200);

        // --- Fremdturnier: Admin von B kommt über keinen Routentyp an Daten von A, auch nicht mit turnierId=B im Body
        const vorher = await knex('helfer_slots').where({ id: slot2 }).first();
        const fremdVersuche = [
            ['GET', `/api/helfer-plan/${tA}`],
            ['GET', `/api/helfer-plan/${tA}/mitglieder`],
            ['POST', `/api/helfer-plan/${tA}/taetigkeiten`, { bezeichnung: 'Fremd', bedarf: 1 }],
            ['PUT', `/api/helfer-plan/taetigkeiten/${waffel}`, { bezeichnung: 'Gekapert', turnierId: tB }],
            ['DELETE', `/api/helfer-plan/taetigkeiten/${waffel}?turnierId=${tB}`, { bestaetigt: true }],
            ['POST', `/api/helfer-plan/taetigkeiten/${waffel}/slots`, { von_min: 1020, bis_min: 1080, turnierId: tB }],
            ['PUT', `/api/helfer-plan/slots/${slot2}`, { von_min: 600, bis_min: 780, bestaetigt: true, turnierId: tB }],
            ['DELETE', `/api/helfer-plan/slots/${slot2}`, { bestaetigt: true, turnierId: tB }],
            ['POST', `/api/helfer-plan/slots/${slot2}/einsaetze`, { name: 'Fremd', turnierId: tB }],
            ['DELETE', `/api/helfer-plan/einsaetze/${manuell.daten.id}`, { turnierId: tB }]
        ];
        for (const [methode, pfad, body] of fremdVersuche) {
            const r = await aufruf('u-fremd', methode, pfad, body);
            assert.ok(r.status === 403 || r.status === 404, `${methode} ${pfad} → ${r.status}`);
        }
        assert.deepEqual(await knex('helfer_slots').where({ id: slot2 }).first(), vorher);
        assert.equal((await knex('helfer_taetigkeiten').where({ id: waffel }).first()).bezeichnung, 'Waffeln');
        assert.ok(await knex('helfer_einsaetze').where({ id: manuell.daten.id }).first());
        // Nicht vorhandene IDs: 404
        assert.equal((await put('u-benutzer', '/api/helfer-plan/slots/999999', { bedarf: 2 })).status, 404);
        assert.equal((await del('u-benutzer', '/api/helfer-plan/einsaetze/999999')).status, 404);
        // Die Zugehörigkeitsprüfung selbst (falls das Gate je ein anderes Turnier autorisiert)
        for (const ref of [{ taetigkeitId: waffel }, { slotId: slot2 }, { einsatzId: manuell.daten.id }]) {
            await assert.rejects(stelleSicherDassGehoertZu(knex, tB, ref), (e) => e.statusCode === 404);
            await stelleSicherDassGehoertZu(knex, tA, ref);
        }

        // --- Löschen mit Bestätigung
        const loeschen = await del('u-benutzer', `/api/helfer-plan/slots/${slot2}`);
        assert.equal(loeschen.status, 409);
        assert.equal(loeschen.daten.code, 'bestaetigung_noetig');
        assert.equal((await del('u-benutzer', `/api/helfer-plan/slots/${slot2}`, { bestaetigt: true })).status, 200);
        assert.equal((await del('u-benutzer', `/api/helfer-plan/taetigkeiten/${waffel}?bestaetigt=1`)).status, 200);

        // --- Abgeschlossenes Turnier: Plan lesbar, Schreiben 403
        await knex('turniere').where({ id: tA }).update({ status: 'abgeschlossen' });
        assert.equal((await get('u-benutzer', `/api/helfer-plan/${tA}`)).status, 200);
        assert.equal((await post('u-benutzer', `/api/helfer-plan/${tA}/taetigkeiten`, { bezeichnung: 'Spät', bedarf: 1 })).status, 403);
        await knex('turniere').where({ id: tA }).update({ status: 'veroeffentlicht' });

        // --- Review Focus 1: ein Helfer kann das Turnier über die echte Route nicht bearbeiten
        const turnierBody = { bezeichnung: 'Gekapert', ort: 'X', datum: DATUM, ausrichter: 'JC', anzahl_kampfflaechen: 1 };
        assert.equal((await put('u-helfer', `/api/turniere/${tA}`, turnierBody)).status, 403);
        assert.equal((await knex('turniere').where({ id: tA }).first()).bezeichnung, 'Pokal A');

        // --- Turnierfelder beginn_min/ende_min/waagen_anzahl
        const zeitBody = { ...turnierBody, bezeichnung: 'Pokal A', beginn_min: 600, ende_min: 1080, waagen_anzahl: 3 };
        assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, zeitBody)).status, 200);
        const geladen = (await get('u-benutzer', `/api/turniere/${tA}`)).daten;
        assert.deepEqual([geladen.beginn_min, geladen.ende_min, geladen.waagen_anzahl], [600, 1080, 3]);
        for (const falsch of [
            { beginn_min: 600, ende_min: 600 }, { beginn_min: 700, ende_min: 600 }, { beginn_min: -15, ende_min: 600 },
            { beginn_min: 600, ende_min: 1441 }, { beginn_min: 600, ende_min: 1440 }, { beginn_min: 600.5, ende_min: 900 }, { waagen_anzahl: 0 }, { waagen_anzahl: 11 },
            { waagen_anzahl: 'zwei' }
        ]) {
            const r = await put('u-benutzer', `/api/turniere/${tA}`, { ...turnierBody, ...falsch });
            assert.equal(r.status, 400, JSON.stringify(falsch));
        }
        // 23:59 ist das späteste Turnierende
        assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, { ...zeitBody, ende_min: 1439 })).status, 200);
        assert.equal((await knex('turniere').where({ id: tA }).first()).ende_min, 1439);
        assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, zeitBody)).status, 200);
        // Nicht mitgesendet: unverändert
        assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, { ...turnierBody, bezeichnung: 'Pokal A' })).status, 200);
        const unveraendert = await knex('turniere').where({ id: tA }).first();
        assert.deepEqual([unveraendert.beginn_min, unveraendert.ende_min, unveraendert.waagen_anzahl], [600, 1080, 3]);
        // Leer: Uhrzeit entfernt
        assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, { ...turnierBody, bezeichnung: 'Pokal A', beginn_min: null, ende_min: '' })).status, 200);
        const geleert = await knex('turniere').where({ id: tA }).first();
        assert.deepEqual([geleert.beginn_min, geleert.ende_min], [null, null]);
        // Anlegen
        const angelegt = await post('u-benutzer', '/api/turniere', { ...turnierBody, bezeichnung: 'Neu', beginn_min: 480, ende_min: 960, waagen_anzahl: 2 });
        assert.equal(angelegt.status, 201, JSON.stringify(angelegt.daten));
        const neuT = await knex('turniere').where({ id: angelegt.daten.turnierId }).first();
        assert.deepEqual([neuT.beginn_min, neuT.ende_min, neuT.waagen_anzahl], [480, 960, 2]);
        const standard = await post('u-benutzer', '/api/turniere', { ...turnierBody, bezeichnung: 'Neu2', datum: '2030-06-01' });
        assert.equal((await knex('turniere').where({ id: standard.daten.turnierId }).first()).waagen_anzahl, 1);
        assert.equal((await post('u-benutzer', '/api/turniere', { ...turnierBody, bezeichnung: 'Neu3', beginn_min: 900, ende_min: 800 })).status, 400);
        // waagen_anzahl leer ('' / null): Update unverändert, Anlegen Standard 1
        for (const leer of ['', null]) {
            assert.equal((await put('u-benutzer', `/api/turniere/${tA}`, { ...turnierBody, bezeichnung: 'Pokal A', waagen_anzahl: leer })).status, 200);
            assert.equal((await knex('turniere').where({ id: tA }).first()).waagen_anzahl, 3);
        }
        const leerAngelegt = await post('u-benutzer', '/api/turniere', { ...turnierBody, bezeichnung: 'Neu4', datum: '2030-07-01', waagen_anzahl: '' });
        assert.equal(leerAngelegt.status, 201, JSON.stringify(leerAngelegt.daten));
        assert.equal((await knex('turniere').where({ id: leerAngelegt.daten.turnierId }).first()).waagen_anzahl, 1);

        // --- Profil
        const profil = await get('u-helfer', '/api/helfer/profil');
        assert.equal(profil.status, 200);
        assert.equal(profil.daten.email, 'helfer@test.de');
        assert.deepEqual(profil.daten.vereine.map(v => [v.name, v.rolle, v.freigegeben]), [['JC Ausrichter', 'helfer', true]]);
        assert.ok(!('password_hash' in profil.daten));
        // Weiteren Verein anfragen (wie join, kein neuer Verein, aktiver Verein bleibt)
        const beitritt = await post('u-helfer', '/api/helfer/profil/verein', { vereinId: vereinC });
        assert.equal(beitritt.status, 200, JSON.stringify(beitritt.daten));
        const mitgliedschaftC = await knex('benutzer_vereine').where({ benutzer_id: 'u-helfer', verein_id: vereinC }).first();
        assert.equal(mitgliedschaftC.freigegeben, 0);
        assert.equal(mitgliedschaftC.angefragt_ueber, 'helfer-app');
        assert.equal((await knex('benutzer').where({ id: 'u-helfer' }).first()).aktiver_verein_id, vereinA);
        assert.equal((await post('u-helfer', '/api/helfer/profil/verein', { vereinId: vereinC })).status, 409);
        assert.equal((await post('u-helfer', '/api/helfer/profil/verein', { newVereinName: 'Neuer Club' })).status, 400);
        assert.equal(await knex('vereine').where({ name: 'Neuer Club' }).first(), undefined);
        // Austreten: mit offenen Diensten gesperrt, sonst möglich
        assert.equal((await del('u-helfer', `/api/helfer/profil/verein/${vereinA}`)).status, 409);
        assert.equal((await del('u-helfer', `/api/helfer/profil/verein/${vereinC}`)).status, 200);
        assert.equal(await knex('benutzer_vereine').where({ benutzer_id: 'u-helfer', verein_id: vereinC }).first(), undefined);
        // Passwort ändern
        assert.equal((await post('u-helfer', '/api/helfer/profil/passwort', { aktuellesPasswort: 'falsch', neuesPasswort: 'neues-passwort' })).status, 400);
        assert.equal((await post('u-helfer', '/api/helfer/profil/passwort', { aktuellesPasswort: 'altes-passwort', neuesPasswort: 'kurz' })).status, 400);
        assert.equal((await post('u-helfer', '/api/helfer/profil/passwort', { aktuellesPasswort: 'altes-passwort', neuesPasswort: 'neues-passwort' })).status, 200);
        assert.ok(verifyPassword('neues-passwort', (await knex('benutzer').where({ id: 'u-helfer' }).first()).password_hash));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
