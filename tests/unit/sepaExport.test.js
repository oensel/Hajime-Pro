import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// SEPA-Download (Startgeld Stufe 3, Task 9): Datei nur aus versandten Lastschrift-Rechnungen, Merker gegen Doppeleinzug,
// Prüfung von Mandat/Gläubiger-ID beim Erzeugen, Fälligkeit nie in der Vergangenheit, Rechte und 2FA, Protokoll ohne IBAN.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
delete process.env.SMTP_HOST;
delete process.env.SUPER_ADMIN_2FA;
process.env.JWT_SECRET = 'sepa-export-test-geheimnis';
const SCHLUESSEL = 'sepa-export-test-schluessel-mit-mindestens-32-zeichen';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;

const IBAN = 'DE89370400440532013000';
const IBAN_ZAHLER = 'DE02120300000000202051';
const IBAN_ZAHLER_2 = 'DE12500105170648489890';
const GLAEUBIGER_ID = 'DE98ZZZ09999999999';

const konsole = [];
for (const art of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[art].bind(console);
    mock.method(console, art, (...a) => { konsole.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); original(...a); });
}

const jwt = (await import('jsonwebtoken')).default;
const { getAbrechnungRoutes } = await import('../../src/routes/abrechnungRoutes.js');
const { erzeugeProtokollMiddleware } = await import('../../src/services/aktionsProtokoll.js');
const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { erstelleRechnungen } = await import('../../src/services/rechnungslauf.js');
const { erzeugeSepaExport, MELDUNG_SCHON_DATEI } = await import('../../src/services/sepaExport.js');
const { berechneLoeschenAb } = await import('../../src/services/mandate.js');
const { naechsterGeschaeftstag, addiereGeschaeftstage } = await import('../../src/shared/targetKalender.js');
const { verschluesseleFeld } = await import('../../src/utils/feldVerschluesselung.js');
const { maskiereIban, IBAN_MUSTER } = await import('../../src/shared/iban.js');
const { heuteBerlin, addiereTage } = await import('../../src/shared/abrechnung.js');
const { starteEinrichtung, bestaetigeEinrichtung } = await import('../../src/services/zweiFaktor.js');
const { totpCode, schrittFuer } = await import('../../src/utils/totp.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const ibanIn = (text) => new RegExp(IBAN_MUSTER.source, 'i').test(String(text));
let db;
let knex;
let server;
let basis;
const mails = [];

const token = (benutzerId, extra = {}) => jwt.sign({ id: benutzerId, ...extra }, process.env.JWT_SECRET);
async function aufruf(benutzerId, methode, pfad, body, { zf, code } = {}) {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token(benutzerId, zf !== undefined ? { zf } : {})}` };
    if (code) headers['X-2FA-Code'] = code;
    const res = await fetch(basis + pfad, { method: methode, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let daten = null;
    if ((res.headers.get('content-type') || '').includes('json')) daten = JSON.parse(text);
    return { status: res.status, daten, text, headers: res.headers };
}
const sepa = (benutzerId, turnierId, body = {}, optionen) => aufruf(benutzerId, 'POST', `/api/abrechnung/${turnierId}/sepa`, body, optionen);
const anzahlPosten = (xml) => (xml.match(/<DrctDbtTxInf>/g) || []).length;

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
/** Ausrichter mit vollständigen Stammdaten, Turnier (zurückgespielt) und n Lastschrift-Vereinen mit gültigem Mandat. */
async function aufbau({ vereine = 2, mitRechnungen = true } = {}) {
    nr += 1;
    const name = `JC Sepa ${nr}`;
    const vereinId = id((await knex('vereine').insert({ name }).returning('id'))[0]);
    const admin = `u-sadmin-${nr}`;
    const benutzer = `u-sbenutzer-${nr}`;
    for (const [uid, rolle] of [[admin, 'admin'], [benutzer, 'benutzer']]) {
        await knex('benutzer').insert({ id: uid, email: `${uid}@test.de`, vorname: 'A', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vereinId });
        await knex('benutzer_vereine').insert({ benutzer_id: uid, verein_id: vereinId, freigegeben: 1, rolle });
    }
    await speichereStammdaten(knex, vereinId, {
        anschrift: 'Hauptstr. 1\n50667 Köln', rechnung_email: `kasse${nr}@sepa.de`, absender_name: `${name} Kasse`,
        steuernummer: '214/5717/1234', ust_hinweis: 'Steuerfrei nach § 4 Nr. 22b UStG.', rechnungs_praefix: `S${nr}-`,
        kontoinhaber: `${name} e.V.`, iban: IBAN, glaeubiger_id: GLAEUBIGER_ID
    }, admin);
    const turnierId = id((await knex('turniere').insert({
        bezeichnung: 'Domstadt-Cup & <Söhne>', ort: 'Halle', datum: '2030-05-01', ausrichter: name, verein_id: vereinId, status: 'veroeffentlicht',
        startgeld: 8, abrechnungsbasis: 'teilnahme_waage', zahlungsziel_tage: 14, vorabankuendigung_tage: 5, zurueckgespielt_am: knex.fn.now()
    }).returning('id'))[0]);
    const zahler = [];
    for (let i = 1; i <= vereine; i += 1) {
        const vName = `TSV Zahler ${nr}-${i}`;
        const [z] = await knex('turnier_zahlwege').insert({
            turnier_id: turnierId, verein_name: vName, zahlweg: 'lastschrift', rechnung_email: `z${nr}-${i}@zahler.de`,
            rechnung_ansprechperson: 'Kasse', rechnung_anschrift: 'Weg 1\n12345 Ort', mandat_gueltig: true
        }).returning('id');
        const iban = i % 2 ? IBAN_ZAHLER : IBAN_ZAHLER_2;
        const [m] = await knex('lastschrift_mandate').insert({
            turnier_id: turnierId, turnier_bezeichnung: 'Domstadt-Cup', zahlweg_id: id(z), verein_name: vName,
            mandatsreferenz: `S${nr}M${turnierId}V${id(z)}`,
            daten_verschluesselt: verschluesseleFeld(JSON.stringify({ iban, kontoinhaber: `${vName} & Söhne e.V.`, ip: '127.0.0.1' })),
            iban_maske: maskiereIban(iban), mandatstext: 'Mandatstext', textversion: 'test', glaeubiger_id: GLAEUBIGER_ID,
            glaeubiger_name: name, status: 'gueltig', erteilt_am: '2026-01-10T10:00:00Z', erteilt_von: admin, vertretung_bestaetigt: true
        }).returning('id');
        for (let k = 0; k < i + 1; k += 1) {
            await knex('turnier_teilnehmer').insert({
                turnier_id: turnierId, judopass_id: `SP-${nr}-${i}-${k}`, vorname: 'V', nachname: `N${k}`, geschlecht: 'm', verein: vName,
                gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, gewogen: true
            });
        }
        zahler.push({ name: vName, zahlwegId: id(z), mandatId: id(m) });
    }
    const turnier = () => knex('turniere').where({ id: turnierId }).first();
    if (mitRechnungen) {
        const lauf = await erstelleRechnungen(knex, { turnier: await turnier(), benutzerId: admin, sende: (mail) => { mails.push(mail); } });
        assert.equal(lauf.erstellt, vereine, JSON.stringify(lauf));
        assert.equal(lauf.versendet, vereine, JSON.stringify(lauf));
    }
    const rechnungen = () => knex('rechnungen').where({ turnier_id: turnierId }).orderBy('id')
        .select('*', knex.raw("to_char(einzug_am, 'YYYY-MM-DD') as einzug_text"));
    return { vereinId, admin, benutzer, turnierId, zahler, turnier, rechnungen };
}

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
    const app = express();
    app.use(express.json());
    app.use(erzeugeProtokollMiddleware(knex));
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    basis = `http://127.0.0.1:${server.address().port}`;
    setzeTestVersand((mail) => { mails.push(mail); });
    await knex('benutzer').insert({ id: 'u-super', email: 'super@test.de', vorname: 'S', nachname: 'A', email_bestaetigt_am: knex.fn.now(), ist_super_admin: true, super_admin_modus: true });
});

