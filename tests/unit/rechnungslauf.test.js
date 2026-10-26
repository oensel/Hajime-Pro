import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Rechnungslauf (Task 10): lückenlose Nummern, Mailversand mit PDF, Wiederholung, parallele Läufe, Zahlstatus,
// Anrechnung bereits bezahlter Kämpfer. Eine gemeinsame Datenbank; jeder Test hat einen eigenen Ausrichter-Verein
// (eigener Nummernkreis) und eigene Turniere.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
delete process.env.SMTP_HOST;
process.env.JWT_SECRET = 'rechnungslauf-test-geheimnis';
const SCHLUESSEL = 'rechnungslauf-test-schluessel-mit-mindestens-32-zeichen';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;

const IBAN = 'DE89370400440532013000';
const IBAN_MUSTER = /DE89\s?3704\s?0044\s?0532\s?0130\s?00/;

// Alle Konsolenausgaben mitschreiben (keine IBAN darf auftauchen); die Ausgabe bleibt sichtbar.
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
const { ordneVereinZu, ladeAbrechnung } = await import('../../src/services/abrechnung.js');
const { erstelleRechnungen, rechnungsDatenAusZeile, baueRechnungsMail } = await import('../../src/services/rechnungslauf.js');
const { giroCodePayloadFuer, erzeugeRechnungPdf, baueRechnungsZeilen, braucheGirocode, datum } = await import('../../src/services/rechnungPdf.js');
const { fruehestesFaelligkeitsdatum } = await import('../../src/shared/targetKalender.js');
const { verschluesseleFeld } = await import('../../src/utils/feldVerschluesselung.js');
const { maskiereIban } = await import('../../src/shared/iban.js');
const { FachFehler } = await import('../../src/utils/fachFehler.js');
const { heuteBerlin, addiereTage } = await import('../../src/shared/abrechnung.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
let db;
let knex;
let server;
let basis;
const mails = [];
let wirftFuer = null;
const testVersand = (mail) => {
    if (wirftFuer && mail.to === wirftFuer) throw new Error('SMTP-Verbindung abgebrochen');
    mails.push(mail);
};

const token = (benutzerId) => jwt.sign({ id: benutzerId }, process.env.JWT_SECRET);
async function aufruf(benutzerId, methode, pfad, body) {
    const res = await fetch(basis + pfad, {
        method: methode,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(benutzerId)}` },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    let daten = null;
    try { daten = await res.json(); } catch { /* leer */ }
    return { status: res.status, daten };
}

/** Wartet auf eine Bedingung (z. B. Protokolleintrag, den die Middleware nach der Antwort schreibt). */
async function warteAuf(pruefe, { zeitlimitMs = 5000 } = {}) {
    const ende = Date.now() + zeitlimitMs;
    for (;;) {
        const wert = await pruefe();
        if (wert) return wert;
        if (Date.now() > ende) throw new Error('Bedingung nicht erfüllt (Zeitlimit).');
        await new Promise((resolve) => setImmediate(resolve));
    }
}

let tnNr = 0;
async function tn(turnierId, verein, extra = {}) {
    tnNr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `P-${tnNr}`, vorname: 'V', nachname: `N${tnNr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, ...extra
    }).returning('id'))[0]);
}
const zw = (turnierId, name, zahlweg, email) => knex('turnier_zahlwege').insert({
    turnier_id: turnierId, verein_name: name, zahlweg, rechnung_email: email, rechnung_ansprechperson: `Kasse ${name}`, rechnung_anschrift: 'Weg 1\n12345 Ort'
});

let ausrichterNr = 0;
/** Legt einen Ausrichter-Verein mit vollständigen Stammdaten und einem Admin an. */
async function neuerAusrichter(praefix) {
    ausrichterNr += 1;
    const name = `JC Ausrichter ${ausrichterNr}`;
    const rechnungEmail = `kasse${ausrichterNr}@ausrichter.de`;
    const vereinId = id((await knex('vereine').insert({ name }).returning('id'))[0]);
    const admin = `u-admin-${ausrichterNr}`;
    await knex('benutzer').insert({ id: admin, email: `admin${ausrichterNr}@test.de`, vorname: 'A', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vereinId });
    await knex('benutzer_vereine').insert({ benutzer_id: admin, verein_id: vereinId, freigegeben: 1, rolle: 'admin' });
    await speichereStammdaten(knex, vereinId, {
        anschrift: 'Hauptstr. 1\n50667 Köln', rechnung_email: rechnungEmail, absender_name: `${name} Kasse`,
        steuernummer: '214/5717/1234', ust_hinweis: 'Steuerfrei nach § 4 Nr. 22b UStG.', rechnungs_praefix: praefix,
        kontoinhaber: `${name} e.V.`, iban: IBAN
    }, admin);
    const neuesTurnier = async (extra = {}) => id((await knex('turniere').insert({
        bezeichnung: 'Domstadt-Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: name, verein_id: vereinId, status: 'veroeffentlicht',
        startgeld: 8, abrechnungsbasis: 'teilnahme_waage', zahlungsziel_tage: 14, zurueckgespielt_am: knex.fn.now(), ...extra
    }).returning('id'))[0]);
    const zaehler = async () => (await knex('vereins_abrechnung').where({ verein_id: vereinId }).first()).naechste_rechnungsnummer;
    const turnier = async (turnierId) => knex('turniere').where({ id: turnierId }).first();
    return { vereinId, name, admin, rechnungEmail, neuesTurnier, zaehler, turnier };
}

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use(erzeugeProtokollMiddleware(knex));
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    basis = `http://127.0.0.1:${server.address().port}`;
    await knex('benutzer').insert({ id: 'u-fremd', email: 'fremd@test.de', vorname: 'F', nachname: 'T', email_bestaetigt_am: knex.fn.now() });
    setzeTestVersand(testVersand);
});

after(async () => {
    setzeTestVersand(null);
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.stoppe();
});

