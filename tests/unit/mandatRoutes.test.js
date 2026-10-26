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
process.env.JWT_SECRET = 'mandat-routen-test-geheimnis';
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'mandat-routen-schluessel-mit-mindestens-32-zeichen';
process.env.PUBLIC_BASE_URL = 'https://hajime.example.de';

const jwt = (await import('jsonwebtoken')).default;
const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { getZahlwegRoutes } = await import('../../src/routes/zahlwegRoutes.js');
const { getMandatRoutes } = await import('../../src/routes/mandatRoutes.js');
const { IBAN_MUSTER } = await import('../../src/shared/iban.js');
const m = await import('../../src/services/mandate.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const IBAN = 'DE89370400440532013000';
const STAMMDATEN = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE75512108001245126199',
    glaeubiger_id: 'DE98ZZZ09999999999'
};
const RECHNUNG = { rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 2, Köln' };
const LASTSCHRIFT = {
    zahlweg: 'lastschrift', ...RECHNUNG,
    iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Kasse JC A e.V.', zustimmung: true, vertretung_bestaetigt: true
};
const inTagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const tokenAusMail = (mail) => /mandat-bestaetigen\.html\?token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];

test('Mandat-API: erteilen, Link öffnen, bestätigen, Protokoll', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const mails = [];
    setzeTestVersand((mail) => { mails.push(mail); });
    const app = express();
    app.set('knex', knex);
    app.use(express.json());
    app.use('/api/zahlweg', getZahlwegRoutes(knex));
    app.use('/api/mandat', getMandatRoutes(knex));
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
    const klartextFrei = (obj) => assert.ok(!JSON.stringify(obj).replace(/\s/g, '').includes(IBAN), 'Klar-IBAN in der Antwort');
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        const vC = id((await knex('vereine').insert({ name: 'JC C' }).returning('id'))[0]);
        for (const [n, v, rolle] of [['ben', vA, 'benutzer'], ['ad1', vA, 'admin'], ['benB', vB, 'benutzer'], ['adC', vC, 'admin']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: v });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: v, freigegeben: 1, rolle });
        }
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ben');
        const t = id((await knex('turniere').insert({
            bezeichnung: 'Herbst-Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('id'))[0]);

        // GET: Vorschau, noch kein Mandat
        let r = await aufruf('u-ben', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.ok(r.daten.angebotene.includes('lastschrift'));
        assert.equal(r.daten.mandat, null);
        assert.equal(r.daten.istAdminDesVereins, false);
        assert.match(r.daten.mandatsvorschau.mandatstext, /Gläubiger-Identifikationsnummer: DE98ZZZ09999999999/);
        assert.equal(r.daten.mandatsvorschau.glaeubigerName, 'JC Ausrichter e.V.');
        assert.equal(r.daten.mandatsvorschau.vorabTage, 5);

        // PUT als Benutzer: unbestätigt, ein Admin bekommt die Mail
        r = await aufruf('u-ben', 'PUT', `/api/zahlweg/${t}`, LASTSCHRIFT);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.bestaetigungNoetig, true);
        assert.equal(r.daten.empfaengerAnzahl, 1);
        assert.equal(r.daten.mandat.status, 'unbestaetigt');
        assert.match(r.daten.mandat.iban_maske, /^DE89 \*{4}/);
        klartextFrei(r.daten);
        assert.equal(mails.length, 1);
        assert.equal(mails[0].to, 'ad1@test.de');
        const token = tokenAusMail(mails[0]);

        // GET zahlweg danach: maskiertes Mandat
        r = await aufruf('u-ben', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.daten.mandat.status, 'unbestaetigt');
        klartextFrei(r.daten);

        // Öffentliche Seite ohne Anmeldung
        r = await aufruf(null, 'GET', `/api/mandat/${token}`);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.vereinName, 'JC A');
        assert.equal(r.daten.turnierBezeichnung, 'Herbst-Cup');
        assert.match(r.daten.mandatstext, /SEPA-Lastschriftmandat/);
        assert.deepEqual(Object.keys(r.daten).sort(), ['mandat', 'mandatstext', 'turnierBezeichnung', 'vereinName']);
        assert.deepEqual(Object.keys(r.daten.mandat).sort(), ['iban_maske', 'kontoinhaber_maske', 'mandatsreferenz']);
        klartextFrei(r.daten);
        assert.ok(!r.daten.mandatstext.includes('Kasse JC A'), 'Kontoinhaber nicht im Mandatstext');

        // Fehlende Vertretungsbestätigung: 400, Link bleibt gültig
        r = await aufruf(null, 'POST', `/api/mandat/${token}`, { entscheidung: 'bestaetigen' });
        assert.equal(r.status, 400);
        assert.equal((await aufruf(null, 'GET', `/api/mandat/${token}`)).status, 200);
        r = await aufruf(null, 'POST', `/api/mandat/${token}`, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.mandat.status, 'gueltig');
        klartextFrei(r.daten);
        assert.equal((await aufruf(null, 'POST', `/api/mandat/${token}`, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })).status, 410);
        assert.equal((await aufruf(null, 'GET', `/api/mandat/${token}`)).status, 410);
        assert.equal((await aufruf(null, 'GET', '/api/mandat/gibt-es-nicht-gibt-es-nicht-gibt-es-nicht')).status, 404);
        r = await aufruf('u-ben', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.daten.mandat.status, 'gueltig');

        // Aktionsprotokoll: IP, nie eine IBAN
        const protokoll = await knex('aktionsprotokoll').whereIn('aktion', ['mandat.erteilt', 'mandat.entscheidung']).orderBy('id');
        assert.deepEqual(protokoll.map((p) => p.aktion), ['mandat.erteilt', 'mandat.entscheidung']);
        for (const p of protokoll) {
            assert.ok(p.ip, 'IP fehlt');
            assert.equal(`${p.beschreibung} ${JSON.stringify(p.details)} ${p.pfad ?? ''}`.match(IBAN_MUSTER), null);
            assert.equal(p.details.turnierId, t);
            assert.ok(p.details.mandatId);
        }
        assert.equal(protokoll[0].benutzer_id, 'u-ben');
        assert.equal(protokoll[1].benutzer_id, 'u-ad1');

        // Ein Admin des zahlenden Vereins erteilt: sofort gültig, keine Mail
        const mailsVorher = mails.length;
        r = await aufruf('u-ad1', 'GET', `/api/zahlweg/${t}`);
        assert.equal(r.daten.istAdminDesVereins, true);
        r = await aufruf('u-ad1', 'PUT', `/api/zahlweg/${t}`, LASTSCHRIFT);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.bestaetigungNoetig, false);
        assert.equal(r.daten.mandat.status, 'gueltig');
        assert.equal(mails.length, mailsVorher);
        klartextFrei(r.daten);
        const widerrufen = await knex('aktionsprotokoll').where({ aktion: 'mandat.widerrufen' });
        assert.equal(widerrufen.length, 1, 'ersetztes Mandat wird protokolliert');

        // Verein ohne bestätigenden Admin: empfaengerAnzahl 0, keine Mail
        mails.length = 0;
        r = await aufruf('u-benB', 'PUT', `/api/zahlweg/${t}`, LASTSCHRIFT);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.bestaetigungNoetig, true);
        assert.equal(r.daten.empfaengerAnzahl, 0);
        assert.equal(mails.length, 0);
        const ohneIban = { ...LASTSCHRIFT };
        delete ohneIban.iban;
        r = await aufruf('u-benB', 'PUT', `/api/zahlweg/${t}`, ohneIban);
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.empfaengerAnzahl, 0, 'auch beim Speichern ohne neue IBAN');

        // Token eines Ex-Admins: 403, Link bleibt gültig
        await knex('benutzer').insert({ id: 'u-benC', email: 'benC@test.de', vorname: 'c', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vC });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-benC', verein_id: vC, freigegeben: 1, rolle: 'benutzer' });
        mails.length = 0;
        r = await aufruf('u-benC', 'PUT', `/api/zahlweg/${t}`, LASTSCHRIFT);
        assert.equal(r.daten.empfaengerAnzahl, 1);
        const tokenC = tokenAusMail(mails[0]);
        await knex('benutzer_vereine').where({ benutzer_id: 'u-adC' }).update({ rolle: 'benutzer' });
        r = await aufruf(null, 'POST', `/api/mandat/${tokenC}`, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true });
        assert.equal(r.status, 403);
        await knex('benutzer_vereine').where({ benutzer_id: 'u-adC' }).update({ rolle: 'admin' });
        r = await aufruf(null, 'POST', `/api/mandat/${tokenC}`, { entscheidung: 'ablehnen' });
        assert.equal(r.status, 200, JSON.stringify(r.daten));
        assert.equal(r.daten.mandat.status, 'abgelehnt');
    } finally {
        setzeTestVersand(null);
        await new Promise((resolve) => server.close(resolve));
        await stoppe();
    }
});