after(async () => {
    setzeTestVersand(null);
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.stoppe();
});

test('Erster Download: Datei mit allen versandten Lastschriften, Merker gesetzt, zweiter Download 409, neu nur die gewählte', async () => {
    const a = await aufbau({ vereine: 2 });
    const heute = heuteBerlin();
    const vorher = await a.rechnungen();
    assert.deepEqual(vorher.map((r) => r.status), ['versandt', 'versandt']);
    const angekuendigt = vorher[0].einzug_text;
    assert.ok(angekuendigt > heute);

    const r = await sepa(a.admin, a.turnierId);
    assert.equal(r.status, 200, r.text);
    assert.match(r.headers.get('content-type'), /application\/xml/);
    assert.equal(r.headers.get('content-disposition'), `attachment; filename="sepa-lastschrift-${a.turnierId}-${heute}.xml"`);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('x-sepa-warnung'), null);
    assert.equal(anzahlPosten(r.text), 2);
    assert.match(r.text, /urn:iso:std:iso:20022:tech:xsd:pain\.008\.001\.08/);
    assert.ok(r.text.includes(IBAN_ZAHLER) && r.text.includes(IBAN_ZAHLER_2), 'Klar-IBANs der Zahler im XML');
    assert.ok(r.text.includes(`<IBAN>${IBAN}</IBAN>`), 'Konto des Ausrichters im XML');
    assert.equal((r.text.match(/<Id>DE98ZZZ09999999999<\/Id>/g) || []).length, 1, 'genau eine Gläubiger-ID');
    assert.ok(r.text.includes(`<ReqdColltnDt>${angekuendigt}</ReqdColltnDt>`));
    assert.ok(r.text.includes('<CtrlSum>40.00</CtrlSum>'), 'zwei + drei Kämpfer à 8 EUR');
    if (process.env.SEPA_XML_AUSGABE) fs.writeFileSync(process.env.SEPA_XML_AUSGABE, r.text);

    const dateien = await knex('sepa_dateien').where({ turnier_id: a.turnierId });
    assert.equal(dateien.length, 1);
    assert.deepEqual([dateien[0].anzahl, dateien[0].summe_cent, dateien[0].faelligkeit, dateien[0].erzeugt_von], [2, 4000, angekuendigt, a.admin]);
    assert.ok(dateien[0].msg_id.length <= 35 && !/\s/.test(dateien[0].msg_id));
    const nachher = await a.rechnungen();
    assert.ok(nachher.every((x) => x.sepa_datei_id === dateien[0].id && x.einzug_text === angekuendigt));
    for (const z of a.zahler) {
        const m = await knex('lastschrift_mandate').where({ id: z.mandatId }).first();
        assert.equal(m.letzter_einzug_am, angekuendigt);
        assert.equal(m.loeschen_ab, berechneLoeschenAb(angekuendigt));
    }
    // Keine Spalte speichert XML oder Klar-IBAN
    assert.ok(!ibanIn(JSON.stringify(await knex('sepa_dateien').select('*'))));

    // Übersicht der Dateien
    const liste = await aufruf(a.admin, 'GET', `/api/abrechnung/${a.turnierId}/sepa`);
    assert.equal(liste.status, 200);
    assert.equal(liste.daten.dateien.length, 1);
    assert.deepEqual(Object.keys(liste.daten.dateien[0]).sort(), ['anzahl', 'erzeugt_am', 'faelligkeit', 'id', 'summe_cent']);
    assert.equal(liste.daten.dateien[0].faelligkeit, angekuendigt);

    // Zweiter Download ohne neu → 409
    const zweiter = await sepa(a.admin, a.turnierId);
    assert.equal(zweiter.status, 409);
    assert.equal(zweiter.daten.error, MELDUNG_SCHON_DATEI);
    assert.equal(await knex('sepa_dateien').where({ turnier_id: a.turnierId }).count({ n: '*' }).first().then((x) => Number(x.n)), 1);

    // rechnungIds ohne neu → 400
    assert.equal((await sepa(a.admin, a.turnierId, { rechnungIds: [nachher[0].id] })).status, 400);
    // neu ohne Auswahl → 400
    assert.equal((await sepa(a.admin, a.turnierId, { neu: true })).status, 400);
    assert.equal((await sepa(a.admin, a.turnierId, { neu: true, rechnungIds: ['1'] })).status, 400);

    // neu mit einer Rechnung → ein Posten
    const neu = await sepa(a.admin, a.turnierId, { neu: true, rechnungIds: [nachher[1].id] });
    assert.equal(neu.status, 200, neu.text);
    assert.equal(anzahlPosten(neu.text), 1);
    assert.ok(neu.text.includes(`<EndToEndId>${nachher[1].nummer}</EndToEndId>`));
    const dateien2 = await knex('sepa_dateien').where({ turnier_id: a.turnierId }).orderBy('id');
    assert.equal(dateien2.length, 2);
    const nach2 = await a.rechnungen();
    assert.equal(nach2[0].sepa_datei_id, dateien2[0].id);
    assert.equal(nach2[1].sepa_datei_id, dateien2[1].id);

    // Rechnung eines anderen Turniers → 400, nichts geändert
    const b = await aufbau({ vereine: 1 });
    const fremd = (await b.rechnungen())[0];
    const quer = await sepa(a.admin, a.turnierId, { neu: true, rechnungIds: [fremd.id] });
    assert.equal(quer.status, 400, quer.text);
    assert.equal((await b.rechnungen())[0].sepa_datei_id, null);
    assert.equal((await knex('sepa_dateien').where({ turnier_id: a.turnierId })).length, 2);
});