test('Grundlauf: zwei Rechnungen mit lückenlosen Nummern, Quittung für Bar, Mails mit PDF, zweiter Lauf leer', async () => {
    const a = await neuerAusrichter('JCK-');
    const t1 = await a.neuesTurnier();
    await zw(t1, 'JC A', 'ueberweisung', 'rechnung@jc-a.de');
    await zw(t1, 'JC B', 'bar', 'rechnung@jc-b.de');
    await zw(t1, 'JC C', 'ueberweisung', 'rechnung@jc-c.de');
    await tn(t1, 'JC A', { gewogen: true });
    await tn(t1, 'JC A', { gewogen: true });
    await tn(t1, 'JC A');                                  // nicht gewogen: zählt bei Basis Waage nicht
    for (let i = 0; i < 3; i += 1) await tn(t1, 'JC B', { gewogen: true, startgeld_bezahlt: true });
    await tn(t1, 'JC C');
    await tn(t1, a.name, { gewogen: true });               // Ausrichter
    await knex('turnier_barzahlungen').insert({ uid: '00000000-0000-4000-8000-000000000001', turnier_id: t1, verein_name: 'JC B', anzahl: 3, betrag_cent: 2400, kassiert_am: '2030-05-01T09:30:00Z' });
    await knex('turnier_barzahlungen').insert({ uid: '00000000-0000-4000-8000-000000000002', turnier_id: t1, verein_name: 'JC B', anzahl: 0, betrag_cent: 0, kassiert_am: '2030-05-01T11:45:00Z' });

    assert.equal((await aufruf('u-fremd', 'POST', `/api/abrechnung/${t1}/rechnungen`)).status, 403);

    const vorher = mails.length;
    let r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t1}/rechnungen`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler], [2, 2, []]);
    assert.equal(await a.zaehler(), 3);
    const [ra, rb] = await knex('rechnungen').where({ turnier_id: t1 }).orderBy('nummer');
    assert.deepEqual([ra.verein_name, ra.nummer, rb.verein_name, rb.nummer], ['JC A', 'JCK-00001', 'JC B', 'JCK-00002']);
    assert.deepEqual([ra.art, ra.status, ra.anzahl, ra.einzelpreis_cent, ra.betrag_cent, ra.bar_erhalten_cent], ['rechnung', 'versandt', 2, 800, 1600, 0]);
    assert.equal(ra.rechnungsdatum, heuteBerlin());
    assert.equal(ra.leistungsdatum, '2030-05-01');
    assert.equal(ra.zahlungsziel_datum, addiereTage(heuteBerlin(), 14));
    assert.ok(ra.versandt_am);
    assert.equal(ra.verwendungszweck, 'Startgeld Domstadt-Cup JC A JCK-00001');
    assert.equal(ra.erstellt_von, a.admin);
    assert.deepEqual([ra.empfaenger.name, ra.empfaenger.ansprechperson], ['JC A', 'Kasse JC A']);
    assert.deepEqual([ra.aussteller.name, ra.aussteller.rechnung_email], [a.name, a.rechnungEmail]);
    assert.equal(ra.positionen.length, 2);
    assert.doesNotMatch(JSON.stringify([ra.aussteller, ra.empfaenger, ra.positionen]), IBAN_MUSTER); // Klartext-IBAN nur im PDF
    assert.deepEqual([rb.art, rb.status, rb.zahlungsziel_datum, rb.bar_erhalten_cent, rb.betrag_cent], ['quittung', 'bezahlt', null, 2400, 2400]);
    assert.equal(new Date(rb.bezahlt_am).toISOString(), '2030-05-01T11:45:00.000Z');
    assert.ok(rb.versandt_am);
    assert.equal((await PDFDocument.load(ra.pdf)).getTitle(), 'Rechnung JCK-00001');
    assert.equal((await PDFDocument.load(rb.pdf)).getTitle(), 'Quittung JCK-00002');

    const neu = mails.slice(vorher);
    assert.equal(neu.length, 2);
    const mailA = neu.find((m) => m.to === 'rechnung@jc-a.de');
    const mailB = neu.find((m) => m.to === 'rechnung@jc-b.de');
    assert.equal(mailA.subject, 'Rechnung JCK-00001 – Domstadt-Cup');
    assert.equal(mailB.subject, 'Quittung JCK-00002 – Domstadt-Cup');
    for (const m of [mailA, mailB]) {
        assert.equal(m.replyTo, a.rechnungEmail);
        assert.equal(m.absenderName, `${a.name} Kasse`);
        assert.equal(m.anhaenge.length, 1);
        assert.equal(m.anhaenge[0].typ, 'application/pdf');
        assert.match(String(Buffer.from(m.anhaenge[0].inhalt).subarray(0, 5)), /%PDF-/);
        assert.doesNotMatch(m.text, IBAN_MUSTER);
    }
    assert.equal(mailA.anhaenge[0].dateiname, 'JCK-00001.pdf');
    assert.match(mailA.text, /Bitte überweisen Sie den Betrag/);
    assert.match(mailB.text, /bereits bezahlt/);

    // Zweiter Lauf erstellt nichts
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t1}/rechnungen`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.erstellt, r.daten.versendet], [0, 0]);
    assert.equal(mails.length, vorher + 2);
    assert.equal(await a.zaehler(), 3);

    const eintrag = await warteAuf(() => knex('aktionsprotokoll').where({ aktion: 'abrechnung.rechnungslauf' }).first());
    assert.equal(eintrag.beschreibung, 'Rechnungen erstellt und versendet');
});

