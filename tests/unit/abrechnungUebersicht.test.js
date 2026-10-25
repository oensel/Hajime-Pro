import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Abrechnungsübersicht (Task 8): Bereitschaft, Zählung je Verein, "Nicht zugeordnet" und deren Auflösung.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'abrechnung-uebersicht-test-geheimnis';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'abrechnung-test-schluessel-mit-mindestens-32-zeichen';

const jwt = (await import('jsonwebtoken')).default;
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
let nr = 0;
async function tn(knex, turnierId, verein, extra = {}) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `A-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, ...extra
    }).returning('id'))[0]);
}
const zw = (knex, turnierId, name, zahlweg) => knex('turnier_zahlwege').insert({
    turnier_id: turnierId, verein_name: name, zahlweg, rechnung_email: 'k@x.de', rechnung_ansprechperson: 'A', rechnung_anschrift: 'Weg 1'
});

test('Abrechnung: Übersicht, Bereitschaft und Zuordnen', async () => {
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
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        for (const [n, rolle] of [['admin', 'admin'], ['benutzer', 'benutzer']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vAus });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: vAus, freigegeben: 1, rolle });
        }
        await knex('benutzer').insert({ id: 'u-super', email: 'super@test.de', vorname: 's', nachname: 'T', email_bestaetigt_am: knex.fn.now(), ist_super_admin: true, super_admin_modus: true });
        const neuesTurnier = async (extra = {}) => id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: 'JC Ausrichter', verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, ...extra
        }).returning('id'))[0]);

        const t = await neuesTurnier();
        await zw(knex, t, 'JC A', 'ueberweisung');
        await zw(knex, t, 'JC B', 'bar');
        await zw(knex, t, 'JC Köln e.V.', 'ueberweisung');
        await tn(knex, t, 'JC A');
        await tn(knex, t, '  jc a ', { gewogen: true });          // andere Schreibweise zählt zum selben Verein
        await tn(knex, t, 'JC A', { status: 'zurueckgezogen' });    // zählt nicht
        for (let i = 0; i < 3; i += 1) await tn(knex, t, 'JC B', { startgeld_bezahlt: true });
        await tn(knex, t, 'JC Ausrichter');                         // Ausrichter zählt nicht
        const koeln = await tn(knex, t, 'JC Köln e.V');             // ohne Zahlweg-Zeile
        await tn(knex, t, '');                                      // ohne Verein: darf nie still fehlen
        await tn(knex, t, '   ');

        // nicht zurückgespielt
        let r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.bereit, false);
        assert.equal(r.daten.grund, 'Das Turnier wurde noch nicht vom Hallen-Server zurückgespielt.');

        // Rechte
        assert.equal((await aufruf('u-benutzer', 'GET', `/api/abrechnung/${t}`)).status, 403);
        assert.equal((await aufruf('u-super', 'GET', `/api/abrechnung/${t}`)).status, 200);

        await knex('turniere').where({ id: t }).update({ zurueckgespielt_am: knex.fn.now() });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t}`);
        assert.equal(r.daten.bereit, true);
        assert.equal(r.daten.grund, null);
        assert.equal(r.daten.basis, 'gemeldet');
        assert.equal(r.daten.startgeldCent, 800);
        const a = r.daten.vereine.find((v) => v.vereinName === 'JC A');
        assert.deepEqual([a.zahlweg, a.anzahl, a.bezahltAnzahl, a.betragCent, a.rechnung], ['ueberweisung', 2, 0, 1600, null]);
        const b = r.daten.vereine.find((v) => v.vereinName === 'JC B');
        assert.deepEqual([b.zahlweg, b.anzahl, b.bezahltAnzahl, b.betragCent], ['bar', 3, 3, 2400]);
        const k = r.daten.vereine.find((v) => v.vereinName === 'JC Köln e.V.');
        assert.deepEqual([k.anzahl, k.betragCent], [0, 0]);
        assert.equal(r.daten.vereine.length, 3);
        assert.equal(r.daten.summeCent, 4000);
        assert.deepEqual(
            [...r.daten.nichtZugeordnet].sort((x, y) => x.vereinName.localeCompare(y.vereinName)),
            [{ vereinName: '', anzahl: 2 }, { vereinName: 'JC Köln e.V', anzahl: 1 }]
        );
        assert.equal(r.daten.stammdaten.vollstaendig, false);

        // Rechnung erscheint am Verein (mit Anzeigestatus)
        await knex('rechnungen').insert({
            turnier_id: t, aussteller_verein_id: vAus, verein_name: 'JC A', zahlweg: 'ueberweisung', art: 'rechnung', nummer: 'X-00001',
            rechnungsdatum: '2030-05-02', zahlungsziel_datum: '2020-05-03', anzahl: 2, einzelpreis_cent: 800, betrag_cent: 1600,
            positionen: '[]', empfaenger: '{}', aussteller: '{}', status: 'versandt', versandt_am: knex.fn.now()
        });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t}`);
        const a2 = r.daten.vereine.find((v) => v.vereinName === 'JC A');
        assert.equal(a2.rechnung.nummer, 'X-00001');
        assert.equal(a2.rechnung.status, 'versandt');
        assert.equal(a2.rechnung.anzeigeStatus, 'ueberfaellig');

        // Zuordnen
        assert.equal((await aufruf('u-benutzer', 'POST', `/api/abrechnung/${t}/zuordnen`, { vonVereinName: 'JC Köln e.V', zuVereinName: 'JC Köln e.V.' })).status, 403);
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/zuordnen`, { vonVereinName: 'JC Köln e.V', zuVereinName: 'Gibt es nicht' })).status, 400);
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/zuordnen`, { vonVereinName: 'JC A', zuVereinName: 'JC B' })).status, 400); // Quelle hat Zahlweg
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/zuordnen`, { vonVereinName: 'JC Köln e.V', zuVereinName: 'JC Köln e.V.' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual([r.daten.success, r.daten.anzahl], [true, 1]);
        assert.equal((await knex('turnier_teilnehmer').where({ id: koeln }).first()).verein, 'JC Köln e.V.');
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/zuordnen`, { vonVereinName: '', zuVereinName: 'JC A' });
        assert.equal(r.daten.anzahl, 2);
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t}`);
        assert.deepEqual(r.daten.nichtZugeordnet, []);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC Köln e.V.').anzahl, 1);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').anzahl, 4);

        // Rückspiel-Freigabe: erst nach versandter Rechnung
        const t2 = await neuesTurnier();
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t2}/rueckspielen-freigeben`)).status, 400);
        assert.equal((await aufruf('u-benutzer', 'POST', `/api/abrechnung/${t}/rueckspielen-freigeben`)).status, 403);
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/rueckspielen-freigeben`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal((await knex('turniere').where({ id: t }).first()).rueckspielen_freigegeben, true);

        // Basis teilnahme_waage zählt nur Gewogene
        await knex('turniere').where({ id: t }).update({ abrechnungsbasis: 'teilnahme_waage' });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t}`);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').anzahl, 1);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC B').anzahl, 0);

        // Rechnungsdaten vor Ort (neuer Verein, Bar)
        await knex('turniere').where({ id: t }).update({ abrechnungsbasis: 'gemeldet' });
        await tn(knex, t, 'JC Neu');
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t}/rechnungsdaten`, { vereinName: 'JC Neu', rechnung_email: 'neu@x.de', rechnung_ansprechperson: 'N', rechnung_anschrift: 'Neuweg 1' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: t, verein_name: 'JC Neu' }).first()).zahlweg, 'bar');

        // Bereitschaft: kein Startgeld; Cloud-Live ohne Holen
        const t3 = await neuesTurnier({ startgeld: 0 });
        await knex('turniere').where({ id: t3 }).update({ zurueckgespielt_am: knex.fn.now() });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t3}`);
        assert.deepEqual([r.daten.bereit, r.daten.grund], [false, 'Für dieses Turnier wird kein Startgeld erhoben.']);

        const t4 = await neuesTurnier();
        await knex('cloud_live').insert({ turnier_id: t4, schluessel: 's4', geheimnis: 'g', code: '123456', instanz_id: 'i', app_geheimnis: 'a', gueltig_bis: knex.fn.now() });
        assert.equal((await aufruf('u-admin', 'GET', `/api/abrechnung/${t4}`)).daten.bereit, false);
        await knex('cloud_live').where({ turnier_id: t4 }).update({ beendet_am: knex.fn.now() });
        assert.equal((await aufruf('u-admin', 'GET', `/api/abrechnung/${t4}`)).daten.bereit, true);
        await knex('turniere').where({ id: t4 }).update({ auf_hallen_server_geholt_am: knex.fn.now() });
        assert.equal((await aufruf('u-admin', 'GET', `/api/abrechnung/${t4}`)).daten.bereit, false);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
