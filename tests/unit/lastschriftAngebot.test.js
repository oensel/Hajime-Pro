import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'lastschrift-angebot-test-geheimnis';
const SCHLUESSEL = 'lastschrift-test-schluessel-mit-mindestens-32-zeichen';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;

const jwt = (await import('jsonwebtoken')).default;
const { getZahlwegRoutes } = await import('../../src/routes/zahlwegRoutes.js');
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');
const { createTurnier, updateTurnier, importiereTurnierDaten, baueTurnierExport } = await import('../../src/controllers/turnierController.js');
const { ladeLastschriftStatus } = await import('../../src/services/abrechnungStammdaten.js');
const { lastschriftMoeglich, fehlendeStammdaten } = await import('../../src/shared/abrechnung.js');
const { istZahlwegGesichert } = await import('../../src/shared/zahlweg.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const GUELTIGE_ID = 'DE98ZZZ09999999999';
const VOLL = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE89 3704 0044 0532 0130 00'
};

function aufrufController(fn, knex, req) {
    return new Promise((resolve, reject) => {
        const res = { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code || 200, ...b }); return this; } };
        fn(knex, { app: { get: () => null }, params: {}, ...req }, res).catch(reject);
    });
}

test('lastschriftMoeglich: Gründe in fester Reihenfolge', () => {
    const turnier = {};
    const komplett = { ...VOLL, iban_vorhanden: true, glaeubiger_id: GUELTIGE_ID };
    assert.equal(fehlendeStammdaten(komplett, turnier).length, 0);
    assert.deepEqual(lastschriftMoeglich({ stammdaten: komplett, turnier, empfaengerLesbar: true, schluessel: true }), { moeglich: true, grund: null });
    assert.deepEqual(lastschriftMoeglich({ stammdaten: { ...komplett, glaeubiger_id: null }, turnier, empfaengerLesbar: true, schluessel: true }),
        { moeglich: false, grund: 'Gläubiger-ID fehlt' });
    assert.deepEqual(lastschriftMoeglich({ stammdaten: { ...komplett, anschrift: '' }, turnier, empfaengerLesbar: true, schluessel: true }),
        { moeglich: false, grund: 'Abrechnungsdaten unvollständig' });
    assert.deepEqual(lastschriftMoeglich({ stammdaten: komplett, turnier, empfaengerLesbar: false, schluessel: true }),
        { moeglich: false, grund: 'Konto des Ausrichters nicht lesbar' });
    assert.deepEqual(lastschriftMoeglich({ stammdaten: komplett, turnier, empfaengerLesbar: true, schluessel: false }),
        { moeglich: false, grund: 'Schlüssel für Zahlungsdaten fehlt' });
    assert.equal(lastschriftMoeglich({ stammdaten: null, turnier, empfaengerLesbar: true, schluessel: true }).moeglich, false);
});

test('istZahlwegGesichert: Lastschrift erst mit gültigem Mandat', () => {
    assert.equal(istZahlwegGesichert({ zahlweg: 'ueberweisung' }), true);
    assert.equal(istZahlwegGesichert({ zahlweg: 'bar' }), false);
    assert.equal(istZahlwegGesichert({ zahlweg: 'lastschrift', mandat_gueltig: false }), false);
    assert.equal(istZahlwegGesichert({ zahlweg: 'lastschrift' }), false);
    assert.equal(istZahlwegGesichert({ zahlweg: 'lastschrift', mandat_gueltig: true }), true);
});