test('Abweichung nach dem Lauf wird gemeldet, die Rechnung bleibt unverändert', async () => {
    const a = await neuerAusrichter('ABW-');
    const t = await a.neuesTurnier();
    await zw(t, 'JC A', 'ueberweisung', 'abw@jc-a.de');
    await tn(t, 'JC A', { gewogen: true });
    await tn(t, 'JC A', { gewogen: true });
    await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    let r = await aufruf(a.admin, 'GET', `/api/abrechnung/${t}`);
    let zeile = r.daten.vereine.find((v) => v.vereinName === 'JC A');
    assert.deepEqual([zeile.rechnung.anzahl, zeile.rechnung.betrag_cent, zeile.rechnungWeichtAb], [2, 1600, false]);
    await tn(t, 'JC A', { gewogen: true });
    r = await aufruf(a.admin, 'GET', `/api/abrechnung/${t}`);
    zeile = r.daten.vereine.find((v) => v.vereinName === 'JC A');
    assert.equal(zeile.rechnungWeichtAb, true);
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.daten.erstellt, 0);
    assert.deepEqual(r.daten.hinweise, [{ vereinName: 'JC A', grund: 'Rechnung weicht ab: 3 statt 2 Kämpfer (24,00 € statt 16,00 €).' }]);
    const rechnung = await knex('rechnungen').where({ turnier_id: t }).first();
    assert.deepEqual([rechnung.anzahl, rechnung.betrag_cent, rechnung.nummer], [2, 1600, 'ABW-00001']);
});

test('Zahlstatus: überfällig, bezahlt und zurück, Quittung bleibt bezahlt, PDF-Download, fremde Rechnung 404', async () => {
    const a = await neuerAusrichter('ZST-');
    const t = await a.neuesTurnier();
    const anderes = await a.neuesTurnier({ bezeichnung: 'Anderes Turnier' });
    await zw(t, 'JC A', 'ueberweisung', 'z@jc-a.de');
    await zw(t, 'JC B', 'bar', 'z@jc-b.de');
    await tn(t, 'JC A', { gewogen: true });
    await tn(t, 'JC B', { gewogen: true, startgeld_bezahlt: true });
    await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    const ra = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC A' }).first();
    const rb = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC B' }).first();

    await knex('rechnungen').where({ id: ra.id }).update({ zahlungsziel_datum: addiereTage(heuteBerlin(), -1) });
    let r = await aufruf(a.admin, 'GET', `/api/abrechnung/${t}`);
    assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.anzeigeStatus, 'ueberfaellig');

    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/${ra.id}/bezahlt`, { bezahlt: true });
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.rechnung.status, r.daten.rechnung.bezahlt_von], ['bezahlt', a.admin]);
    assert.ok(r.daten.rechnung.bezahlt_am);
    assert.equal('pdf' in r.daten.rechnung, false);
    await warteAuf(() => knex('aktionsprotokoll').where({ aktion: 'abrechnung.bezahlt' }).first());
    r = await aufruf(a.admin, 'GET', `/api/abrechnung/${t}`);
    assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.anzeigeStatus, 'bezahlt');
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/${ra.id}/bezahlt`, { bezahlt: false });
    assert.deepEqual([r.daten.rechnung.status, r.daten.rechnung.bezahlt_am, r.daten.rechnung.bezahlt_von], ['versandt', null, null]);
    assert.equal((await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/${ra.id}/bezahlt`, { bezahlt: 'ja' })).status, 400);
    assert.equal((await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/${rb.id}/bezahlt`, { bezahlt: false })).status, 400);

    const pdfRes = await fetch(`${basis}/api/abrechnung/${t}/rechnungen/${ra.id}/pdf`, { headers: { Authorization: `Bearer ${token(a.admin)}` } });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(pdfRes.headers.get('content-disposition'), 'attachment; filename="ZST-00001.pdf"');
    assert.equal((await PDFDocument.load(new Uint8Array(await pdfRes.arrayBuffer()))).getTitle(), 'Rechnung ZST-00001');

    assert.equal((await aufruf(a.admin, 'POST', `/api/abrechnung/${anderes}/rechnungen/${ra.id}/senden`)).status, 404);
    assert.equal((await aufruf(a.admin, 'GET', `/api/abrechnung/${anderes}/rechnungen/${ra.id}/pdf`)).status, 404);
    assert.equal((await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/abc/senden`)).status, 404);
});

test('Mailfehler: Rechnung bleibt offen mit versand_fehler, Nummern lückenlos, erneutes Senden setzt versandt', async () => {
    const a = await neuerAusrichter('MF-');
    const t = await a.neuesTurnier({ bezeichnung: 'Frühjahrsturnier' });
    await zw(t, 'JC A', 'ueberweisung', 'fehler@jc-a.de');
    await zw(t, 'JC B', 'ueberweisung', 'rechnung2@jc-b.de');
    await zw(t, 'JC D', 'bar', 'rechnung@jc-d.de');
    await tn(t, 'JC A', { gewogen: true });
    await tn(t, 'JC B', { gewogen: true });
    await tn(t, 'JC D', { gewogen: true, startgeld_bezahlt: true });
    await tn(t, 'JC D', { gewogen: true });                 // Bar teilweise: Rechnung über den Rest
    wirftFuer = 'fehler@jc-a.de';
    let r;
    try {
        r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    } finally {
        wirftFuer = null;
    }
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler.length, r.daten.fehler[0].vereinName], [3, 2, 1, 'JC A']);
    const rechnungen = await knex('rechnungen').where({ turnier_id: t }).orderBy('nummer');
    assert.deepEqual(rechnungen.map((x) => x.nummer), ['MF-00001', 'MF-00002', 'MF-00003']);
    assert.equal(await a.zaehler(), 4);
    const ra = rechnungen.find((x) => x.verein_name === 'JC A');
    assert.deepEqual([ra.status, ra.versandt_am], ['offen', null]);
    assert.ok(ra.versand_fehler);
    const rd = rechnungen.find((x) => x.verein_name === 'JC D');
    assert.deepEqual([rd.art, rd.status, rd.betrag_cent, rd.bar_erhalten_cent], ['rechnung', 'versandt', 1600, 800]);
    r = await aufruf(a.admin, 'GET', `/api/abrechnung/${t}`);
    assert.ok(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.versand_fehler);

    const vorher = mails.length;
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen/${ra.id}/senden`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.versendet, true);
    assert.equal(mails.length, vorher + 1);
    assert.equal(mails.at(-1).anhaenge[0].dateiname, 'MF-00001.pdf');
    const nachher = await knex('rechnungen').where({ id: ra.id }).first();
    assert.deepEqual([nachher.status, nachher.versand_fehler, nachher.nummer], ['versandt', null, 'MF-00001']);
    assert.ok(nachher.versandt_am);
    await warteAuf(() => knex('aktionsprotokoll').where({ aktion: 'abrechnung.senden' }).first());
});

