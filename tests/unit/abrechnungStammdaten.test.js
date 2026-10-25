import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'abrechnung-stammdaten-test-geheimnis';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'abrechnung-test-schluessel-mit-mindestens-32-zeichen';

const jwt = (await import('jsonwebtoken')).default;
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');
const { requireTurnierAdmin } = await import('../../src/middleware/auth.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const IBAN = 'DE89 3704 0044 0532 0130 00';
const VOLL = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: IBAN
};

test('Abrechnung: Stammdaten-API', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
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
        const vFremd = id((await knex('vereine').insert({ name: 'JC Fremd' }).returning('id'))[0]);
        for (const [n, v, rolle] of [['admin', vAus, 'admin'], ['benutzer', vAus, 'benutzer'], ['fremd', vFremd, 'admin']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle });
        }
        await knex('benutzer').insert({ id: 'u-super', email: 'super@test.de', vorname: 's', nachname: 'T', email_bestaetigt_am: knex.fn.now(), ist_super_admin: true, super_admin_modus: true, aktiver_verein_id: vFremd });
        const t = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: 'JC Ausrichter', verein_id: vAus, status: 'veroeffentlicht', startgeld: 8
        }).returning('id'))[0]);

        // ohne Anmeldung / ohne Stammdaten
        assert.equal((await aufruf(null, 'GET', `/api/abrechnung/stammdaten/${vAus}`)).status, 401);
        let r = await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten/${vAus}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.stammdaten, null);
        assert.ok(r.daten.fehlt.includes('Anschrift'));

        // Rechte
        assert.equal((await aufruf('u-benutzer', 'GET', `/api/abrechnung/stammdaten/${vAus}`)).status, 403);
        assert.equal((await aufruf('u-fremd', 'GET', `/api/abrechnung/stammdaten/${vAus}`)).status, 403);
        assert.equal((await aufruf('u-benutzer', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, VOLL)).status, 403);

        // Speichern mit IBAN
        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, VOLL);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.success, true);
        assert.equal(r.daten.stammdaten.iban_maske, 'DE89 **** **** **** **** 00');
        assert.equal(r.daten.stammdaten.iban_vorhanden, true);
        assert.ok(!('iban_verschluesselt' in r.daten.stammdaten));
        assert.ok(!JSON.stringify(r.daten).includes('3704'));
        const zeile = await knex('vereins_abrechnung').where({ verein_id: vAus }).first();
        assert.ok(zeile.iban_verschluesselt.startsWith('z1:'));
        assert.equal(zeile.naechste_rechnungsnummer, 1);
        assert.equal(zeile.geaendert_von, 'u-admin');

        // Lesen als Admin und als Super-Admin im Modus
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten/${vAus}`);
        assert.equal(r.status, 200);
        assert.deepEqual(r.daten.fehlt, []);
        assert.ok(!('iban_verschluesselt' in r.daten.stammdaten));
        assert.equal((await aufruf('u-super', 'GET', `/api/abrechnung/stammdaten/${vAus}`)).status, 200);

        // Ungültig
        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, iban: 'DE89 3704 0044 0532 0130 01' });
        assert.equal(r.status, 400);
        assert.ok(!JSON.stringify(r.daten).includes('0130'));
        assert.equal((await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, rechnung_email: 'kaputt' })).status, 400);
        assert.equal((await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, rechnungs_praefix: 'a b!' })).status, 400);

        // ohne iban bleibt die alte; Nummernzähler nicht änderbar; Präfix änderbar
        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, iban: '', rechnungs_praefix: 'NEU-', naechste_rechnungsnummer: 99 });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.stammdaten.iban_maske, 'DE89 **** **** **** **** 00');
        assert.equal(r.daten.stammdaten.rechnungs_praefix, 'NEU-');
        assert.equal((await knex('vereins_abrechnung').where({ verein_id: vAus }).first()).naechste_rechnungsnummer, 1);

        // Prüfung für das Turnier (E3: Vereinskonto reicht)
        r = await aufruf('u-benutzer', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.vollstaendig, true);
        assert.deepEqual(r.daten.fehlt, []);
        assert.equal(r.daten.vereinId, vAus);
        assert.equal(r.daten.darfPflegen, false);
        assert.equal((await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`)).daten.darfPflegen, true);
        assert.equal((await aufruf('u-fremd', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`)).status, 403);

        // IBAN löschen -> Prüfung meldet fehlendes Konto, ohne Feldwerte
        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, iban: '', iban_loeschen: true });
        assert.equal(r.status, 200);
        assert.equal(r.daten.stammdaten.iban_vorhanden, false);
        assert.equal(r.daten.stammdaten.iban_maske, null);
        r = await aufruf('u-benutzer', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`);
        assert.equal(r.daten.vollstaendig, false);
        assert.deepEqual(r.daten.fehlt, ['Kontoinhaber und IBAN']);
        assert.ok(!JSON.stringify(r.daten).includes('Köln'));

        // ohne Schlüssel: IBAN -> 503, ohne IBAN -> 200
        const schluessel = process.env.ZAHLUNGSDATEN_SCHLUESSEL;
        delete process.env.ZAHLUNGSDATEN_SCHLUESSEL;
        try {
            assert.equal((await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, VOLL)).status, 503);
            const ohne = { ...VOLL };
            delete ohne.iban;
            assert.equal((await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, ohne)).status, 200);
        } finally { process.env.ZAHLUNGSDATEN_SCHLUESSEL = schluessel; }

        // Einzelbenutzerbetrieb: requireTurnierAdmin antwortet 409
        process.env.BETRIEBSMODUS = 'server';
        try {
            const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
            let weiter = false;
            await requireTurnierAdmin(knex)({ user: { id: 'u-admin' }, params: { turnierId: String(t) }, query: {}, body: {}, baseUrl: '/api/abrechnung' }, res, () => { weiter = true; });
            assert.equal(weiter, false);
            assert.equal(res.code, 409);
            assert.equal(res.body.error, 'Die Abrechnung gibt es nur in der Cloud.');
        } finally { process.env.BETRIEBSMODUS = 'cloud'; }
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