test('Mandat-API: ohne PUBLIC_BASE_URL kein Speichern durch Nicht-Admins (503)', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const alt = process.env.PUBLIC_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    setzeTestVersand(() => {});
    const app = express();
    app.use(express.json());
    app.use('/api/zahlweg', getZahlwegRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const put = (benutzerId, body, turnier) => fetch(`${basis}/api/zahlweg/${turnier}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign({ id: benutzerId }, process.env.JWT_SECRET)}` },
        body: JSON.stringify(body)
    });
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        for (const [n, rolle] of [['ben', 'benutzer'], ['ad', 'admin']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vA });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: vA, freigegeben: 1, rolle });
        }
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ben');
        const t = id((await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,lastschrift'
        }).returning('id'))[0]);
        const res = await put('u-ben', LASTSCHRIFT, t);
        assert.equal(res.status, 503);
        assert.equal((await knex('lastschrift_mandate')).length, 0);
        assert.equal((await knex('turnier_zahlwege')).length, 0, 'nichts gespeichert');
        assert.equal((await put('u-ad', LASTSCHRIFT, t)).status, 200, 'ein Admin erteilt auch ohne Basis-URL');
    } finally {
        process.env.PUBLIC_BASE_URL = alt;
        setzeTestVersand(null);
        await new Promise((resolve) => server.close(resolve));
        await stoppe();
    }
});

