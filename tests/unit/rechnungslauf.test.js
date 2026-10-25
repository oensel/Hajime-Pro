import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { PDFDocument } from 'pdf-lib';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Rechnungslauf (Task 10): lückenlose Nummern, Mailversand mit PDF, Wiederholung, parallele Läufe, Zahlstatus.
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

// Alle Konsolenausgaben des Tests mitschreiben (keine IBAN darf auftauchen); die Ausgabe bleibt sichtbar.
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
const { heuteBerlin, addiereTage } = await import('../../src/shared/abrechnung.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
let nr = 0;
async function tn(knex, turnierId, verein, extra = {}) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `P-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, ...extra
    }).returning('id'))[0]);
}
const zw = (knex, turnierId, name, zahlweg, email) => knex('turnier_zahlwege').insert({
    turnier_id: turnierId, verein_name: name, zahlweg, rechnung_email: email, rechnung_ansprechperson: `Kasse ${name}`, rechnung_anschrift: 'Weg 1\n12345 Ort'
});

test('Rechnungslauf: Nummern, Versand, Wiederholung, Parallelität, Zahlstatus', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use(erzeugeProtokollMiddleware(knex));
    app.use('/api/abrechnung', getAbrechnungRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const token = (benutzerId) => jwt.sign({ id: benutzerId }, process.env.JWT_SECRET);
    const aufruf = async (benutzerId, methode, pfad, body) => {
        const res = await fetch(basis + pfad, {
            method: methode,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token(benutzerId)}` },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        let daten = null;
        try { daten = await res.json(); } catch { /* leer */ }
        return { status: res.status, daten };
    };
    const mails = [];
    let wirftFuer = null;
    setzeTestVersand((mail) => {
        if (wirftFuer && mail.to === wirftFuer) throw new Error('SMTP-Verbindung abgebrochen');
        mails.push(mail);
    });
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Köln' }).returning('id'))[0]);
        for (const [n, rolle] of [['admin', 'admin'], ['benutzer', 'benutzer']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vAus });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: vAus, freigegeben: 1, rolle });
        }
        await speichereStammdaten(knex, vAus, {
            anschrift: 'Hauptstr. 1\n50667 Köln', rechnung_email: 'kasse@jc-koeln.de', absender_name: 'JC Köln Kasse',
            steuernummer: '214/5717/1234', ust_hinweis: 'Steuerfrei nach § 4 Nr. 22b UStG.', rechnungs_praefix: 'JCK-',
            kontoinhaber: 'JC Köln e.V.', iban: IBAN
        }, 'u-admin');
        const neuesTurnier = async (extra = {}) => id((await knex('turniere').insert({
            bezeichnung: 'Domstadt-Cup', ort: 'Halle', datum: '2030-05-01', ausrichter: 'JC Köln', verein_id: vAus, status: 'veroeffentlicht',
            startgeld: 8, abrechnungsbasis: 'teilnahme_waage', zahlungsziel_tage: 14, zurueckgespielt_am: knex.fn.now(), ...extra
        }).returning('id'))[0]);
        const zaehler = async () => (await knex('vereins_abrechnung').where({ verein_id: vAus }).first()).naechste_rechnungsnummer;

        // --- Turnier 1: JC A (Überweisung), JC B (Bar, alles bezahlt), JC C (Überweisung, niemand gewogen)
        const t1 = await neuesTurnier();
        await zw(knex, t1, 'JC A', 'ueberweisung', 'rechnung@jc-a.de');
        await zw(knex, t1, 'JC B', 'bar', 'rechnung@jc-b.de');
        await zw(knex, t1, 'JC C', 'ueberweisung', 'rechnung@jc-c.de');
        await tn(knex, t1, 'JC A', { gewogen: true });
        await tn(knex, t1, 'JC A', { gewogen: true });
        await tn(knex, t1, 'JC A');                          // nicht gewogen: zählt bei Basis Waage nicht
        for (let i = 0; i < 3; i += 1) await tn(knex, t1, 'JC B', { gewogen: true, startgeld_bezahlt: true });
        await tn(knex, t1, 'JC C');
        await tn(knex, t1, 'JC Köln', { gewogen: true });    // Ausrichter
        await knex('turnier_barzahlungen').insert({ uid: '00000000-0000-4000-8000-000000000001', turnier_id: t1, verein_name: 'JC B', anzahl: 3, betrag_cent: 2400, kassiert_am: '2030-05-01T09:30:00Z' });
        await knex('turnier_barzahlungen').insert({ uid: '00000000-0000-4000-8000-000000000002', turnier_id: t1, verein_name: 'JC B', anzahl: 0, betrag_cent: 0, kassiert_am: '2030-05-01T11:45:00Z' });

        // Rechte
        assert.equal((await aufruf('u-benutzer', 'POST', `/api/abrechnung/${t1}/rechnungen`)).status, 403);

        let r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler], [2, 2, []]);
        assert.equal(await zaehler(), 3);
        const rechnungen1 = await knex('rechnungen').where({ turnier_id: t1 }).orderBy('nummer');
        assert.deepEqual(rechnungen1.map((x) => [x.verein_name, x.nummer]), [['JC A', 'JCK-00001'], ['JC B', 'JCK-00002']]);
        const [ra, rb] = rechnungen1;
        assert.deepEqual([ra.art, ra.status, ra.anzahl, ra.einzelpreis_cent, ra.betrag_cent, ra.bar_erhalten_cent], ['rechnung', 'versandt', 2, 800, 1600, 0]);
        assert.equal(ra.rechnungsdatum, heuteBerlin());
        assert.equal(ra.leistungsdatum, '2030-05-01');
        assert.equal(ra.zahlungsziel_datum, addiereTage(heuteBerlin(), 14));
        assert.ok(ra.versandt_am);
        assert.equal(ra.verwendungszweck, 'Startgeld Domstadt-Cup JC A JCK-00001');
        assert.equal(ra.erstellt_von, 'u-admin');
        assert.equal(ra.empfaenger.name, 'JC A');
        assert.equal(ra.empfaenger.ansprechperson, 'Kasse JC A');
        assert.equal(ra.aussteller.name, 'JC Köln');
        assert.equal(ra.aussteller.rechnung_email, 'kasse@jc-koeln.de');
        assert.equal(ra.positionen.length, 2);
        assert.doesNotMatch(JSON.stringify([ra.aussteller, ra.empfaenger, ra.positionen]), IBAN_MUSTER); // Klartext-IBAN nur im PDF
        assert.deepEqual([rb.art, rb.status, rb.zahlungsziel_datum, rb.bar_erhalten_cent, rb.betrag_cent], ['quittung', 'bezahlt', null, 2400, 2400]);
        assert.equal(new Date(rb.bezahlt_am).toISOString(), '2030-05-01T11:45:00.000Z');
        assert.ok(rb.versandt_am);
        const pdfA = await PDFDocument.load(ra.pdf);
        assert.equal(pdfA.getTitle(), 'Rechnung JCK-00001');
        assert.equal((await PDFDocument.load(rb.pdf)).getTitle(), 'Quittung JCK-00002');

        assert.equal(mails.length, 2);
        const mailA = mails.find((m) => m.to === 'rechnung@jc-a.de');
        const mailB = mails.find((m) => m.to === 'rechnung@jc-b.de');
        assert.equal(mailA.subject, 'Rechnung JCK-00001 – Domstadt-Cup');
        assert.equal(mailB.subject, 'Quittung JCK-00002 – Domstadt-Cup');
        for (const m of [mailA, mailB]) {
            assert.equal(m.replyTo, 'kasse@jc-koeln.de');
            assert.equal(m.absenderName, 'JC Köln Kasse');
            assert.equal(m.anhaenge.length, 1);
            assert.equal(m.anhaenge[0].typ, 'application/pdf');
            assert.match(String(Buffer.from(m.anhaenge[0].inhalt).subarray(0, 5)), /%PDF-/);
            assert.doesNotMatch(m.text, IBAN_MUSTER);
        }
        assert.equal(mailA.anhaenge[0].dateiname, 'JCK-00001.pdf');

        // Zweiter Lauf erstellt nichts
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.deepEqual([r.daten.erstellt, r.daten.versendet], [0, 0]);
        assert.equal(mails.length, 2);
        assert.equal(await zaehler(), 3);

        // Übersicht: Rechnung mit Anzahl/Betrag; Abweichung wird gemeldet, die Rechnung bleibt unverändert
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t1}`);
        let zeileA = r.daten.vereine.find((v) => v.vereinName === 'JC A');
        assert.deepEqual([zeileA.rechnung.anzahl, zeileA.rechnung.betrag_cent, zeileA.rechnungWeichtAb], [2, 1600, false]);
        await tn(knex, t1, 'JC A', { gewogen: true });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t1}`);
        zeileA = r.daten.vereine.find((v) => v.vereinName === 'JC A');
        assert.equal(zeileA.rechnungWeichtAb, true);
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen`);
        assert.equal(r.daten.erstellt, 0);
        assert.deepEqual(r.daten.hinweise, [{ vereinName: 'JC A', grund: 'Rechnung weicht ab: 3 statt 2 Kämpfer (24,00 € statt 16,00 €).' }]);
        const raNachher = await knex('rechnungen').where({ id: ra.id }).first();
        assert.deepEqual([raNachher.anzahl, raNachher.betrag_cent, raNachher.nummer], [2, 1600, 'JCK-00001']);

        // Überfällig: versandt + Zahlungsziel gestern
        await knex('rechnungen').where({ id: ra.id }).update({ zahlungsziel_datum: addiereTage(heuteBerlin(), -1) });
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t1}`);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.anzeigeStatus, 'ueberfaellig');

        // Bezahlt setzen und zurücknehmen
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen/${ra.id}/bezahlt`, { bezahlt: true });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.rechnung.status, 'bezahlt');
        assert.equal(r.daten.rechnung.bezahlt_von, 'u-admin');
        assert.ok(r.daten.rechnung.bezahlt_am);
        assert.equal('pdf' in r.daten.rechnung, false);
        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t1}`);
        assert.equal(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.anzeigeStatus, 'bezahlt');
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen/${ra.id}/bezahlt`, { bezahlt: false });
        assert.deepEqual([r.daten.rechnung.status, r.daten.rechnung.bezahlt_am, r.daten.rechnung.bezahlt_von], ['versandt', null, null]);
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen/${ra.id}/bezahlt`, { bezahlt: 'ja' })).status, 400);
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen/${rb.id}/bezahlt`, { bezahlt: false })).status, 400); // Quittung

        // PDF herunterladen
        const pdfRes = await fetch(`${basis}/api/abrechnung/${t1}/rechnungen/${ra.id}/pdf`, { headers: { Authorization: `Bearer ${token('u-admin')}` } });
        assert.equal(pdfRes.status, 200);
        assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
        assert.equal(pdfRes.headers.get('content-disposition'), 'attachment; filename="JCK-00001.pdf"');
        assert.equal((await PDFDocument.load(new Uint8Array(await pdfRes.arrayBuffer()))).getTitle(), 'Rechnung JCK-00001');

        // --- Turnier 2: Versand scheitert bei JC A, Nummern bleiben lückenlos, erneutes Senden
        const t2 = await neuesTurnier({ bezeichnung: 'Frühjahrsturnier' });
        await zw(knex, t2, 'JC A', 'ueberweisung', 'fehler@jc-a.de');
        await zw(knex, t2, 'JC B', 'ueberweisung', 'rechnung2@jc-b.de');
        await zw(knex, t2, 'JC D', 'bar', 'rechnung@jc-d.de');
        await tn(knex, t2, 'JC A', { gewogen: true });
        await tn(knex, t2, 'JC B', { gewogen: true });
        await tn(knex, t2, 'JC D', { gewogen: true, startgeld_bezahlt: true });
        await tn(knex, t2, 'JC D', { gewogen: true });       // Bar teilweise: Rechnung mit Rest
        wirftFuer = 'fehler@jc-a.de';
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t2}/rechnungen`);
        wirftFuer = null;
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.erstellt, 3);
        assert.equal(r.daten.versendet, 2);
        assert.equal(r.daten.fehler.length, 1);
        assert.equal(r.daten.fehler[0].vereinName, 'JC A');
        const rechnungen2 = await knex('rechnungen').where({ turnier_id: t2 }).orderBy('nummer');
        assert.deepEqual(rechnungen2.map((x) => x.nummer), ['JCK-00003', 'JCK-00004', 'JCK-00005']);
        assert.equal(await zaehler(), 6);
        const r2a = rechnungen2.find((x) => x.verein_name === 'JC A');
        assert.deepEqual([r2a.status, r2a.versandt_am], ['offen', null]);
        assert.ok(r2a.versand_fehler);
        const r2d = rechnungen2.find((x) => x.verein_name === 'JC D');
        assert.deepEqual([r2d.art, r2d.status, r2d.betrag_cent, r2d.bar_erhalten_cent], ['rechnung', 'versandt', 1600, 800]);

        r = await aufruf('u-admin', 'GET', `/api/abrechnung/${t2}`);
        assert.ok(r.daten.vereine.find((v) => v.vereinName === 'JC A').rechnung.versand_fehler);

        // Rechnung eines anderen Turniers: 404
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t1}/rechnungen/${r2a.id}/senden`)).status, 404);
        assert.equal((await aufruf('u-admin', 'GET', `/api/abrechnung/${t1}/rechnungen/${r2a.id}/pdf`)).status, 404);
        assert.equal((await aufruf('u-admin', 'POST', `/api/abrechnung/${t2}/rechnungen/abc/senden`)).status, 404);

        const vorher = mails.length;
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t2}/rechnungen/${r2a.id}/senden`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.versendet, true);
        assert.equal(mails.length, vorher + 1);
        assert.equal(mails.at(-1).anhaenge[0].dateiname, 'JCK-00003.pdf');
        const r2aNachher = await knex('rechnungen').where({ id: r2a.id }).first();
        assert.deepEqual([r2aNachher.status, r2aNachher.versand_fehler, r2aNachher.nummer], ['versandt', null, 'JCK-00003']);
        assert.ok(r2aNachher.versandt_am);

        // --- Turnier 3: zwei parallele Läufe
        const t3 = await neuesTurnier({ bezeichnung: 'Parallel-Cup' });
        await zw(knex, t3, 'JC A', 'ueberweisung', 'p@jc-a.de');
        await zw(knex, t3, 'JC B', 'ueberweisung', 'p@jc-b.de');
        await tn(knex, t3, 'JC A', { gewogen: true });
        await tn(knex, t3, 'JC B', { gewogen: true });
        const turnier3 = await knex('turniere').where({ id: t3 }).first();
        const [e1, e2] = await Promise.all([
            erstelleRechnungen(knex, { turnier: turnier3, benutzerId: 'u-admin' }),
            erstelleRechnungen(knex, { turnier: turnier3, benutzerId: 'u-admin' })
        ]);
        assert.equal(e1.erstellt + e2.erstellt, 2);
        assert.equal((await knex('rechnungen').where({ turnier_id: t3 })).length, 2);
        const alleNummern = (await knex('rechnungen').where({ aussteller_verein_id: vAus })).map((x) => x.nummer).sort();
        assert.deepEqual(alleNummern, ['JCK-00001', 'JCK-00002', 'JCK-00003', 'JCK-00004', 'JCK-00005', 'JCK-00006', 'JCK-00007']);
        assert.equal(await zaehler(), 8);

        // --- Vorbedingungen
        const t4 = await neuesTurnier({ bezeichnung: 'Vorbedingungs-Cup' });
        await zw(knex, t4, 'JC A', 'ueberweisung', 'v@jc-a.de');
        await tn(knex, t4, 'JC A', { gewogen: true });
        const fremd = await tn(knex, t4, 'JC Unbekannt', { gewogen: true });
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t4}/rechnungen`);
        assert.equal(r.status, 409);
        assert.match(r.daten.error, /nicht zugeordnet/i);
        await knex('turnier_teilnehmer').where({ id: fremd }).del();

        await knex('vereins_abrechnung').where({ verein_id: vAus }).update({ anschrift: null });
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t4}/rechnungen`);
        assert.equal(r.status, 409);
        assert.match(r.daten.error, /Anschrift/);
        await knex('vereins_abrechnung').where({ verein_id: vAus }).update({ anschrift: 'Hauptstr. 1\n50667 Köln' });

        const t5 = await neuesTurnier({ zurueckgespielt_am: null });
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t5}/rechnungen`);
        assert.equal(r.status, 409);
        assert.match(r.daten.error, /zurückgespielt/);

        // Getauschter Schlüssel: Konto nicht lesbar, 409 statt 500, kein Zähler verbraucht
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'ein-ganz-anderer-schluessel-mit-mindestens-32-zeichen';
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t4}/rechnungen`);
        process.env.ZAHLUNGSDATEN_SCHLUESSEL = SCHLUESSEL;
        assert.equal(r.status, 409);
        assert.match(r.daten.error, /Konto des Ausrichters nicht lesbar/);
        assert.equal(await zaehler(), 8);
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t4}/rechnungen`);
        assert.equal(r.daten.erstellt, 1);
        assert.equal(await zaehler(), 9);

        // Ohne SMTP (echter Mailer): Rechnung bleibt offen, PDF bleibt herunterladbar
        setzeTestVersand(null);
        const t6 = await neuesTurnier({ bezeichnung: 'Ohne-SMTP-Cup' });
        await zw(knex, t6, 'JC A', 'ueberweisung', 's@jc-a.de');
        await tn(knex, t6, 'JC A', { gewogen: true });
        r = await aufruf('u-admin', 'POST', `/api/abrechnung/${t6}/rechnungen`);
        assert.deepEqual([r.daten.erstellt, r.daten.versendet, r.daten.fehler.length], [1, 0, 1]);
        const r6 = await knex('rechnungen').where({ turnier_id: t6 }).first();
        assert.equal(r6.status, 'offen');
        assert.match(r6.versand_fehler, /SMTP/);

        // Protokoll: Aktionen mit Klartext, nirgends eine IBAN (die Middleware schreibt nach der Antwort)
        await new Promise((resolve) => setTimeout(resolve, 500));
        const protokoll = await knex('aktionsprotokoll').select('aktion', 'beschreibung', 'details');
        const aktionen = protokoll.map((p) => p.aktion);
        assert.ok(aktionen.includes('abrechnung.rechnungslauf'));
        assert.ok(aktionen.includes('abrechnung.senden'));
        assert.ok(aktionen.includes('abrechnung.bezahlt'));
        assert.equal(protokoll.find((p) => p.aktion === 'abrechnung.rechnungslauf').beschreibung, 'Rechnungen erstellt und versendet');
        assert.doesNotMatch(JSON.stringify(protokoll), IBAN_MUSTER);
        assert.doesNotMatch(konsole.join('\n'), IBAN_MUSTER);
    } finally {
        setzeTestVersand(null);
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