test('Rechte: Benutzer des Ausrichters und Fremde 403; Super-Admin braucht immer den Code', async () => {
    const a = await aufbau({ vereine: 1 });
    assert.equal((await sepa(a.benutzer, a.turnierId)).status, 403);
    assert.equal((await aufruf(a.benutzer, 'GET', `/api/abrechnung/${a.turnierId}/sepa`)).status, 403);
    const fremd = await aufbau({ vereine: 1, mitRechnungen: false });
    assert.equal((await sepa(fremd.admin, a.turnierId)).status, 403);

    const jetzt = Math.floor(Date.now() / 1000);
    const ohne = await sepa('u-super', a.turnierId, {}, { zf: jetzt });
    assert.equal(ohne.status, 403);
    assert.equal(ohne.daten.code, 'zwei_faktor');
    const falsch = await sepa('u-super', a.turnierId, {}, { zf: jetzt, code: '000000' });
    assert.equal(falsch.status, 403);
    assert.equal(falsch.daten.code, 'zwei_faktor');
    assert.equal((await a.rechnungen())[0].sepa_datei_id, null);
    assert.equal((await knex('sepa_dateien').where({ turnier_id: a.turnierId })).length, 0);

    // 2FA einrichten; der Backup-Code bestätigt die Aktion
    const start = await starteEinrichtung(knex, 'u-super');
    const fertig = await bestaetigeEinrichtung(knex, 'u-super', totpCode(start.geheimnis, schrittFuer()));
    assert.equal(fertig.ok, true);
    const mitCode = await sepa('u-super', a.turnierId, {}, { code: fertig.backupCodes[0] });
    assert.equal(mitCode.status, 200, mitCode.text);
    assert.equal(anzahlPosten(mitCode.text), 1);
});