test('Zwei parallele Läufe: keine doppelten Rechnungen oder Nummern', async () => {
    const a = await neuerAusrichter('PAR-');
    const t = await a.neuesTurnier({ bezeichnung: 'Parallel-Cup' });
    const t2 = await a.neuesTurnier({ bezeichnung: 'Parallel-Cup 2' });
    for (const turnierId of [t, t2]) {
        await zw(turnierId, 'JC A', 'ueberweisung', 'p@jc-a.de');
        await zw(turnierId, 'JC B', 'ueberweisung', 'p@jc-b.de');
        await tn(turnierId, 'JC A', { gewogen: true });
        await tn(turnierId, 'JC B', { gewogen: true });
    }
    const turnier = await a.turnier(t);
    const ergebnisse = await Promise.all([
        erstelleRechnungen(knex, { turnier, benutzerId: a.admin }),
        erstelleRechnungen(knex, { turnier, benutzerId: a.admin }),
        erstelleRechnungen(knex, { turnier: await a.turnier(t2), benutzerId: a.admin }) // gleicher Nummernkreis, anderes Turnier
    ]);
    assert.equal(ergebnisse[0].erstellt + ergebnisse[1].erstellt, 2);
    assert.equal(ergebnisse[2].erstellt, 2);
    assert.equal((await knex('rechnungen').where({ turnier_id: t })).length, 2);
    const nummern = (await knex('rechnungen').where({ aussteller_verein_id: a.vereinId })).map((x) => x.nummer).sort();
    assert.deepEqual(nummern, ['PAR-00001', 'PAR-00002', 'PAR-00003', 'PAR-00004']);
    assert.equal(await a.zaehler(), 5);
});

