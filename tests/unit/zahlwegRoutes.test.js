import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// wie src/app.js: DATE-Spalten als Text
pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'zahlweg-routen-test-geheimnis';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'zahlweg-test-schluessel-mit-mindestens-32-zeichen';

const jwt = (await import('jsonwebtoken')).default;
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { getZahlwegRoutes } = await import('../../src/routes/zahlwegRoutes.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const EINGABE = { zahlweg: 'ueberweisung', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };
const SPAETER = '2030-05-01';

test('Zahlweg-API', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/zahlweg', getZahlwegRoutes(knex));
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
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        const mitglieder = [
            ['a1', vA, 'benutzer', 1], ['a2', vA, 'admin', 1], ['ahelfer', vA, 'helfer', 1], ['aoffen', vA, 'benutzer', 0],
            ['b1', vB, 'benutzer', 1], ['aus', vAus, 'benutzer', 1]
        ];
        for (const [n, v, rolle, frei] of mitglieder) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: frei, rolle });
        }
        // Super-Admin im Modus, aktiver Verein JC A ohne Mitgliedschaft dort
        await knex('benutzer').insert({ id: 'u-super', email: 'super@test.de', vorname: 's', nachname: 'T', email_bestaetigt_am: knex.fn.now(), ist_super_admin: true, super_admin_modus: true, aktiver_verein_id: vA });

        const neuesTurnier = async (extra = {}) => id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: SPAETER, ausrichter: 'JC Ausrichter', verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, ...extra
        }).returning('id'))[0]);
        let nr = 0;
        const kaempfer = async (turnierId, verein) => {
            nr += 1;
            return id((await knex('turnier_teilnehmer').insert({
                turnier_id: turnierId, judopass_id: `P-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
                verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
            }).returning('id'))[0]);
        };
        const t = await neuesTurnier();

        // Anmeldung
        assert.equal((await aufruf(null, 'GET', `/api/zahlweg/${t}`)).status, 401);
        let r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.erforderlich, true);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar']);
        assert.equal(r.daten.startgeld, 8);
        assert.equal(r.daten.zahlweg, null);
        assert.equal(r.daten.aenderbar, true);

        r = await aufruf('u-a1', 'PUT', `/api/zahlweg/${t}`, EINGABE);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.success, true);
        assert.equal(r.daten.zahlweg.zahlweg, 'ueberweisung');
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.daten.zahlweg.verein_name, 'JC A');
        assert.equal(r.daten.aenderbar, true);
        // Konto für den Girocode: nur bei Überweisung, aus den Abrechnungsdaten des Ausrichters
        assert.equal(r.daten.empfaenger, null);
        await speichereStammdaten(knex, vAus, { iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'JC Ausrichter e.V.' }, 'u-aus');
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.deepEqual(r.daten.empfaenger, { kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE89370400440532013000', verwendungszweck: null });
        // falscher/fehlender Schlüssel: empfaenger null, der Rest der Antwort bleibt
        const schluessel = process.env.ZAHLUNGSDATEN_SCHLUESSEL;
        for (const wert of ['ein-ganz-anderer-schluessel-mit-32-zeichen-x', undefined]) {
            if (wert === undefined) delete process.env.ZAHLUNGSDATEN_SCHLUESSEL; else process.env.ZAHLUNGSDATEN_SCHLUESSEL = wert;
            const kaputt = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
            assert.equal(kaputt.status, 200);
            assert.equal(kaputt.daten.empfaenger, null);
            assert.equal(kaputt.daten.erforderlich, true);
            assert.equal(kaputt.daten.zahlweg.zahlweg, 'ueberweisung');
        }
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = schluessel;

        // zweiter Benutzer desselben Vereins überschreibt, eine Zeile
        r = await aufruf('u-a2', 'PUT', `/api/zahlweg/${t}`, { ...EINGABE, zahlweg: 'bar' });
        assert.equal(r.status, 200);
        assert.equal((await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`)).daten.empfaenger, null);
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: t }).count('* as n').first()).n, '1');
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: t }).first()).zahlweg, 'bar');
        // Vorbelegung aus früherer Wahl bei anderem Turnier
        const t2 = await neuesTurnier();
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t2}`);
        assert.equal(r.daten.zahlweg, null);
        assert.equal(r.daten.vorbelegung.rechnung_email, 'a@b.de');

        // Validierung
        assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${t2}`, { ...EINGABE, rechnung_email: '' })).status, 400);
        const tUeb = await neuesTurnier({ angebotene_zahlwege: 'ueberweisung' });
        assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${tUeb}`, { ...EINGABE, zahlweg: 'bar' })).status, 400);
        // Lastschrift ist in Stufe 1 nie angeboten, leere Liste -> Standard
        const tLast = await neuesTurnier({ angebotene_zahlwege: 'lastschrift,ueberweisung' });
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${tLast}`);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung']);
        // Lastschrift nicht angeboten (keine Gläubiger-ID): weder Mandat noch Mandatsvorschau, auch mit vollständigen Mandatsangaben 400
        assert.equal(r.daten.mandat, null);
        assert.equal(r.daten.mandatsvorschau, null);
        assert.equal(typeof r.daten.istAdminDesVereins, 'boolean');
        assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${tLast}`, { ...EINGABE, zahlweg: 'lastschrift' })).status, 400);
        r = await aufruf('u-a1', 'PUT', `/api/zahlweg/${tLast}`, { ...EINGABE, zahlweg: 'lastschrift', iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'JC A', zustimmung: true, vertretung_bestaetigt: true });
        assert.equal(r.status, 400);
        assert.equal(r.daten.mandat, undefined);
        const tLeer = await neuesTurnier({ angebotene_zahlwege: 'lastschrift' });
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${tLeer}`);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar']);

        // Berechtigungen
        assert.equal((await aufruf('u-ahelfer', 'PUT', `/api/zahlweg/${t2}`, EINGABE)).status, 403);
        assert.equal((await aufruf('u-aoffen', 'PUT', `/api/zahlweg/${t2}`, EINGABE)).status, 403);
        assert.equal((await aufruf('u-super', 'PUT', `/api/zahlweg/${t2}`, EINGABE)).status, 403);
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: t2 }).count('* as n').first()).n, '0');
        // Ausrichter zahlt nicht
        r = await aufruf('u-aus', 'PUT', `/api/zahlweg/${t2}`, EINGABE);
        assert.equal(r.status, 400);
        assert.match(r.daten.error, /Ausrichter/);
        r = await aufruf('u-aus', 'GET', `/api/zahlweg/${t2}`);
        assert.equal(r.daten.erforderlich, false);
        assert.equal(r.daten.aenderbar, false);

        // Turnier ohne Startgeld
        const tFrei = await neuesTurnier({ startgeld: null });
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${tFrei}`);
        assert.equal(r.daten.erforderlich, false);
        assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${tFrei}`, EINGABE)).status, 400);
        // Anmeldung geschlossen: nicht änderbar
        const tZu = await neuesTurnier({ datum: '2020-01-01' });
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${tZu}`);
        assert.equal(r.daten.aenderbar, false);
        assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${tZu}`, EINGABE)).status, 403);
        assert.equal((await aufruf('u-a1', 'GET', '/api/zahlweg/999999')).status, 404);

        // Sichtbarkeit: Entwurf, abgesagt und eingeschränkte Turniere gibt es für andere Vereine nicht
        const tEntwurf = await neuesTurnier({ status: 'entwurf' });
        const tAbgesagt = await neuesTurnier({ status: 'abgesagt' });
        const tEingeladen = await neuesTurnier({ sichtbarkeit: 'eingeladen' });
        for (const tid of [tEntwurf, tAbgesagt, tEingeladen]) {
            assert.equal((await aufruf('u-a1', 'GET', `/api/zahlweg/${tid}`)).status, 404, String(tid));
            assert.equal((await aufruf('u-a1', 'PUT', `/api/zahlweg/${tid}`, EINGABE)).status, 404, String(tid));
        }
        assert.equal((await aufruf('u-aus', 'GET', `/api/zahlweg/${tEntwurf}`)).status, 200);
        assert.equal((await aufruf('u-aus', 'GET', `/api/zahlweg/${tEingeladen}`)).status, 200);

        // Kasse
        const tk = await neuesTurnier();
        await aufruf('u-b1', 'PUT', `/api/zahlweg/${tk}`, { ...EINGABE, zahlweg: 'bar' });
        await aufruf('u-a1', 'PUT', `/api/zahlweg/${tk}`, EINGABE);
        const kB1 = await kaempfer(tk, 'JC B');
        const kB2 = await kaempfer(tk, 'JC B');
        const kA = await kaempfer(tk, 'JC A');
        const kAus = await kaempfer(tk, 'JC Ausrichter');
        const kOhne = await kaempfer(tk, 'JC Unbekannt');
        assert.equal((await aufruf('u-a1', 'GET', `/api/zahlweg/${tk}/kasse`)).status, 403);
        assert.equal((await aufruf('u-ahelfer', 'GET', `/api/zahlweg/${tk}/kasse`)).status, 403);
        assert.equal((await aufruf(null, 'GET', `/api/zahlweg/${tk}/kasse`)).status, 401);
        r = await aufruf('u-aus', 'GET', `/api/zahlweg/${tk}/kasse`);
        assert.equal(r.status, 200);
        assert.deepEqual(r.daten.eintraege.map((e) => e.vereinName), ['JC B', 'JC Unbekannt']);
        assert.equal((await aufruf('u-super', 'GET', `/api/zahlweg/${tk}/kasse`)).status, 200);
        // Rechnungsdaten vor Ort gibt es nur am Hallen-Server
        assert.equal((await aufruf('u-aus', 'POST', `/api/zahlweg/${tk}/vor-ort`, { vereinName: 'JC Unbekannt', ...EINGABE })).status, 409);

        // bar-kassiert: nur Vereine der Kassenliste
        for (const v of ['JC A', 'JC Ausrichter', 'Gibt es nicht', undefined, 5]) {
            assert.equal((await aufruf('u-aus', 'POST', `/api/zahlweg/${tk}/kasse/bar-kassiert`, { vereinName: v })).status, 400, String(v));
        }
        assert.equal((await aufruf('u-a1', 'POST', `/api/zahlweg/${tk}/kasse/bar-kassiert`, { vereinName: 'JC B' })).status, 403);
        const bezahlt = async (k) => (await knex('turnier_teilnehmer').where({ id: k }).first()).startgeld_bezahlt;
        assert.ok(!(await bezahlt(kA)) && !(await bezahlt(kAus)));
        r = await aufruf('u-aus', 'POST', `/api/zahlweg/${tk}/kasse/bar-kassiert`, { vereinName: 'JC B' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual(r.daten, { success: true, anzahl: 2 });
        assert.ok(await bezahlt(kB1) && await bezahlt(kB2));
        assert.ok(!(await bezahlt(kA)) && !(await bezahlt(kAus)) && !(await bezahlt(kOhne)));
        r = await aufruf('u-aus', 'POST', `/api/zahlweg/${tk}/kasse/bar-kassiert`, { vereinName: 'JC Unbekannt' });
        assert.equal(r.daten.anzahl, 1);
        assert.ok(await bezahlt(kOhne));
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