test('Einzugsdatum gestern: Fälligkeit nächster Geschäftstag nach heute, Warnung, tatsächliches Datum an der Rechnung', async () => {
    const a = await aufbau({ vereine: 2 });
    const heute = heuteBerlin();
    const gestern = addiereTage(heute, -1);
    const [r1, r2] = await a.rechnungen();
    await knex('rechnungen').where({ id: r1.id }).update({ einzug_am: gestern });
    const erwartet = naechsterGeschaeftstag(addiereGeschaeftstage(heute, 1));
    const spaeter = r2.einzug_text > erwartet ? r2.einzug_text : erwartet;

    const r = await sepa(a.admin, a.turnierId);
    assert.equal(r.status, 200, r.text);
    assert.ok(r.text.includes(`<ReqdColltnDt>${spaeter}</ReqdColltnDt>`));
    const roh = r.headers.get('x-sepa-warnung');
    assert.ok(roh, 'Warnung im Header');
    assert.match(roh, /^[\x20-\x7e]+$/, 'Header nur ASCII');
    const warnung = decodeURIComponent(roh);
    assert.match(warnung, /später als angekündigt/);
    assert.ok(warnung.includes(r1.nummer));
    const nachher = await a.rechnungen();
    assert.ok(nachher.every((x) => x.einzug_text === spaeter), 'tatsächliches Einzugsdatum zurückgeschrieben');
    assert.ok(spaeter > heute);

    // Service direkt: Fälligkeit liegt nie in der Vergangenheit, auch an einem Feiertag als "heute"
    const b = await aufbau({ vereine: 1 });
    await knex('rechnungen').where({ turnier_id: b.turnierId }).update({ einzug_am: '2026-12-01' });
    const ergebnis = await erzeugeSepaExport(knex, { turnier: await b.turnier(), benutzerId: b.admin, heute: '2026-12-24' });
    assert.equal(ergebnis.faelligkeit, '2026-12-28');
    assert.match(ergebnis.warnung, /später als angekündigt/);
});