test('Vorbedingungen: Nicht zugeordnet, Stammdaten, nicht zurückgespielt, Konto nicht lesbar (je 409, kein Zähler verbraucht)', async () => {
    const a = await neuerAusrichter('VB-');
    const t = await a.neuesTurnier({ bezeichnung: 'Vorbedingungs-Cup' });
    await zw(t, 'JC A', 'ueberweisung', 'v@jc-a.de');
    await tn(t, 'JC A', { gewogen: true });
    const fremd = await tn(t, 'JC Unbekannt', { gewogen: true });
    let r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /nicht zugeordnet/i);
    await knex('turnier_teilnehmer').where({ id: fremd }).del();

    await knex('vereins_abrechnung').where({ verein_id: a.vereinId }).update({ anschrift: null });
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /Anschrift/);
    await knex('vereins_abrechnung').where({ verein_id: a.vereinId }).update({ anschrift: 'Hauptstr. 1\n50667 Köln' });

    const nichtZurueck = await a.neuesTurnier({ zurueckgespielt_am: null });
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${nichtZurueck}/rechnungen`);
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /zurückgespielt/);

    process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'ein-ganz-anderer-schluessel-mit-mindestens-32-zeichen';
    try {
        r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    } finally {
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;
    }
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /Konto des Ausrichters nicht lesbar/);
    assert.equal(await a.zaehler(), 1);
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.daten.erstellt, 1);
    assert.equal(await a.zaehler(), 2);
});

test('Anrechnung bei Überweisung: teilweise bezahlt -> "bereits bezahlt", Girocode nur über den Rest; alles bezahlt -> Quittung', async () => {
    const a = await neuerAusrichter('ANR-');
    const t = await a.neuesTurnier({ abrechnungsbasis: 'gemeldet' });
    await zw(t, 'JC Teil', 'ueberweisung', 'teil@jc.de');
    await zw(t, 'JC Voll', 'ueberweisung', 'voll@jc.de');
    await tn(t, 'JC Teil', { startgeld_bezahlt: true });
    await tn(t, 'JC Teil');
    await tn(t, 'JC Teil');
    await tn(t, 'JC Voll', { startgeld_bezahlt: true });
    await tn(t, 'JC Voll', { startgeld_bezahlt: true });
    const vorher = mails.length;
    const e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    assert.deepEqual([e.erstellt, e.versendet], [2, 2]);
    const teil = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC Teil' }).first();
    assert.deepEqual([teil.art, teil.status, teil.betrag_cent, teil.bar_erhalten_cent], ['rechnung', 'versandt', 2400, 800]);
    assert.ok(giroCodePayloadFuer(rechnungsDatenAusZeile(teil, { iban: IBAN })).split('\n').includes('EUR16.00'));
    const mailTeil = mails.slice(vorher).find((m) => m.to === 'teil@jc.de');
    assert.match(mailTeil.text, /den offenen Betrag von 16,00 €/);

    const voll = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC Voll' }).first();
    assert.deepEqual([voll.art, voll.status, voll.zahlungsziel_datum, voll.verwendungszweck, voll.bar_erhalten_cent], ['quittung', 'bezahlt', null, null, 1600]);
    assert.equal((await PDFDocument.load(voll.pdf)).getTitle(), 'Quittung ANR-00002');
});

test('Kasse kassiert unter falscher Schreibweise -> ordneVereinZu zu Verein mit Überweisung -> Lauf rechnet an', async () => {
    const a = await neuerAusrichter('KAS-');
    const t = await a.neuesTurnier({ abrechnungsbasis: 'gemeldet' });
    await zw(t, 'JC Bonn', 'ueberweisung', 'kasse@jc-bonn.de');
    await tn(t, 'JC Bonn');                                              // gemeldet, nicht bezahlt
    await tn(t, 'Judo-Club Bonn', { startgeld_bezahlt: true });          // an der Kasse unter anderem Namen kassiert
    await tn(t, 'Judo-Club Bonn', { startgeld_bezahlt: true });
    await knex('turnier_barzahlungen').insert({ uid: '00000000-0000-4000-8000-0000000000b1', turnier_id: t, verein_name: 'Judo-Club Bonn', anzahl: 2, betrag_cent: 1600, kassiert_am: '2030-05-01T10:00:00Z' });

    let r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 409);
    assert.equal(await a.zaehler(), 1);
    assert.equal(await ordneVereinZu(knex, t, { vonVereinName: 'Judo-Club Bonn', zuVereinName: 'JC Bonn' }), 2);
    r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.equal(r.daten.erstellt, 1);
    const rechnung = await knex('rechnungen').where({ turnier_id: t }).first();
    assert.deepEqual([rechnung.verein_name, rechnung.art, rechnung.anzahl, rechnung.betrag_cent, rechnung.bar_erhalten_cent], ['JC Bonn', 'rechnung', 3, 2400, 1600]);
    assert.ok(giroCodePayloadFuer(rechnungsDatenAusZeile(rechnung, { iban: IBAN })).split('\n').includes('EUR8.00'));
});

test('Fehler im INSERT bzw. bei der PDF-Erzeugung verbraucht keine Nummer; 409 mitten im Lauf versendet die schon erstellten', async () => {
    const a = await neuerAusrichter('TX-');
    const t = await a.neuesTurnier();
    await zw(t, 'JC Eins', 'ueberweisung', 'eins@jc.de');
    await zw(t, 'JC Zwei', 'ueberweisung', 'zwei@jc.de');
    await zw(t, 'JC Drei', 'ueberweisung', 'drei@jc.de');
    for (const v of ['JC Eins', 'JC Zwei', 'JC Drei']) await tn(t, v, { gewogen: true });

    // INSERT für "JC Zwei" scheitert in der Datenbank (Trigger).
    await knex.raw(`CREATE FUNCTION rechnung_test_sperre() RETURNS trigger AS $$
        BEGIN IF NEW.verein_name = 'JC Zwei' THEN RAISE EXCEPTION 'Testfehler beim Einfuegen'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await knex.raw('CREATE TRIGGER rechnung_test_sperre BEFORE INSERT ON rechnungen FOR EACH ROW EXECUTE FUNCTION rechnung_test_sperre()');
    let e;
    try {
        e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    } finally {
        await knex.raw('DROP TRIGGER rechnung_test_sperre ON rechnungen');
        await knex.raw('DROP FUNCTION rechnung_test_sperre()');
    }
    assert.equal(e.erstellt, 2);
    assert.deepEqual(e.fehler, [{ vereinName: 'JC Zwei', grund: 'Die Rechnung konnte nicht erstellt werden.' }]);
    let rechnungen = await knex('rechnungen').where({ turnier_id: t }).orderBy('nummer');
    assert.deepEqual(rechnungen.map((x) => [x.verein_name, x.nummer]), [['JC Drei', 'TX-00001'], ['JC Eins', 'TX-00002']]);
    assert.equal(await a.zaehler(), 3);

    // PDF-Erzeugung scheitert: wieder keine Nummer verbraucht
    e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin, erzeugePdf: async () => { throw new Error('PDF kaputt'); } });
    assert.deepEqual([e.erstellt, e.fehler.length], [0, 1]);
    assert.equal(await a.zaehler(), 3);
    e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    assert.equal(e.erstellt, 1);
    rechnungen = await knex('rechnungen').where({ turnier_id: t }).orderBy('nummer');
    assert.deepEqual(rechnungen.map((x) => x.nummer), ['TX-00001', 'TX-00002', 'TX-00003']);

    // 409 mitten im Lauf: die vorher erstellte Rechnung wird trotzdem versendet, das Teilergebnis kommt mit
    const t2 = await a.neuesTurnier({ bezeichnung: 'Abbruch-Cup' });
    await zw(t2, 'JC Eins', 'ueberweisung', 'abbruch1@jc.de');
    await zw(t2, 'JC Zwei', 'ueberweisung', 'abbruch2@jc.de');
    await tn(t2, 'JC Eins', { gewogen: true });
    await tn(t2, 'JC Zwei', { gewogen: true });
    let aufrufe = 0;
    const vorher = mails.length;
    await assert.rejects(
        erstelleRechnungen(knex, {
            turnier: await a.turnier(t2), benutzerId: a.admin,
            erzeugePdf: async (d) => { aufrufe += 1; if (aufrufe === 2) throw new FachFehler(409, 'Stammdaten geändert.'); return erzeugeRechnungPdf(d); }
        }),
        (err) => {
            assert.equal(err.statusCode, 409);
            assert.match(err.message, /Stammdaten geändert\. Vorher wurden 1 Rechnung\(en\) erstellt, davon 1 versendet\./);
            assert.deepEqual([err.daten.erstellt, err.daten.versendet], [1, 1]);
            return true;
        }
    );
    assert.equal(mails.slice(vorher).filter((m) => m.to === 'abbruch1@jc.de').length, 1);
    assert.equal((await knex('rechnungen').where({ turnier_id: t2 }).first()).status, 'versandt');
    assert.equal(await a.zaehler(), 5);
});

test('Ohne SMTP (echter Mailer): Rechnung bleibt offen, PDF bleibt da', async () => {
    const a = await neuerAusrichter('SM-');
    const t = await a.neuesTurnier({ bezeichnung: 'Ohne-SMTP-Cup' });
    await zw(t, 'JC A', 'ueberweisung', 's@jc-a.de');
    await tn(t, 'JC A', { gewogen: true });
    setzeTestVersand(null);
    let r;
    try {
        r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    } finally {
        setzeTestVersand(testVersand);
    }
    assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler.length], [1, 0, 1]);
    const rechnung = await knex('rechnungen').where({ turnier_id: t }).first();
    assert.equal(rechnung.status, 'offen');
    assert.match(rechnung.versand_fehler, /SMTP/);
    assert.ok(rechnung.pdf);
});

