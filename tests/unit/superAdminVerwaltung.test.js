import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Super-Admin-Verwaltung: Konten sperren, Passwort per Mail zurücksetzen, Bestätigung verwalten, Vereine anlegen/
// umbenennen/zusammenführen/löschen, Turniere archivieren und löschen.
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.SMTP_HOST = '';
process.env.PUBLIC_BASE_URL = 'https://hajime.example';
process.env.JWT_SECRET = 'super-admin-verwaltung-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getNutzerRoutes } = await import('../../src/routes/nutzerRoutes.js');
const { getAuthRoutes } = await import('../../src/routes/authRoutes.js');
const { requireAuth } = await import('../../src/middleware/auth.js');
const { getTurniere } = await import('../../src/controllers/turnierController.js');
const { hashPassword, verifyPassword } = await import('../../src/utils/password.js');
const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const { vergesseSperrStand } = await import('../../src/utils/kontoSperre.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const BASIS = 'https://hajime.example';

function tokenAusMail(text, seite) {
    const m = new RegExp(`${seite}\\?token=([A-Za-z0-9_-]+)`).exec(text);
    assert.ok(m, `Link auf ${seite} fehlt in: ${text}`);
    return m[1];
}

test('Super-Admin-Verwaltung: sperren, Passwort-Reset, Bestätigung, Vereine, Turniere', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const mails = [];
    setzeTestVersand(async (mail) => { mails.push(mail); });
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/nutzer', getNutzerRoutes(knex));
    app.use('/api/auth', getAuthRoutes(knex));
    app.get('/api/geschuetzt', requireAuth, (req, res) => res.json({ ok: true }));
    app.get('/api/turniere', requireAuth, (req, res) => getTurniere(knex, req, res));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, pfad, methode = 'GET', body) => {
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
    const nutzer = (benutzerId, pfad, methode, body) => aufruf(benutzerId, `/api/nutzer${pfad}`, methode, body);
    const auth = (pfad, body) => aufruf(null, `/api/auth${pfad}`, 'POST', body);
    // Mindestabstand zwischen zwei Reset-Mails umgehen
    const altereTokens = (benutzerId, zweck) => knex('token_einmal').where({ benutzer_id: benutzerId, zweck })
        .update({ created_at: knex.raw("now() - interval '3 minutes'") });

    try {
        await knex('benutzer').insert([
            { id: 'u-super', email: 'super@test.de', vorname: 'Su', nachname: 'Per', ist_super_admin: true, super_admin_modus: true, password_hash: hashPassword('super-passwort'), email_bestaetigt_am: knex.fn.now() },
            { id: 'u-super2', email: 'super2@test.de', vorname: 'Su', nachname: 'Zwei', ist_super_admin: true, super_admin_modus: true, password_hash: hashPassword('super-passwort'), email_bestaetigt_am: knex.fn.now() },
            { id: 'u-normal', email: 'normal@test.de', vorname: 'No', nachname: 'Rmal', password_hash: hashPassword('altes-passwort'), email_bestaetigt_am: knex.fn.now() },
            { id: 'u-neu', email: 'neu@test.de', vorname: 'Ne', nachname: 'U', password_hash: hashPassword('irgendwas1') }
        ]);

        // --- Rechte
        for (const [pfad, methode] of [
            ['/u-normal/sperren', 'POST'], ['/u-neu/bestaetigen', 'POST'], ['/u-neu/bestaetigungs-mail', 'POST'], ['/u-normal/passwort-mail', 'POST'],
            ['/unbestaetigte', 'DELETE'], ['/vereine', 'POST'], ['/vereine/1/zusammenfuehren', 'POST'], ['/vereine/1', 'DELETE'],
            ['/turniere/1/archivieren', 'POST'], ['/turniere/1', 'DELETE']
        ]) {
            assert.equal((await nutzer(null, pfad, methode, {})).status, 401, `${methode} ${pfad} ohne Anmeldung`);
            assert.equal((await nutzer('u-normal', pfad, methode, {})).status, 403, `${methode} ${pfad} als Nicht-Super-Admin`);
        }

        // --- Sperren
        assert.equal((await nutzer('u-super', '/u-normal/sperren', 'POST', {})).status, 400);
        assert.equal((await nutzer('u-super', '/u-gibtsnicht/sperren', 'POST', { wert: true })).status, 404);
        assert.equal((await nutzer('u-super', '/u-super/sperren', 'POST', { wert: true })).status, 409, 'nicht das eigene Konto');
        assert.equal((await aufruf('u-normal', '/api/geschuetzt')).status, 200);
        assert.equal((await auth('/login', { email: 'normal@test.de', password: 'altes-passwort' })).status, 200);
        const gesperrt = await nutzer('u-super', '/u-normal/sperren', 'POST', { wert: true });
        assert.deepEqual(gesperrt.daten, { success: true, gesperrt: true });
        assert.ok((await knex('benutzer').where({ id: 'u-normal' }).first()).gesperrt_am);
        const login = await auth('/login', { email: 'normal@test.de', password: 'altes-passwort' });
        assert.equal(login.status, 403);
        assert.equal(login.daten.code, 'gesperrt');
        assert.equal((await auth('/login', { email: 'normal@test.de', password: 'falsch' })).status, 401, 'falsches Passwort verrät den Zustand nicht');
        const geschuetzt = await aufruf('u-normal', '/api/geschuetzt');
        assert.equal(geschuetzt.status, 401, 'bestehendes Token wird sofort ungültig');
        assert.equal(geschuetzt.daten.code, 'gesperrt');
        const liste = (await nutzer('u-super', '/')).daten;
        assert.equal(liste.find(k => k.id === 'u-normal').gesperrt, true);
        assert.ok(liste.find(k => k.id === 'u-normal').erstellt_am);
        // Entsperren
        assert.equal((await nutzer('u-super', '/u-normal/sperren', 'POST', { wert: false })).status, 200);
        assert.equal((await aufruf('u-normal', '/api/geschuetzt')).status, 200);
        assert.equal((await auth('/login', { email: 'normal@test.de', password: 'altes-passwort' })).status, 200);
        // letzter nicht gesperrter Super-Admin
        assert.equal((await nutzer('u-super', '/u-super2/sperren', 'POST', { wert: true })).status, 200);
        assert.equal((await nutzer('u-super2', '/u-super/sperren', 'POST', { wert: true })).status, 401, 'gesperrter Super-Admin ist draußen');
        vergesseSperrStand();
        assert.equal((await nutzer('u-super', '/u-super2/sperren', 'POST', { wert: false })).status, 200);

        // --- Passwort vergessen (öffentlich)
        mails.length = 0;
        const unbekannt = await auth('/passwort-vergessen', { email: 'gibtsnicht@test.de' });
        assert.equal(unbekannt.status, 200);
        assert.equal(mails.length, 0, 'unbekannte Adresse: keine Mail, gleiche Antwort');
        const bekannt = await auth('/passwort-vergessen', { email: ' Normal@Test.de ' });
        assert.equal(bekannt.status, 200);
        assert.deepEqual(bekannt.daten, unbekannt.daten);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].to, 'normal@test.de');
        const resetToken = tokenAusMail(mails[0].text, 'passwort-zuruecksetzen.html');
        // zweite Anfrage direkt danach: gedrosselt, der bisherige Link bleibt gültig
        await auth('/passwort-vergessen', { email: 'normal@test.de' });
        assert.equal(mails.length, 1);
        // unbestätigte und gesperrte Konten bekommen keinen Link
        await auth('/passwort-vergessen', { email: 'neu@test.de' });
        assert.equal(mails.length, 1 + 1, 'unbestätigtes Konto darf zurücksetzen (Besitz der Adresse)');
        mails.pop();
        // --- Zurücksetzen
        assert.equal((await auth('/passwort-zuruecksetzen', { token: resetToken, passwort: 'kurz' })).status, 400);
        assert.equal((await auth('/passwort-zuruecksetzen', { token: 'falsch', passwort: 'Neues-Passwort-1' })).status, 400);
        assert.equal((await auth('/passwort-zuruecksetzen', { token: resetToken, passwort: 'Neues-Passwort-1' })).status, 200);
        assert.ok(verifyPassword('Neues-Passwort-1', (await knex('benutzer').where({ id: 'u-normal' }).first()).password_hash));
        assert.equal((await auth('/passwort-zuruecksetzen', { token: resetToken, passwort: 'Noch-ein-Passwort-2' })).status, 400, 'Link nur einmal');
        assert.equal((await auth('/login', { email: 'normal@test.de', password: 'Neues-Passwort-1' })).status, 200);
        // gesperrt: keine Mail, Link wertlos
        await nutzer('u-super', '/u-normal/sperren', 'POST', { wert: true });
        await altereTokens('u-normal', 'passwort');
        mails.length = 0;
        await auth('/passwort-vergessen', { email: 'normal@test.de' });
        assert.equal(mails.length, 0);
        await nutzer('u-super', '/u-normal/sperren', 'POST', { wert: false });

        // --- Reset-Mail durch den Super-Admin
        await altereTokens('u-normal', 'passwort');
        mails.length = 0;
        assert.equal((await nutzer('u-super', '/u-gibtsnicht/passwort-mail', 'POST')).status, 404);
        assert.equal((await nutzer('u-super', '/u-normal/passwort-mail', 'POST')).status, 200);
        assert.equal(mails.length, 1);
        assert.match(mails[0].text, /Administrator/);
        const adminToken = tokenAusMail(mails[0].text, 'passwort-zuruecksetzen.html');
        assert.equal((await nutzer('u-super', '/u-normal/passwort-mail', 'POST')).status, 200, 'ohne Mindestabstand');
        assert.equal((await auth('/passwort-zuruecksetzen', { token: adminToken, passwort: 'Neues-Passwort-3' })).status, 400, 'älterer Link wurde entwertet');

        // --- Bestätigung verwalten
        const verein = id((await knex('vereine').insert({ name: 'JC Wunsch' }).returning('id'))[0]);
        await knex('token_einmal').insert({ benutzer_id: 'u-neu', zweck: 'email', verein_id: verein, angefragt_ueber: 'verwaltung', token_hash: 'x'.repeat(64), laeuft_ab_am: knex.raw("now() + interval '1 day'") });
        assert.equal((await nutzer('u-super', '/u-normal/bestaetigen', 'POST')).status, 409, 'schon bestätigt');
        assert.equal((await nutzer('u-super', '/u-normal/bestaetigungs-mail', 'POST')).status, 409);
        mails.length = 0;
        assert.equal((await nutzer('u-super', '/u-neu/bestaetigungs-mail', 'POST')).status, 200);
        assert.equal((await nutzer('u-super', '/u-neu/bestaetigungs-mail', 'POST')).status, 200, 'ohne Mindestabstand');
        assert.equal(mails.length, 2);
        assert.match(mails[0].subject, /bestätigen/);
        assert.equal((await nutzer('u-super', '/u-neu/bestaetigen', 'POST')).status, 200);
        const neu = await knex('benutzer').where({ id: 'u-neu' }).first();
        assert.ok(neu.email_bestaetigt_am);
        const anfrage = await knex('benutzer_vereine').where({ benutzer_id: 'u-neu', verein_id: verein }).first();
        assert.ok(anfrage, 'der gewünschte Verein führt zur Beitrittsanfrage');
        assert.equal(anfrage.freigegeben, 0);
        assert.equal((await knex('token_einmal').where({ benutzer_id: 'u-neu', zweck: 'email' }).whereNull('benutzt_am')).length, 0);

        // --- Aufräumen unbestätigter Konten
        await knex('benutzer').insert([
            { id: 'u-alt', email: 'alt@test.de', vorname: 'Al', nachname: 'T', password_hash: 'x', created_at: knex.raw("now() - interval '40 days'") },
            { id: 'u-jung', email: 'jung@test.de', vorname: 'Ju', nachname: 'Ng', password_hash: 'x', created_at: knex.raw("now() - interval '5 days'") }
        ]);
        assert.equal((await nutzer('u-super', '/unbestaetigte', 'DELETE', { aelterAlsTage: 0 })).status, 400);
        assert.equal((await nutzer('u-super', '/unbestaetigte', 'DELETE', { aelterAlsTage: 'x' })).status, 400);
        const aufgeraeumt = await nutzer('u-super', '/unbestaetigte', 'DELETE', {});
        assert.deepEqual(aufgeraeumt.daten, { success: true, geloescht: 1 });
        assert.equal(await knex('benutzer').where({ id: 'u-alt' }).first() ?? null, null);
        assert.ok(await knex('benutzer').where({ id: 'u-jung' }).first());
        assert.ok(await knex('benutzer').where({ id: 'u-normal' }).first(), 'bestätigte Konten bleiben');

        // --- Vereine anlegen, umbenennen
        assert.equal((await nutzer('u-super', '/vereine', 'POST', { name: '  ' })).status, 400);
        assert.equal((await nutzer('u-super', '/vereine', 'POST', { name: 'x'.repeat(256) })).status, 400);
        assert.equal((await nutzer('u-super', '/vereine', 'POST', { name: 'JC Neu', bundesland: 'Atlantis' })).status, 400);
        const angelegt = await nutzer('u-super', '/vereine', 'POST', { name: '  JC   Neu  ', bundesland: 'Bayern' });
        assert.equal(angelegt.status, 201);
        assert.equal(angelegt.daten.verein.name, 'JC Neu');
        assert.equal(angelegt.daten.verein.bundesland, 'Bayern');
        assert.equal((await nutzer('u-super', '/vereine', 'POST', { name: 'jc neu' })).status, 409, 'Dublette ohne Beachtung der Schreibweise');
        const neuId = angelegt.daten.verein.id;
        assert.equal((await nutzer('u-super', `/vereine/${neuId}`, 'PUT', { name: 'JC Wunsch' })).status, 409);
        const umbenannt = await nutzer('u-super', `/vereine/${neuId}`, 'PUT', { name: 'TSV Neu' });
        assert.deepEqual(umbenannt.daten, { success: true, name: 'TSV Neu' });
        assert.equal((await knex('vereine').where({ id: neuId }).first()).bundesland, 'Bayern', 'Umbenennen lässt das Bundesland unberührt');
        assert.equal((await nutzer('u-super', '/vereine/999999', 'PUT', { name: 'Egal' })).status, 404);
        // das Bundesland allein wie bisher
        assert.deepEqual((await nutzer('u-super', `/vereine/${neuId}`, 'PUT', { bundesland: 'Hessen' })).daten, { success: true, bundesland: 'Hessen' });

        // --- Vereine zusammenführen
        const quelle = id((await knex('vereine').insert({ name: 'TSV Neu e.V.', bundesland: 'Berlin' }).returning('id'))[0]);
        await knex('benutzer').insert([
            { id: 'u-a', email: 'a@test.de', vorname: 'A', nachname: 'A', password_hash: 'x', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: quelle },
            { id: 'u-b', email: 'b@test.de', vorname: 'B', nachname: 'B', password_hash: 'x', email_bestaetigt_am: knex.fn.now() },
            { id: 'u-c', email: 'c@test.de', vorname: 'C', nachname: 'C', password_hash: 'x', email_bestaetigt_am: knex.fn.now() }
        ]);
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-a', verein_id: quelle, freigegeben: 1, rolle: 'admin' },          // nur in der Quelle: zieht um
            { benutzer_id: 'u-b', verein_id: quelle, freigegeben: 1, rolle: 'admin' },          // in beiden: die höhere Rolle gilt
            { benutzer_id: 'u-b', verein_id: neuId, freigegeben: 1, rolle: 'helfer' },
            { benutzer_id: 'u-c', verein_id: quelle, freigegeben: 0 },                          // wartend in der Quelle,
            { benutzer_id: 'u-c', verein_id: neuId, freigegeben: 1, rolle: 'benutzer' }         // freigegeben im Ziel: bleibt
        ]);
        await knex('turniere').insert([
            { bezeichnung: 'Quellturnier', ort: 'Q', datum: '2031-01-10', ausrichter: 'X', verein_id: quelle, status: 'veroeffentlicht' }
        ]);
        await knex('urkunden_vorlagen').insert([
            { verein_id: quelle, name: 'Standard', pdf: Buffer.from('a'), seiten_breite_pt: 595, seiten_hoehe_pt: 842 }, { verein_id: neuId, name: 'Standard', pdf: Buffer.from('b'), seiten_breite_pt: 595, seiten_hoehe_pt: 842 }
        ]);
        await knex('orga_einladungen').insert({ verein_id: quelle, email: 'ein@test.de', token_hash: 'y'.repeat(64), laeuft_ab_am: knex.raw("now() + interval '1 day'") });
        await knex('vereins_abrechnung').insert({ verein_id: quelle, anschrift: 'Quelle', naechste_rechnungsnummer: 7 });
        assert.equal((await nutzer('u-super', `/vereine/${quelle}/zusammenfuehren`, 'POST', {})).status, 400);
        assert.equal((await nutzer('u-super', `/vereine/${quelle}/zusammenfuehren`, 'POST', { zielId: quelle })).status, 400);
        assert.equal((await nutzer('u-super', `/vereine/${quelle}/zusammenfuehren`, 'POST', { zielId: 999999 })).status, 404);
        const zusammen = await nutzer('u-super', `/vereine/${quelle}/zusammenfuehren`, 'POST', { zielId: neuId });
        assert.equal(zusammen.status, 200, JSON.stringify(zusammen.daten));
        assert.deepEqual(zusammen.daten, { success: true, mitglieder: 3, turniere: 1, vorlagen: 1 });
        assert.equal(await knex('vereine').where({ id: quelle }).first() ?? null, null);
        const rolle = async (b) => (await knex('benutzer_vereine').where({ benutzer_id: b, verein_id: neuId }).first());
        assert.equal((await rolle('u-a')).rolle, 'admin');
        assert.equal((await rolle('u-b')).rolle, 'admin');
        assert.equal((await rolle('u-c')).rolle, 'benutzer');
        assert.equal((await knex('benutzer_vereine').where({ verein_id: quelle })).length, 0);
        assert.equal((await knex('benutzer').where({ id: 'u-a' }).first()).aktiver_verein_id, neuId);
        assert.equal((await knex('turniere').where({ bezeichnung: 'Quellturnier' }).first()).verein_id, neuId);
        assert.deepEqual((await knex('urkunden_vorlagen').where({ verein_id: neuId }).orderBy('name')).map(v => v.name), ['Standard', 'Standard (2)']);
        assert.equal((await knex('orga_einladungen').where({ email: 'ein@test.de' }).first()).verein_id, neuId);
        assert.equal((await knex('vereine').where({ id: neuId }).first()).bundesland, 'Hessen', 'vorhandenes Bundesland bleibt');

        // Stammdaten der Abrechnung: nur die Quelle hat welche -> hängen am Ziel
        const abrNachZiel = await knex('vereins_abrechnung').where({ verein_id: neuId });
        assert.equal(abrNachZiel.length, 1);
        assert.equal(abrNachZiel[0].anschrift, 'Quelle');
        // Quelle und Ziel haben welche -> die des Ziels bleibt, keine Fehlermeldung
        const q2 = id((await knex('vereine').insert({ name: 'Abr Quelle' }).returning('id'))[0]);
        const z2 = id((await knex('vereine').insert({ name: 'Abr Ziel' }).returning('id'))[0]);
        await knex('vereins_abrechnung').insert([{ verein_id: q2, anschrift: 'Q2' }, { verein_id: z2, anschrift: 'Z2' }]);
        const zus2 = await nutzer('u-super', `/vereine/${q2}/zusammenfuehren`, 'POST', { zielId: z2 });
        assert.equal(zus2.status, 200, JSON.stringify(zus2.daten));
        const abr2 = await knex('vereins_abrechnung').whereIn('verein_id', [q2, z2]);
        assert.equal(abr2.length, 1);
        assert.equal(abr2[0].verein_id, z2);
        assert.equal(abr2[0].anschrift, 'Z2');

        // --- Vereine löschen: nur leere
        assert.equal((await nutzer('u-super', `/vereine/${neuId}`, 'DELETE')).status, 409);
        assert.equal((await nutzer('u-super', '/vereine/999999', 'DELETE')).status, 404);
        const leer = id((await knex('vereine').insert({ name: 'JC Leer' }).returning('id'))[0]);
        assert.equal((await nutzer('u-super', `/vereine/${leer}`, 'DELETE')).status, 200);
        assert.equal(await knex('vereine').where({ id: leer }).first() ?? null, null);

        // --- Turniere archivieren und löschen
        const [t1, t2] = (await knex('turniere').insert([
            { bezeichnung: 'Archivkandidat', ort: 'A', datum: '2031-02-10', ausrichter: 'X', verein_id: neuId, status: 'veroeffentlicht' },
            { bezeichnung: 'Aktiv', ort: 'B', datum: '2031-03-10', ausrichter: 'X', verein_id: neuId, status: 'veroeffentlicht', aktiv: true }
        ]).returning('id')).map(id);
        await knex('turnier_teilnehmer').insert({
            turnier_id: t1, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster', geschlecht: 'w', verein: 'JC', gewicht: 40,
            altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012
        });
        assert.equal((await nutzer('u-super', `/turniere/${t1}/archivieren`, 'POST', {})).status, 400);
        assert.equal((await nutzer('u-super', '/turniere/999999/archivieren', 'POST', { wert: true })).status, 404);
        assert.equal((await nutzer('u-super', `/turniere/${t2}/archivieren`, 'POST', { wert: true })).status, 409, 'aktives Turnier');
        const sichtbar = async () => (await aufruf('u-super', '/api/turniere')).daten.map(t => t.bezeichnung);
        assert.ok((await sichtbar()).includes('Archivkandidat'));
        assert.deepEqual((await nutzer('u-super', `/turniere/${t1}/archivieren`, 'POST', { wert: true })).daten, { success: true, archiviert: true });
        assert.ok(!(await sichtbar()).includes('Archivkandidat'), 'archiviert: nicht mehr in den Turnierlisten');
        const imVerein = (await nutzer('u-super', `/vereine/${neuId}/turniere`)).daten.turniere.find(t => t.id === t1);
        assert.equal(imVerein.archiviert, true, 'in der Super-Admin-Sicht bleibt es sichtbar');
        assert.equal((await nutzer('u-super', `/turniere/${t1}/archivieren`, 'POST', { wert: false })).status, 200);
        assert.ok((await sichtbar()).includes('Archivkandidat'));

        assert.equal((await nutzer('u-super', `/turniere/${t2}`, 'DELETE')).status, 409, 'aktives Turnier');
        assert.equal((await nutzer('u-super', '/turniere/999999', 'DELETE')).status, 404);
        assert.equal((await nutzer('u-super', `/turniere/${t1}`, 'DELETE')).status, 200, 'auch mit Teilnehmern');
        assert.equal(await knex('turniere').where({ id: t1 }).first() ?? null, null);
        assert.equal((await knex('turnier_teilnehmer').where({ turnier_id: t1 })).length, 0);
    } finally {
        setzeTestVersand(null);
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