test('Mandat widerrufen, Merker aus oder Gläubiger-ID geändert: 409 mit Rechnungsnummer, keine Datei, kein Merker', async () => {
    const a = await aufbau({ vereine: 2 });
    const [r1, r2] = await a.rechnungen();
    await knex('lastschrift_mandate').where({ id: a.zahler[0].mandatId }).update({ status: 'widerrufen', daten_verschluesselt: null });
    const r = await sepa(a.admin, a.turnierId);
    assert.equal(r.status, 409);
    assert.ok(r.daten.error.includes(r1.nummer) && r.daten.error.includes(a.zahler[0].name), r.daten.error);
    assert.ok(!r.daten.error.includes(r2.nummer));
    assert.equal((await knex('sepa_dateien').where({ turnier_id: a.turnierId })).length, 0);
    assert.ok((await a.rechnungen()).every((x) => x.sepa_datei_id == null));
    await knex('lastschrift_mandate').where({ id: a.zahler[0].mandatId }).update({ status: 'gueltig' });
    // Kontodaten fehlen (gelöscht) → 409 ohne Datei
    const ohneDaten = await sepa(a.admin, a.turnierId);
    assert.equal(ohneDaten.status, 409);
    assert.ok(ohneDaten.daten.error.includes(r1.nummer));
    assert.equal((await knex('sepa_dateien').where({ turnier_id: a.turnierId })).length, 0);

    const b = await aufbau({ vereine: 1 });
    await knex('turnier_zahlwege').where({ id: b.zahler[0].zahlwegId }).update({ mandat_gueltig: false });
    const merker = await sepa(b.admin, b.turnierId);
    assert.equal(merker.status, 409);
    assert.match(merker.daten.error, /nicht mehr per Lastschrift/);
    await knex('turnier_zahlwege').where({ id: b.zahler[0].zahlwegId }).update({ mandat_gueltig: true });
    await knex('vereins_abrechnung').where({ verein_id: b.vereinId }).update({ glaeubiger_id: 'DE09ZZZ00000000001' });
    const gid = await sepa(b.admin, b.turnierId);
    assert.equal(gid.status, 409);
    assert.match(gid.daten.error, /Gläubiger-ID/);
    assert.equal((await knex('sepa_dateien').where({ turnier_id: b.turnierId })).length, 0);
});