test('Versand: jede Antwort ohne versendet:false gilt als versendet; Mail einer bezahlten Rechnung verlangt keine Überweisung', async () => {
    const a = await neuerAusrichter('VS-');
    const t = await a.neuesTurnier();
    await zw(t, 'JC A', 'ueberweisung', 'vs@jc-a.de');
    await zw(t, 'JC B', 'ueberweisung', 'vs@jc-b.de');
    await tn(t, 'JC A', { gewogen: true });
    await tn(t, 'JC B', { gewogen: true });
    const antworten = { 'vs@jc-a.de': { ok: true }, 'vs@jc-b.de': { versendet: false, grund: 'fehler' } };
    const e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin, sende: async (m) => antworten[m.to] });
    assert.deepEqual([e.erstellt, e.versendet, e.fehler.map((f) => f.vereinName)], [2, 1, ['JC B']]);

    const ra = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC A' }).first();
    assert.equal(ra.status, 'versandt');
    assert.match(baueRechnungsMail(ra).text, /Bitte überweisen Sie den Betrag/);
    assert.doesNotMatch(baueRechnungsMail({ ...ra, status: 'bezahlt' }).text, /überweisen/);
    assert.match(baueRechnungsMail({ ...ra, status: 'bezahlt' }).text, /bereits bezahlt/);
});

// ---------- Stufe 3: Lastschrift-Rechnungen (Task 7) ----------
const IBAN_ZAHLER = 'DE02120300000000202051';
const IBAN_ZAHLER_MUSTER = /DE02\s?1203\s?0000\s?0000\s?2020\s?51/;
const GLAEUBIGER_ID = 'DE98ZZZ09999999999';
let mandatNr = 0;
/** Lastschrift-Zahlweg mit Mandat im angegebenen Status (null = ohne Mandat). */
async function lastschriftVerein(turnierId, name, email, { status = 'gueltig', erteiltAm = '2030-03-10T10:00:00Z' } = {}) {
    const [z] = await knex('turnier_zahlwege').insert({
        turnier_id: turnierId, verein_name: name, zahlweg: 'lastschrift', rechnung_email: email, rechnung_ansprechperson: `Kasse ${name}`,
        rechnung_anschrift: 'Weg 1\n12345 Ort', mandat_gueltig: status === 'gueltig'
    }).returning('id');
    if (status == null) return { zahlwegId: id(z), mandatId: null };
    mandatNr += 1;
    const [m] = await knex('lastschrift_mandate').insert({
        turnier_id: turnierId, turnier_bezeichnung: 'Domstadt-Cup', zahlweg_id: id(z), verein_name: name,
        mandatsreferenz: `TESTM${turnierId}V${mandatNr}`,
        daten_verschluesselt: ['gueltig', 'unbestaetigt'].includes(status)
            ? verschluesseleFeld(JSON.stringify({ iban: IBAN_ZAHLER, kontoinhaber: `${name} e.V.`, ip: '127.0.0.1' })) : null,
        iban_maske: maskiereIban(IBAN_ZAHLER), mandatstext: 'Mandatstext', textversion: 'test', glaeubiger_id: GLAEUBIGER_ID,
        glaeubiger_name: 'Ausrichter', status, erteilt_am: erteiltAm, erteilt_von: 'u-fremd', vertretung_bestaetigt: true
    }).returning('id');
    return { zahlwegId: id(z), mandatId: id(m) };
}
const ohnePdf = ({ pdf, ...rest }) => rest;