test('Mandatsreferenz: Zusatz aus dem größten vorhandenen Zusatz, erteileMandat lädt die Zeile nach dem Lock neu', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    setzeTestVersand(() => {});
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-ad', email: 'ad@test.de', vorname: 'ad', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vA });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-ad', verein_id: vA, freigegeben: 1, rolle: 'admin' });
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ad');
        const turnier = (await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,lastschrift'
        }).returning('*'))[0];
        const zeile = (await knex('turnier_zahlwege').insert({ turnier_id: turnier.id, verein_id: vA, verein_name: 'JC A', zahlweg: 'lastschrift', ...RECHNUNG }).returning('*'))[0];
        const benutzer = { id: 'u-ad', istAdminDesVereins: true };
        const eingabe = { iban: IBAN, kontoinhaber: 'JC A', zustimmung: true, vertretung_bestaetigt: true };
        const erteile = () => m.erteileMandat(knex, { turnier, zahlwegZeile: zeile, eingabe, benutzer, ip: '1.2.3.4', basisUrl: 'https://x.de' });
        const refs = async () => (await knex('lastschrift_mandate').where({ zahlweg_id: zeile.id }).orderBy('id')).map((z) => z.mandatsreferenz);
        for (let i = 0; i < 3; i += 1) await erteile();
        const vorher = await refs();
        assert.equal(vorher.length, 3);
        assert.match(vorher[1], /-2$/);
        assert.match(vorher[2], /-3$/);
        // Altes Mandat (Löschfrist) ist weg: eine Zählung würde 2 ergeben und "-3" doppelt vergeben
        await knex('lastschrift_mandate').where({ mandatsreferenz: vorher[0] }).del();
        const ergebnis = await erteile();
        assert.ok(ergebnis.mandat.mandatsreferenz.endsWith('-4'), ergebnis.mandat.mandatsreferenz);
        assert.equal(new Set(await refs()).size, 3);

        // Zahlweg wurde inzwischen umgestellt: die veraltete Zeile erteilt kein Mandat mehr
        await knex('turnier_zahlwege').where({ id: zeile.id }).update({ zahlweg: 'ueberweisung' });
        await assert.rejects(erteile(), (e) => e.statusCode === 409);
    } finally {
        setzeTestVersand(null);
        await stoppe();
    }
});