test('Nur versandte Rechnungen; abgesagtes Turnier, fehlendes Konto des Ausrichters und keine Rechnungen je 409', async () => {
    const a = await aufbau({ vereine: 2 });
    const [r1, r2] = await a.rechnungen();
    await knex('rechnungen').where({ id: r1.id }).update({ status: 'offen', versandt_am: null, versand_fehler: 'Mail kaputt' });
    const r = await sepa(a.admin, a.turnierId);
    assert.equal(r.status, 200, r.text);
    assert.equal(anzahlPosten(r.text), 1);
    assert.ok(r.text.includes(r2.nummer) && !r.text.includes(r1.nummer));
    assert.ok(decodeURIComponent(r.headers.get('x-sepa-warnung')).includes(r1.nummer), 'nicht enthaltene Rechnung wird genannt');
    const nur = await sepa(a.admin, a.turnierId);
    assert.equal(nur.status, 409);
    assert.match(nur.daten.error, /noch nicht versandt/);
    // bezahlt/zurückgebucht nie, auch nicht über neu
    await knex('rechnungen').where({ id: r1.id }).update({ status: 'bezahlt' });
    assert.equal((await sepa(a.admin, a.turnierId, { neu: true, rechnungIds: [r1.id] })).status, 409);
    assert.equal((await sepa(a.admin, a.turnierId)).status, 409);

    const b = await aufbau({ vereine: 1 });
    await knex('turniere').where({ id: b.turnierId }).update({ status: 'abgesagt' });
    const abgesagt = await sepa(b.admin, b.turnierId);
    assert.equal(abgesagt.status, 409);
    assert.match(abgesagt.daten.error, /abgesagt/);

    const c = await aufbau({ vereine: 1 });
    process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'ein-ganz-anderer-schluessel-mit-mindestens-32-zeichen';
    try {
        const konto = await sepa(c.admin, c.turnierId);
        assert.equal(konto.status, 409);
        assert.match(konto.daten.error, /Konto des Ausrichters nicht lesbar/);
    } finally {
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;
    }
    assert.equal((await knex('sepa_dateien').where({ turnier_id: c.turnierId })).length, 0);

    const d = await aufbau({ vereine: 1, mitRechnungen: false });
    const leer = await sepa(d.admin, d.turnierId);
    assert.equal(leer.status, 409);
    assert.match(leer.daten.error, /keine Lastschrift-Rechnungen/);
});

test('Zwei gleichzeitige Downloads: genau einer liefert die Datei, keine Rechnung steht in zwei Dateien', async () => {
    const a = await aufbau({ vereine: 3 });
    const [x, y] = await Promise.all([sepa(a.admin, a.turnierId), sepa(a.admin, a.turnierId)]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const dateien = await knex('sepa_dateien').where({ turnier_id: a.turnierId });
    assert.equal(dateien.length, 1);
    assert.ok((await a.rechnungen()).every((r) => r.sepa_datei_id === dateien[0].id));
});

test('Protokoll: ein Eintrag abrechnung.sepa je Datei mit Anzahl/Summe/Datei-ID, nirgends eine IBAN', async () => {
    const a = await aufbau({ vereine: 2 });
    const r = await sepa(a.admin, a.turnierId);
    assert.equal(r.status, 200, r.text);
    const datei = await knex('sepa_dateien').where({ turnier_id: a.turnierId }).first();
    const eintraege = await warteAuf(async () => {
        const z = await knex('aktionsprotokoll').where({ aktion: 'abrechnung.sepa', turnier_id: a.turnierId });
        return z.length ? z : null;
    });
    await new Promise((resolve) => setTimeout(resolve, 200)); // ein zweiter (generischer) Eintrag käme jetzt
    const alle = await knex('aktionsprotokoll').where({ turnier_id: a.turnierId }).orWhereRaw("pfad like ?", [`/api/abrechnung/${a.turnierId}/sepa%`]);
    assert.equal(alle.filter((e) => String(e.pfad || '').includes('/sepa') || e.aktion === 'abrechnung.sepa').length, 1, JSON.stringify(alle));
    const e = eintraege[0];
    const details = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
    assert.deepEqual([details.anzahl, details.summeCent, details.sepaDateiId], [2, 4000, datei.id]);
    assert.equal(e.beschreibung, 'SEPA-Lastschriftdatei erzeugt');
    assert.equal(e.benutzer_id, a.admin);
    assert.equal(e.verein_id, a.vereinId);

    const protokoll = await knex('aktionsprotokoll').select('*');
    assert.ok(!ibanIn(JSON.stringify(protokoll)), 'keine IBAN im Protokoll');
    assert.ok(!konsole.join('\n').includes(IBAN_ZAHLER) && !konsole.join('\n').includes(IBAN_ZAHLER_2), 'keine Zahler-IBAN in der Konsole');
    assert.ok(!mails.some((m) => `${m.text}${m.subject}`.includes(IBAN_ZAHLER)), 'keine Klar-IBAN in Mails');
});