test('Lastschrift mit gültigem Mandat: Rechnung als Vorabankündigung mit Einzugsdatum, ohne Klar-IBAN; andere Zahlwege rechnen weiter an', async () => {
    const a = await neuerAusrichter('LS-');
    await speichereStammdaten(knex, a.vereinId, { glaeubiger_id: GLAEUBIGER_ID }, a.admin);
    const t = await a.neuesTurnier({ vorabankuendigung_tage: 5 });
    const { mandatId } = await lastschriftVerein(t, 'JC Lasch', 'ls@jc-lasch.de');
    await zw(t, 'JC Ueber', 'ueberweisung', 'ls@jc-ueber.de');
    await zw(t, 'JC Bar', 'bar', 'ls@jc-bar.de');
    await tn(t, 'JC Lasch', { gewogen: true, startgeld_bezahlt: true }); // bezahlt: bei Lastschrift KEINE Anrechnung (E9)
    await tn(t, 'JC Lasch', { gewogen: true });
    await tn(t, 'JC Ueber', { gewogen: true, startgeld_bezahlt: true });
    await tn(t, 'JC Ueber', { gewogen: true });
    await tn(t, 'JC Bar', { gewogen: true, startgeld_bezahlt: true });

    const vorher = mails.length;
    const r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 200, JSON.stringify(r.daten));
    assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler], [3, 3, []]);

    const heute = heuteBerlin();
    const ls = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC Lasch' }).first();
    assert.deepEqual(
        [ls.zahlweg, ls.art, ls.status, ls.anzahl, ls.betrag_cent, ls.bar_erhalten_cent, ls.zahlungsziel_datum],
        ['lastschrift', 'rechnung', 'versandt', 2, 1600, 0, null]
    );
    assert.equal(ls.einzug_am, fruehestesFaelligkeitsdatum(heute, 5, heute));
    assert.ok(ls.einzug_am > heute);
    assert.equal(ls.mandat_id, mandatId);
    assert.equal(ls.mandatsreferenz, (await knex('lastschrift_mandate').where({ id: mandatId }).first()).mandatsreferenz);
    assert.equal(ls.mandat_datum, '2030-03-10');
    assert.equal(ls.iban_maske_zahler, maskiereIban(IBAN_ZAHLER));
    assert.equal(ls.aussteller.glaeubiger_id, GLAEUBIGER_ID);
    assert.equal(ls.sepa_datei_id, null);
    assert.doesNotMatch(JSON.stringify(ohnePdf(ls)), IBAN_ZAHLER_MUSTER);

    // PDF-Daten: ohne Ausrichter-IBAN erzeugbar, Lastschrift-Text, kein Girocode, keine Klar-IBAN des Zahlers
    const daten = rechnungsDatenAusZeile(ls);
    assert.equal(daten.zahlung, null);
    assert.equal(braucheGirocode(daten), false);
    assert.deepEqual(daten.lastschrift, {
        mandatsreferenz: ls.mandatsreferenz, mandatDatum: '2030-03-10', glaeubigerId: GLAEUBIGER_ID,
        ibanMaske: maskiereIban(IBAN_ZAHLER), einzugAm: ls.einzug_am
    });
    const text = Object.values(baueRechnungsZeilen(daten)).flat().map((e) => (typeof e === 'string' ? e : `${e.text} ${e.betrag}`)).join('\n');
    assert.ok(text.includes(`Der Betrag von 16,00 € wird per SEPA-Lastschrift am ${datum(ls.einzug_am)} von Ihrem Konto ${maskiereIban(IBAN_ZAHLER)} eingezogen. Mandatsreferenz ${ls.mandatsreferenz}, Gläubiger-ID ${GLAEUBIGER_ID}.`), text);
    assert.doesNotMatch(text, IBAN_ZAHLER_MUSTER);
    assert.doesNotMatch(text, IBAN_MUSTER);
    assert.doesNotMatch(text, /bereits bezahlt|überweisen/);

    const neu = mails.slice(vorher);
    const mailLs = neu.find((m) => m.to === 'ls@jc-lasch.de');
    assert.equal(mailLs.subject, `Rechnung ${ls.nummer} – Domstadt-Cup (Einzug per Lastschrift)`);
    assert.ok(mailLs.text.includes(datum(ls.einzug_am)), mailLs.text);
    assert.ok(mailLs.text.includes(maskiereIban(IBAN_ZAHLER)));
    assert.match(mailLs.text, /nichts weiter tun/);
    assert.doesNotMatch(mailLs.text, /überweisen/);
    assert.doesNotMatch(mailLs.text, IBAN_ZAHLER_MUSTER);
    assert.doesNotMatch(mailLs.text, IBAN_MUSTER);

    // Regression E9: Überweisung rechnet bezahlte Kämpfer an, Bar komplett bezahlt -> Quittung
    const ue = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC Ueber' }).first();
    assert.deepEqual([ue.zahlweg, ue.art, ue.betrag_cent, ue.bar_erhalten_cent, ue.einzug_am, ue.mandat_id], ['ueberweisung', 'rechnung', 1600, 800, null, null]);
    assert.equal(ue.zahlungsziel_datum, addiereTage(heute, 14));
    assert.equal(neu.find((m) => m.to === 'ls@jc-ueber.de').subject, `Rechnung ${ue.nummer} – Domstadt-Cup`);
    const bar = await knex('rechnungen').where({ turnier_id: t, verein_name: 'JC Bar' }).first();
    assert.deepEqual([bar.art, bar.status, bar.bar_erhalten_cent], ['quittung', 'bezahlt', 800]);

    // Übersicht: kein Hinweis beim gültigen Mandat; "eingezogen" erst mit Datei und erreichtem Einzugsdatum
    let abr = await ladeAbrechnung(knex, await a.turnier(t));
    let zeile = abr.vereine.find((v) => v.vereinName === 'JC Lasch');
    assert.equal(zeile.hinweis, null);
    assert.equal(zeile.rechnung.anzeigeStatus, 'versandt');
    const [datei] = await knex('sepa_dateien').insert({ turnier_id: t, msg_id: `TEST-${t}`, erzeugt_von: a.admin, faelligkeit: ls.einzug_am, anzahl: 1, summe_cent: 1600 }).returning('id');
    await knex('rechnungen').where({ id: ls.id }).update({ sepa_datei_id: id(datei) });
    abr = await ladeAbrechnung(knex, await a.turnier(t));
    assert.equal(abr.vereine.find((v) => v.vereinName === 'JC Lasch').rechnung.anzeigeStatus, 'versandt'); // Einzugsdatum noch nicht erreicht
    await knex('rechnungen').where({ id: ls.id }).update({ einzug_am: heute });
    abr = await ladeAbrechnung(knex, await a.turnier(t));
    zeile = abr.vereine.find((v) => v.vereinName === 'JC Lasch');
    assert.equal(zeile.rechnung.anzeigeStatus, 'eingezogen');
    assert.equal(zeile.rechnung.einzug_am, heute);
});

test('Nur Lastschrift-Vereine: der Lauf braucht kein lesbares Konto des Ausrichters', async () => {
    const a = await neuerAusrichter('LSK-');
    await speichereStammdaten(knex, a.vereinId, { glaeubiger_id: GLAEUBIGER_ID }, a.admin);
    const t = await a.neuesTurnier({ vorabankuendigung_tage: 3 });
    await lastschriftVerein(t, 'JC Nur', 'nur@jc.de');
    await tn(t, 'JC Nur', { gewogen: true });
    process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'ein-ganz-anderer-schluessel-mit-mindestens-32-zeichen';
    let e;
    try {
        e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    } finally {
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;
    }
    assert.deepEqual([e.erstellt, e.versendet, e.fehler], [1, 1, []]);
    const rechnung = await knex('rechnungen').where({ turnier_id: t }).first();
    assert.equal(rechnung.einzug_am, fruehestesFaelligkeitsdatum(heuteBerlin(), 3, heuteBerlin()));
    assert.equal(rechnung.aussteller.iban_maske, null);
});

