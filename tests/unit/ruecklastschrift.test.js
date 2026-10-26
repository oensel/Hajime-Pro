import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Rücklastschrift (Startgeld Stufe 3, Task 10, Plan L9): der Ausrichter erfasst die Rückbuchung einer eingezogenen
// Lastschrift-Rechnung; die Rechnung wird 'zurueckgebucht', das Mandat widerrufen, der Zahlweg auf Überweisung/Bar
// umgestellt; der nächste Rechnungslauf erstellt genau eine neue Rechnung mit der nächsten Nummer.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
delete process.env.SMTP_HOST;
delete process.env.SUPER_ADMIN_2FA;
process.env.JWT_SECRET = 'ruecklastschrift-test-geheimnis';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'ruecklastschrift-test-schluessel-mit-mindestens-32-zeichen';

const IBAN = 'DE89370400440532013000';
const IBAN_ZAHLER = 'DE02120300000000202051';
const GLAEUBIGER_ID = 'DE98ZZZ09999999999';

const konsole = [];
for (const art of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[art].bind(console);
    mock.method(console, art, (...a) => { konsole.push(a.map((x) => (typeof x === 'string' ? x : String(x?.message ?? x))).join(' ')); original(...a); });
}

const jwt = (await import('jsonwebtoken')).default;
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');
const { erzeugeProtokollMiddleware } = await import('../../src/services/aktionsProtokoll.js');
const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { erstelleRechnungen, erfasseRuecklastschrift, setzeBezahlt, rechnungsDatenAusZeile } = await import('../../src/services/rechnungslauf.js');
const { erzeugeSepaExport } = await import('../../src/services/sepaExport.js');
const { berechneLoeschenAb, sperreMandate } = await import('../../src/services/mandate.js');
const { hatSperrendeRechnung } = await import('../../src/services/rueckspielen.js');
const { ladeAbrechnung } = await import('../../src/services/abrechnung.js');
const { verschluesseleFeld } = await import('../../src/utils/feldVerschluesselung.js');
const { maskiereIban, IBAN_MUSTER } = await import('../../src/shared/iban.js');
const { formatiereRechnungsnummer } = await import('../../src/shared/abrechnung.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const ibanIn = (text) => new RegExp(IBAN_MUSTER.source, 'i').test(String(text));
let db;
let knex;
let server;
let basis;
const mails = [];
const sende = (mail) => { mails.push(mail); };

const token = (benutzerId) => jwt.sign({ id: benutzerId }, process.env.JWT_SECRET);
async function aufruf(benutzerId, methode, pfad, body) {
    const res = await fetch(basis + pfad, {
        method: methode,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(benutzerId)}` },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let daten = null;
    if ((res.headers.get('content-type') || '').includes('json')) daten = JSON.parse(text);
    return { status: res.status, daten, text };
}
const rueck = (benutzerId, turnierId, rechnungId, body) => aufruf(benutzerId, 'POST', `/api/abrechnung/${turnierId}/rechnungen/${rechnungId}/ruecklastschrift`, body);

async function warteAuf(pruefe, { zeitlimitMs = 5000 } = {}) {
    const ende = Date.now() + zeitlimitMs;
    for (;;) {
        const wert = await pruefe();
        if (wert) return wert;
        if (Date.now() > ende) throw new Error('Bedingung nicht erfüllt (Zeitlimit).');
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

let nr = 0;
/** Ausrichter, zurückgespieltes Turnier, ein Lastschrift-Verein mit gültigem Mandat, Rechnung versandt und in einer SEPA-Datei. */
async function aufbau({ kaempfer = 2, bezahlt = 0, mitDatei = true, zweiterVerein = false } = {}) {
    nr += 1;
    const name = `JC Rueck ${nr}`;
    const praefix = `R${nr}-`;
    const vereinId = id((await knex('vereine').insert({ name }).returning('id'))[0]);
    const admin = `u-radmin-${nr}`;
    const benutzer = `u-rbenutzer-${nr}`;
    for (const [uid, rolle] of [[admin, 'admin'], [benutzer, 'benutzer']]) {
        await knex('benutzer').insert({ id: uid, email: `${uid}@test.de`, vorname: 'A', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vereinId });
        await knex('benutzer_vereine').insert({ benutzer_id: uid, verein_id: vereinId, freigegeben: 1, rolle });
    }
    await speichereStammdaten(knex, vereinId, {
        anschrift: 'Hauptstr. 1\n50667 Köln', rechnung_email: `kasse${nr}@rueck.de`, absender_name: `${name} Kasse`,
        steuernummer: '214/5717/1234', ust_hinweis: 'Steuerfrei nach § 4 Nr. 22b UStG.', rechnungs_praefix: praefix,
        kontoinhaber: `${name} e.V.`, iban: IBAN, glaeubiger_id: GLAEUBIGER_ID
    }, admin);
    const turnierId = id((await knex('turniere').insert({
        bezeichnung: 'Rheincup', ort: 'Halle', datum: '2030-05-01', ausrichter: name, verein_id: vereinId, status: 'veroeffentlicht',
        startgeld: 8, abrechnungsbasis: 'teilnahme_waage', zahlungsziel_tage: 14, vorabankuendigung_tage: 5, zurueckgespielt_am: knex.fn.now()
    }).returning('id'))[0]);
    const vName = `TSV Zahler ${nr}`;
    const [z] = await knex('turnier_zahlwege').insert({
        turnier_id: turnierId, verein_name: vName, zahlweg: 'lastschrift', rechnung_email: `z${nr}@zahler.de`,
        rechnung_ansprechperson: 'Kasse', rechnung_anschrift: 'Weg 1\n12345 Ort', mandat_gueltig: true
    }).returning('id');
    const [m] = await knex('lastschrift_mandate').insert({
        turnier_id: turnierId, turnier_bezeichnung: 'Rheincup', zahlweg_id: id(z), verein_name: vName,
        mandatsreferenz: `R${nr}M${turnierId}V${id(z)}`,
        daten_verschluesselt: verschluesseleFeld(JSON.stringify({ iban: IBAN_ZAHLER, kontoinhaber: `${vName} e.V.`, ip: '127.0.0.1' })),
        iban_maske: maskiereIban(IBAN_ZAHLER), mandatstext: 'Mandatstext', textversion: 'test', glaeubiger_id: GLAEUBIGER_ID,
        glaeubiger_name: name, status: 'gueltig', erteilt_am: '2026-01-10T10:00:00Z', erteilt_von: admin, vertretung_bestaetigt: true
    }).returning('id');
    for (let k = 0; k < kaempfer; k += 1) {
        await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, judopass_id: `RL-${nr}-${k}`, vorname: 'V', nachname: `N${k}`, geschlecht: 'm', verein: vName,
            gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, gewogen: true,
            startgeld_bezahlt: k < bezahlt, startgeld_zahlweg_gesichert: true, status: 'kampfbereit'
        });
    }
    let zweiter = null;
    if (zweiterVerein) {
        const zName = `JC Ueberweiser ${nr}`;
        await knex('turnier_zahlwege').insert({
            turnier_id: turnierId, verein_name: zName, zahlweg: 'ueberweisung', rechnung_email: `u${nr}@zahler.de`,
            rechnung_ansprechperson: 'Kasse', rechnung_anschrift: 'Weg 2\n12345 Ort'
        });
        await knex('turnier_teilnehmer').insert({
            turnier_id: turnierId, judopass_id: `RLU-${nr}`, vorname: 'V', nachname: 'U', geschlecht: 'm', verein: zName,
            gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, gewogen: true
        });
        zweiter = zName;
    }
    const turnier = () => knex('turniere').where({ id: turnierId }).first();
    const lauf = await erstelleRechnungen(knex, { turnier: await turnier(), benutzerId: admin, sende });
    assert.equal(lauf.erstellt, zweiterVerein ? 2 : 1, JSON.stringify(lauf));
    if (mitDatei) await erzeugeSepaExport(knex, { turnier: await turnier(), benutzerId: admin });
    const rechnungen = () => knex('rechnungen').where({ turnier_id: turnierId }).orderBy('id');
    const lastschrift = (await rechnungen()).find((r) => r.zahlweg === 'lastschrift');
    return { vereinId, admin, benutzer, turnierId, praefix, vName, zahlwegId: id(z), mandatId: id(m), turnier, rechnungen, lastschrift, zweiter };
}

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
    const app = express();
    app.use(express.json());
    app.use(erzeugeProtokollMiddleware(knex));
    app.use('/api/abrechnung', getAbrechnungRoutes(knex, { sende }));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    basis = `http://127.0.0.1:${server.address().port}`;
    setzeTestVersand(sende);
    await knex('benutzer').insert({ id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'A', email_bestaetigt_am: knex.fn.now(), ist_super_admin: true, super_admin_modus: true });
});

after(async () => {
    setzeTestVersand(null);
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.stoppe();
});

test('Kompletter Kreislauf Überweisung: zurückgebucht, Mandat widerrufen, neue Rechnung mit nächster Nummer, alte unverändert', async () => {
    const a = await aufbau({ kaempfer: 2, bezahlt: 1 });
    const alt = a.lastschrift;
    assert.equal(alt.nummer, formatiereRechnungsnummer(a.praefix, 1));
    assert.ok(alt.sepa_datei_id, 'Rechnung steht in einer SEPA-Datei');
    assert.equal(alt.bar_erhalten_cent, 0, 'Lastschrift rechnet bezahlte Kämpfer nicht an (E9)');
    const mandatVorher = await knex('lastschrift_mandate').where({ id: a.mandatId }).first();
    assert.ok(mandatVorher.letzter_einzug_am);
    const statusVorher = (await knex('turnier_teilnehmer').where({ turnier_id: a.turnierId }).orderBy('id')).map((t) => t.status);

    // Vor der Rücklastschrift sperrt die versandte Rechnung das Zurückspielen
    assert.equal(await hatSperrendeRechnung(knex, a.turnierId), true);

    const r = await rueck(a.admin, a.turnierId, alt.id, { neuerZahlweg: 'ueberweisung' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.daten.success, true);
    assert.equal(r.daten.rechnung.status, 'zurueckgebucht');
    assert.equal(r.daten.rechnung.anzeigeStatus, 'zurueckgebucht');
    assert.equal(r.daten.zahlweg.zahlweg, 'ueberweisung');
    assert.ok(!ibanIn(r.text), 'keine IBAN in der Antwort');

    // Alte Rechnung: nur Status, zurueckgebucht_am und updated_at geändert
    const altNachher = await knex('rechnungen').where({ id: alt.id }).first();
    assert.equal(altNachher.status, 'zurueckgebucht');
    assert.ok(altNachher.zurueckgebucht_am);
    const ohne = (x) => { const { status, zurueckgebucht_am: zb, updated_at: u, ...rest } = x; return rest; };
    assert.deepEqual(ohne(altNachher), ohne(alt));

    // Mandat widerrufen (L12: Löschfrist ab dem letzten Einzug, der bleibt), Klartext gelöscht
    const mandat = await knex('lastschrift_mandate').where({ id: a.mandatId }).first();
    assert.equal(mandat.status, 'widerrufen');
    assert.equal(mandat.daten_verschluesselt, null);
    assert.equal(mandat.letzter_einzug_am, mandatVorher.letzter_einzug_am);
    assert.equal(mandat.loeschen_ab, berechneLoeschenAb(mandatVorher.letzter_einzug_am));

    // Zahlweg umgestellt (nach dem Anmeldeschluss), Überweisung gilt als gesichert; Status der Kämpfer unverändert
    const zw = await knex('turnier_zahlwege').where({ id: a.zahlwegId }).first();
    assert.deepEqual([zw.zahlweg, zw.mandat_gueltig, zw.geaendert_von], ['ueberweisung', false, a.admin]);
    const tn = await knex('turnier_teilnehmer').where({ turnier_id: a.turnierId }).orderBy('id');
    assert.ok(tn.every((t) => t.startgeld_zahlweg_gesichert === true));
    assert.deepEqual(tn.map((t) => t.status), statusVorher);

    // Zweite Erfassung → 409; Zahlstatus der zurückgebuchten Rechnung nicht änderbar
    const zweite = await rueck(a.admin, a.turnierId, alt.id, { neuerZahlweg: 'bar' });
    assert.equal(zweite.status, 409, zweite.text);
    assert.equal((await knex('turnier_zahlwege').where({ id: a.zahlwegId }).first()).zahlweg, 'ueberweisung');
    await assert.rejects(setzeBezahlt(knex, alt.id, { bezahlt: true, benutzerId: a.admin }), (e) => e.statusCode === 409);

    // Nur zurückgebuchte Rechnungen sperren das Zurückspielen nicht
    assert.equal(await hatSperrendeRechnung(knex, a.turnierId), false);

    // Übersicht: Verein wieder ohne Rechnung, Lauf möglich
    const abr = await ladeAbrechnung(knex, await a.turnier());
    const zeile = abr.vereine.find((v) => v.vereinName === a.vName);
    assert.equal(zeile.rechnung, null);
    assert.equal(zeile.zahlweg, 'ueberweisung');

    // Neuer Lauf: genau eine neue Überweisungs-Rechnung mit der nächsten Nummer, Anrechnung des bezahlten Kämpfers (E9)
    mails.length = 0;
    const lauf = await erstelleRechnungen(knex, { turnier: await a.turnier(), benutzerId: a.admin, sende });
    assert.equal(lauf.erstellt, 1, JSON.stringify(lauf));
    assert.equal(lauf.versendet, 1, JSON.stringify(lauf));
    const alle = await a.rechnungen();
    assert.equal(alle.length, 2);
    const neu = alle[1];
    assert.equal(neu.nummer, formatiereRechnungsnummer(a.praefix, 2));
    assert.deepEqual([neu.zahlweg, neu.art, neu.status, neu.anzahl, neu.betrag_cent, neu.bar_erhalten_cent], ['ueberweisung', 'rechnung', 'versandt', 2, 1600, 800]);
    assert.ok(neu.zahlungsziel_datum, 'Überweisung mit Zahlungsziel');
    assert.deepEqual([neu.mandat_id, neu.mandatsreferenz, neu.iban_maske_zahler, neu.einzug_am, neu.sepa_datei_id], [null, null, null, null, null]);
    // Girocode/IBAN des Ausrichters: die Rechnungsdaten tragen das Konto für die Überweisung
    const daten = rechnungsDatenAusZeile(neu, { iban: IBAN });
    assert.equal(daten.lastschrift, null);
    assert.equal(daten.zahlung.iban, IBAN);
    assert.equal(mails.length, 1);
    assert.ok(!/Lastschrift/.test(mails[0].subject));
    assert.match(mails[0].text, /überweisen Sie den offenen Betrag von 8,00/);
    assert.deepEqual(await knex('rechnungen').where({ id: alt.id }).first(), altNachher, 'alte Rechnung bleibt');

    // Die neue versandte Rechnung sperrt das Zurückspielen wieder wie üblich; ein weiterer Lauf erstellt nichts
    assert.equal(await hatSperrendeRechnung(knex, a.turnierId), true);
    assert.equal((await erstelleRechnungen(knex, { turnier: await a.turnier(), benutzerId: a.admin, sende })).erstellt, 0);
    // Eine Überweisungs-Rechnung lässt sich nicht zurückbuchen
    assert.equal((await rueck(a.admin, a.turnierId, neu.id, { neuerZahlweg: 'bar' })).status, 400);

    // Protokoll: ein Eintrag mit Rechnung/Zahlweg, keine IBAN; Mandatswiderruf protokolliert
    const eintrag = await warteAuf(async () => (await knex('aktionsprotokoll').where({ aktion: 'abrechnung.ruecklastschrift', turnier_id: a.turnierId }))[0]);
    assert.equal(eintrag.beschreibung, 'Rücklastschrift erfasst und Zahlweg umgestellt');
    assert.equal(eintrag.benutzer_id, a.admin);
    const details = typeof eintrag.details === 'string' ? JSON.parse(eintrag.details) : eintrag.details;
    assert.deepEqual([details.rechnungId, details.neuerZahlweg, details.mandatId], [alt.id, 'ueberweisung', a.mandatId]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal((await knex('aktionsprotokoll').where({ aktion: 'abrechnung.ruecklastschrift', turnier_id: a.turnierId })).length, 1);
    assert.ok((await knex('aktionsprotokoll').where({ aktion: 'mandat.widerrufen' })).some((e) => {
        const d = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
        return d.mandatId === a.mandatId;
    }));
    assert.ok(!ibanIn(JSON.stringify(await knex('aktionsprotokoll').select('*'))), 'keine IBAN im Protokoll');
    assert.ok(!konsole.join('\n').includes(IBAN_ZAHLER), 'keine IBAN in der Konsole');
});

test('Umstellung auf Bar: alle Kämpfer bezahlt → Quittung; offene Kämpfer → Bar-Rechnung mit Rest; nicht gesichert', async () => {
    const a = await aufbau({ kaempfer: 2, bezahlt: 2 });
    const r = await rueck(a.admin, a.turnierId, a.lastschrift.id, { neuerZahlweg: 'bar' });
    assert.equal(r.status, 200, r.text);
    assert.equal((await knex('turnier_zahlwege').where({ id: a.zahlwegId }).first()).zahlweg, 'bar');
    const tn = await knex('turnier_teilnehmer').where({ turnier_id: a.turnierId });
    assert.ok(tn.every((t) => t.startgeld_zahlweg_gesichert === false), 'Bar ist nicht gesichert');
    assert.ok(tn.every((t) => t.status === 'kampfbereit'), 'Status wird nicht neu abgeleitet');
    const lauf = await erstelleRechnungen(knex, { turnier: await a.turnier(), benutzerId: a.admin, sende });
    assert.equal(lauf.erstellt, 1, JSON.stringify(lauf));
    const neu = (await a.rechnungen())[1];
    assert.deepEqual([neu.zahlweg, neu.art, neu.status, neu.nummer], ['bar', 'quittung', 'bezahlt', formatiereRechnungsnummer(a.praefix, 2)]);

    const b = await aufbau({ kaempfer: 3, bezahlt: 1 });
    assert.equal((await rueck(b.admin, b.turnierId, b.lastschrift.id, { neuerZahlweg: 'bar' })).status, 200);
    await erstelleRechnungen(knex, { turnier: await b.turnier(), benutzerId: b.admin, sende });
    const neuB = (await b.rechnungen())[1];
    assert.deepEqual([neuB.zahlweg, neuB.art, neuB.betrag_cent, neuB.bar_erhalten_cent], ['bar', 'rechnung', 2400, 800]);
});

test('Ablehnungen: ohne Datei, Überweisung, falscher Zahlweg, fremdes Turnier (IDOR), Rechte, abgesagt', async () => {
    const a = await aufbau({ mitDatei: false, zweiterVerein: true });
    const ohneDatei = await rueck(a.admin, a.turnierId, a.lastschrift.id, { neuerZahlweg: 'ueberweisung' });
    assert.equal(ohneDatei.status, 400, ohneDatei.text);
    assert.match(ohneDatei.daten.error, /SEPA-Datei/);
    const ueberweisung = (await a.rechnungen()).find((r) => r.zahlweg === 'ueberweisung');
    const uw = await rueck(a.admin, a.turnierId, ueberweisung.id, { neuerZahlweg: 'bar' });
    assert.equal(uw.status, 400, uw.text);
    assert.match(uw.daten.error, /Lastschrift/);

    const b = await aufbau();
    for (const body of [{}, { neuerZahlweg: 'lastschrift' }, { neuerZahlweg: 'scheck' }, { neuerZahlweg: ['bar'] }]) {
        assert.equal((await rueck(b.admin, b.turnierId, b.lastschrift.id, body)).status, 400, JSON.stringify(body));
    }
    // Rechnung eines anderen Turniers über das eigene Turnier → 404; fremder Admin auf fremdes Turnier → 403
    assert.equal((await rueck(a.admin, a.turnierId, b.lastschrift.id, { neuerZahlweg: 'bar' })).status, 404);
    assert.equal((await rueck(a.admin, b.turnierId, b.lastschrift.id, { neuerZahlweg: 'bar' })).status, 403);
    assert.equal((await rueck(b.benutzer, b.turnierId, b.lastschrift.id, { neuerZahlweg: 'bar' })).status, 403);
    assert.equal((await rueck(b.admin, b.turnierId, 'abc', { neuerZahlweg: 'bar' })).status, 404);
    // Abgesagtes Turnier → 400
    await knex('turniere').where({ id: b.turnierId }).update({ status: 'abgesagt' });
    const abgesagt = await rueck(b.admin, b.turnierId, b.lastschrift.id, { neuerZahlweg: 'bar' });
    assert.equal(abgesagt.status, 400, abgesagt.text);
    // Nichts geändert
    const stand = await knex('rechnungen').where({ id: b.lastschrift.id }).first();
    assert.equal(stand.status, 'versandt');
    assert.equal((await knex('lastschrift_mandate').where({ id: b.mandatId }).first()).status, 'gueltig');
    assert.equal((await knex('turnier_zahlwege').where({ id: b.zahlwegId }).first()).zahlweg, 'lastschrift');
    assert.equal((await knex('rechnungen').where({ id: a.lastschrift.id }).first()).status, 'versandt');

    // Auch eine von Hand als bezahlt markierte Lastschrift kann zurückgebucht werden; Super-Admin ohne 2FA-Code
    const c = await aufbau();
    await setzeBezahlt(knex, c.lastschrift.id, { bezahlt: true, benutzerId: c.admin });
    const sa = await rueck('u-super', c.turnierId, c.lastschrift.id, { neuerZahlweg: 'ueberweisung' });
    assert.equal(sa.status, 200, sa.text);
    assert.equal((await knex('rechnungen').where({ id: c.lastschrift.id }).first()).status, 'zurueckgebucht');
});

test('Freigabe des Zurückspielens: nur zurückgebuchte Rechnungen brauchen keine Freigabe', async () => {
    const a = await aufbau();
    assert.equal((await rueck(a.admin, a.turnierId, a.lastschrift.id, { neuerZahlweg: 'ueberweisung' })).status, 200);
    const frei = await aufruf(a.admin, 'POST', `/api/abrechnung/${a.turnierId}/rueckspielen-freigeben`, {});
    assert.equal(frei.status, 400, frei.text);
});

test('Sperren: wartet auf den Mandats-Lock des Vereins; gleichzeitige Erfassungen und SEPA-Neuerzeugung ohne Deadlock', async () => {
    const a = await aufbau();
    // Ein fremder Vorgang hält den Mandats-Lock (Turnier, Verein): die Erfassung wartet, bis er endet.
    let freigeben;
    const gehalten = new Promise((resolve) => { freigeben = resolve; });
    let gesperrt;
    const istGesperrt = new Promise((resolve) => { gesperrt = resolve; });
    const halter = knex.transaction(async (trx) => {
        await sperreMandate(trx, a.turnierId, a.vName);
        gesperrt();
        await gehalten;
    });
    await istGesperrt;
    let fertig = false;
    const erfassung = erfasseRuecklastschrift(knex, { turnier: await a.turnier(), rechnungId: a.lastschrift.id, neuerZahlweg: 'ueberweisung', benutzerId: a.admin })
        .then((x) => { fertig = true; return x; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fertig, false, 'Erfassung wartet auf den Mandats-Lock');
    assert.equal((await knex('rechnungen').where({ id: a.lastschrift.id }).first()).status, 'versandt');
    freigeben();
    await halter;
    const ergebnis = await erfassung;
    assert.equal(ergebnis.rechnung.status, 'zurueckgebucht');

    // Zwei gleichzeitige Erfassungen: genau eine gewinnt, die andere 409
    const b = await aufbau();
    const turnierB = await b.turnier();
    const beide = await Promise.allSettled([
        erfasseRuecklastschrift(knex, { turnier: turnierB, rechnungId: b.lastschrift.id, neuerZahlweg: 'ueberweisung', benutzerId: b.admin }),
        erfasseRuecklastschrift(knex, { turnier: turnierB, rechnungId: b.lastschrift.id, neuerZahlweg: 'bar', benutzerId: b.admin })
    ]);
    assert.equal(beide.filter((x) => x.status === 'fulfilled').length, 1);
    const abgelehnt = beide.find((x) => x.status === 'rejected');
    assert.equal(abgelehnt.reason.statusCode, 409, String(abgelehnt.reason));
    const gewinner = beide.find((x) => x.status === 'fulfilled').value;
    assert.equal((await knex('turnier_zahlwege').where({ id: b.zahlwegId }).first()).zahlweg, gewinner.zahlweg.zahlweg);

    // Gleichzeitig: Rücklastschrift und SEPA-Datei neu (dieselbe Rechnung) — kein Deadlock, Ergebnis eindeutig
    for (let i = 0; i < 3; i += 1) {
        const c = await aufbau();
        const turnierC = await c.turnier();
        const [rl, neuDatei] = await Promise.allSettled([
            erfasseRuecklastschrift(knex, { turnier: turnierC, rechnungId: c.lastschrift.id, neuerZahlweg: 'ueberweisung', benutzerId: c.admin }),
            erzeugeSepaExport(knex, { turnier: turnierC, benutzerId: c.admin, neu: true, rechnungIds: [c.lastschrift.id] })
        ]);
        for (const x of [rl, neuDatei]) {
            if (x.status === 'rejected') assert.ok(x.reason?.statusCode >= 400 && x.reason?.statusCode < 500, `kein Deadlock/500: ${x.reason?.code} ${x.reason?.message}`);
        }
        assert.equal(rl.status, 'fulfilled', String(rl.reason));
        assert.equal((await knex('rechnungen').where({ id: c.lastschrift.id }).first()).status, 'zurueckgebucht');
    }
});