test('Lastschrift: Angebot, Gläubiger-ID, Vorabankündigung, Transfer', async () => {
    const db = await starteTestPostgres();
    const ziel = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/zahlweg', getZahlwegRoutes(knex));
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const aufruf = async (benutzerId, methode, pfad, body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        for (const [n, v, rolle] of [['admin', vAus, 'admin'], ['a1', vA, 'benutzer']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle });
        }
        const t = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: 'JC Ausrichter', verein_id: vAus,
            status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('id'))[0]);

        assert.equal((await knex('turniere').where({ id: t }).first()).vorabankuendigung_tage, 5);

        // Gläubiger-ID in den Stammdaten: ungültig -> 400, gültig normalisiert gespeichert
        let r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { ...VOLL, glaeubiger_id: 'DE99ZZZ09999999999' });
        assert.equal(r.status, 400, JSON.stringify(r.daten));
        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, VOLL);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.stammdaten.glaeubiger_id, null);

        // ohne Gläubiger-ID: kein Lastschrift-Angebot
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar']);
        let pruefung = await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`);
        assert.equal(pruefung.status, 200);
        assert.deepEqual(pruefung.daten.lastschrift, { moeglich: false, grund: 'Gläubiger-ID fehlt' });

        r = await aufruf('u-admin', 'PUT', `/api/abrechnung/stammdaten/${vAus}`, { glaeubiger_id: 'de98 zzz0 9999 9999 99' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.stammdaten.glaeubiger_id, GUELTIGE_ID);

        // mit Gläubiger-ID und Schlüssel: Lastschrift wird angeboten
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar', 'lastschrift']);
        pruefung = await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`);
        assert.deepEqual(pruefung.daten.lastschrift, { moeglich: true, grund: null });
        const turnier = await knex('turniere').where({ id: t }).first();
        assert.deepEqual(await ladeLastschriftStatus(knex, turnier), { moeglich: true, grund: null });

        // Speichern des Zahlwegs prüft das Angebot mit derselben Funktion
        const eingabe = { zahlweg: 'lastschrift', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };
        // (Lastschrift ist angeboten; ohne Mandatsangaben lehnt der Mandats-Service ab, Stufe 3 Task 3)
        r = await aufruf('u-a1', 'PUT', `/api/zahlweg/${t}`, eingabe);
        assert.equal(r.status, 400, JSON.stringify(r.daten));
        assert.equal(r.daten.error, 'Bitte IBAN und Kontoinhaber für das Lastschriftmandat angeben.');
        assert.equal(await knex('turnier_zahlwege').where({ turnier_id: t }).first(), undefined);

        // ohne Schlüssel wieder ohne Lastschrift
        delete process.env.ZAHLUNGSDATEN_SCHLUESSEL;
        try {
            r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
            assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar']);
            pruefung = await aufruf('u-admin', 'GET', `/api/abrechnung/stammdaten-pruefung/${t}`);
            assert.deepEqual(pruefung.daten.lastschrift, { moeglich: false, grund: 'Schlüssel für Zahlungsdaten fehlt' });
            r = await aufruf('u-a1', 'PUT', `/api/zahlweg/${t}`, eingabe);
            assert.equal(r.status, 400);
        } finally {
            process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;
        }

        // nur Lastschrift angeboten, aber nicht möglich -> Standard
        await knex('vereins_abrechnung').where({ verein_id: vAus }).update({ glaeubiger_id: null });
        await knex('turniere').where({ id: t }).update({ angebotene_zahlwege: 'lastschrift' });
        r = await aufruf('u-a1', 'GET', `/api/zahlweg/${t}`);
        assert.deepEqual(r.daten.angebotene, ['ueberweisung', 'bar']);
        await knex('vereins_abrechnung').where({ verein_id: vAus }).update({ glaeubiger_id: GUELTIGE_ID });

        // Turnierformular: Lastschrift ankreuzbar, Vorabankündigung 1-14
        const basisTurnier = { bezeichnung: 'Neu', ort: 'Halle', ausrichter: 'JC', datum: '2031-05-01', anzahl_kampfflaechen: 1, startgeld: 8 };
        const legeAn = (extra = {}) => aufrufController(createTurnier, knex, { user: { id: 'u-admin' }, body: { ...basisTurnier, ...extra } });
        r = await legeAn();
        assert.equal(r.code, 201, JSON.stringify(r));
        assert.equal((await knex('turniere').where({ id: r.turnierId }).first()).vorabankuendigung_tage, 5);
        r = await legeAn({ vorabankuendigung_tage: 20 });
        assert.equal(r.code, 400);
        assert.equal(r.error, 'Die Vorabankündigung muss zwischen 1 und 14 Tagen liegen.');
        assert.equal((await legeAn({ vorabankuendigung_tage: 0 })).code, 400);
        r = await legeAn({ vorabankuendigung_tage: 7, angebotene_zahlwege: ['ueberweisung', 'lastschrift'] });
        assert.equal(r.code, 201, JSON.stringify(r));
        const neu = await knex('turniere').where({ id: r.turnierId }).first();
        assert.equal(neu.vorabankuendigung_tage, 7);
        assert.equal(neu.angebotene_zahlwege, 'ueberweisung,lastschrift');
        const upd = (extra) => aufrufController(updateTurnier, knex, { params: { id: String(neu.id) }, user: { id: 'u-admin' }, body: { ...basisTurnier, ...extra } });
        assert.equal((await upd({ vorabankuendigung_tage: 3 })).code, 200);
        assert.equal((await knex('turniere').where({ id: neu.id }).first()).vorabankuendigung_tage, 3);
        assert.equal((await upd({ vorabankuendigung_tage: 15 })).code, 400);

        // Export -> Import trägt den Wert mit, ungültige Werte werden 5
        const daten = JSON.parse(JSON.stringify(await baueTurnierExport(knex, neu.id)));
        assert.equal(daten.turnier.vorabankuendigung_tage, 3);
        let imp = await importiereTurnierDaten(ziel.knex, null, daten);
        assert.equal((await ziel.knex('turniere').where({ id: imp.turnierId }).first()).vorabankuendigung_tage, 3);
        for (const wert of [0, 15, 'abc', undefined]) {
            const kopie = JSON.parse(JSON.stringify(daten));
            kopie.turnier.vorabankuendigung_tage = wert;
            imp = await importiereTurnierDaten(ziel.knex, null, kopie);
            assert.equal((await ziel.knex('turniere').where({ id: imp.turnierId }).first()).vorabankuendigung_tage, 5, String(wert));
        }
    } finally {
        server.close();
        await db.stoppe();
        await ziel.stoppe();
    }
});