test('Lastschrift ohne gültiges Mandat: Übersicht nennt den Grund, der Lauf antwortet 409 ohne Nummer zu verbrauchen', async () => {
    const a = await neuerAusrichter('LSM-');
    await speichereStammdaten(knex, a.vereinId, { glaeubiger_id: GLAEUBIGER_ID }, a.admin);
    const t = await a.neuesTurnier();
    await lastschriftVerein(t, 'JC Offen', 'offen@jc.de', { status: 'unbestaetigt' });
    await lastschriftVerein(t, 'JC Ohne', 'ohne@jc.de', { status: null });
    await zw(t, 'JC A', 'ueberweisung', 'lsm@jc-a.de');
    await tn(t, 'JC Offen', { gewogen: true });
    await tn(t, 'JC Ohne', { gewogen: true });
    await tn(t, 'JC A', { gewogen: true });

    const abr = await ladeAbrechnung(knex, await a.turnier(t));
    assert.deepEqual(abr.vereine.map((v) => v.vereinName), ['JC A', 'JC Offen', 'JC Ohne']);
    const offen = abr.vereine.find((v) => v.vereinName === 'JC Offen');
    const ohne = abr.vereine.find((v) => v.vereinName === 'JC Ohne');
    assert.equal(offen.hinweis, 'Mandat nicht gültig');
    assert.match(offen.hinweisGrund, /noch nicht von einem Admin des Vereins bestätigt/);
    assert.equal(ohne.hinweis, 'Mandat nicht gültig');
    assert.match(ohne.hinweisGrund, /kein Lastschriftmandat/);
    assert.equal(abr.vereine.find((v) => v.vereinName === 'JC A').hinweis, null);

    const r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /Verein JC Offen hat kein gültiges Mandat\./);
    assert.match(r.daten.error, /Verein JC Ohne hat kein gültiges Mandat\./);
    assert.equal((await knex('rechnungen').where({ turnier_id: t })).length, 0);
    assert.equal(await a.zaehler(), 1);

    // Umgestellt auf Bar (wie der Anmeldeschluss-Job): der Lauf geht durch
    await knex('turnier_zahlwege').where({ turnier_id: t }).whereIn('verein_name', ['JC Offen', 'JC Ohne']).update({ zahlweg: 'bar' });
    const e = await erstelleRechnungen(knex, { turnier: await a.turnier(t), benutzerId: a.admin });
    assert.equal(e.erstellt, 3);
});

test('Mandat wird mitten im Lauf ungültig: 409 in der Transaktion, keine Nummer verbraucht, die schon erstellte Rechnung wird versendet', async () => {
    const a = await neuerAusrichter('LST-');
    await speichereStammdaten(knex, a.vereinId, { glaeubiger_id: GLAEUBIGER_ID }, a.admin);
    const t = await a.neuesTurnier();
    await lastschriftVerein(t, 'JC Eins', 'lst1@jc.de');
    const { mandatId } = await lastschriftVerein(t, 'JC Zwei', 'lst2@jc.de');
    await tn(t, 'JC Eins', { gewogen: true });
    await tn(t, 'JC Zwei', { gewogen: true });
    let aufrufe = 0;
    await assert.rejects(
        erstelleRechnungen(knex, {
            turnier: await a.turnier(t), benutzerId: a.admin,
            erzeugePdf: async (d) => {
                aufrufe += 1;
                if (aufrufe === 1) await knex('lastschrift_mandate').where({ id: mandatId }).update({ status: 'widerrufen', daten_verschluesselt: null });
                return erzeugeRechnungPdf(d);
            }
        }),
        (err) => {
            assert.equal(err.statusCode, 409);
            assert.match(err.message, /Verein JC Zwei hat kein gültiges Mandat\. Vorher wurden 1 Rechnung\(en\) erstellt, davon 1 versendet\./);
            return true;
        }
    );
    assert.deepEqual((await knex('rechnungen').where({ turnier_id: t })).map((x) => x.verein_name), ['JC Eins']);
    assert.equal(await a.zaehler(), 2);
});

test('Abgesagtes Turnier: keine Abrechnung, Lastschrift-Zeilen ohne Mandat blockieren nichts', async () => {
    const a = await neuerAusrichter('ABG-');
    await speichereStammdaten(knex, a.vereinId, { glaeubiger_id: GLAEUBIGER_ID }, a.admin);
    const t = await a.neuesTurnier({ status: 'abgesagt' });
    await lastschriftVerein(t, 'JC Lasch', 'abg@jc.de', { status: 'widerrufen' });
    await zw(t, 'JC A', 'ueberweisung', 'abg@jc-a.de');
    await tn(t, 'JC Lasch', { gewogen: true });
    await tn(t, 'JC A', { gewogen: true });
    const abr = await ladeAbrechnung(knex, await a.turnier(t));
    assert.equal(abr.bereit, false);
    assert.match(abr.grund, /abgesagt/);
    const r = await aufruf(a.admin, 'POST', `/api/abrechnung/${t}/rechnungen`);
    assert.equal(r.status, 409);
    assert.match(r.daten.error, /abgesagt/);
    assert.doesNotMatch(r.daten.error, /Mandat/);
    assert.equal(await a.zaehler(), 1);

    // Andere Turniere desselben Ausrichters laufen normal
    const t2 = await a.neuesTurnier({ bezeichnung: 'Nachhol-Cup' });
    await zw(t2, 'JC A', 'ueberweisung', 'abg2@jc-a.de');
    await tn(t2, 'JC A', { gewogen: true });
    assert.equal((await erstelleRechnungen(knex, { turnier: await a.turnier(t2), benutzerId: a.admin })).erstellt, 1);
});

test('Protokoll und Konsole enthalten keine IBAN', async () => {
    const protokoll = await knex('aktionsprotokoll').select('aktion', 'beschreibung', 'details');
    assert.ok(protokoll.length > 0);
    assert.doesNotMatch(JSON.stringify(protokoll), IBAN_MUSTER);
    assert.doesNotMatch(konsole.join('\n'), IBAN_MUSTER);
    assert.doesNotMatch(JSON.stringify(protokoll), IBAN_ZAHLER_MUSTER);
    assert.doesNotMatch(konsole.join('\n'), IBAN_ZAHLER_MUSTER);
});
