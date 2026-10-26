import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'mandat-test-schluessel-mit-mindestens-32-zeichen';

const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const zw = await import('../../src/services/zahlwege.js');
const m = await import('../../src/services/mandate.js');
const { stelleUnbestaetigteUm, erinnereUnbestaetigte, startMandatJob } = await import('../../src/services/mandatJob.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { pruefeToken } = await import('../../src/services/einmalToken.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const IBAN = 'DE89370400440532013000';
const BASIS = 'https://hajime.example.de';
const STAMMDATEN = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE75512108001245126199',
    glaeubiger_id: 'DE98ZZZ09999999999'
};
const RECHNUNG = { rechnung_email: 'zahler@jc-a.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 2, Köln' };
const MANDAT = { iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Kasse JC A e.V.', zustimmung: true, vertretung_bestaetigt: true };
const inTagen = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const fehlerInfo = async (fn) => {
    try { await fn(); } catch (e) { return { status: e.statusCode ?? null, text: e.message }; }
    return null;
};

test('Anmeldeschluss-Job: Umstellung auf Bar, Sperre der Bestätigung, einmalige Erinnerung', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const mails = [];
    setzeTestVersand((mail) => { mails.push(mail); });
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        const konto = async (n, verein, rolle) => {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: verein });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: verein, freigegeben: 1, rolle });
        };
        await konto('aus', vAus, 'admin');
        await konto('ben', vA, 'benutzer');
        await konto('ad1', vA, 'admin');
        await konto('ad2', vA, 'admin');
        await konto('benb', vB, 'benutzer');
        await konto('adb', vB, 'admin');
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-aus');

        const neuesTurnier = async (extra = {}) => (await knex('turniere').insert({
            bezeichnung: 'Herbst-Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift', ...extra
        }).returning('*'))[0];
        const tokenAus = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
        const speichere = (turnier, vereinName, vereinId, benutzerId, istAdmin) => zw.speichereZahlweg(knex, {
            turnier, vereinName, vereinId, benutzerId, eingabe: { zahlweg: 'lastschrift', ...RECHNUNG, ...MANDAT },
            istAdminDesVereins: istAdmin, ip: '203.0.113.7', basisUrl: BASIS
        });
        const setzeSchluss = (t, tage) => knex('turniere').where({ id: t.id }).update({ anmeldeschluss: inTagen(tage) });
        const zahlweg = (t, name = 'JC A') => knex('turnier_zahlwege').where({ turnier_id: t.id, verein_name: name }).first();
        const mandat = (t, name = 'JC A') => knex('lastschrift_mandate').where({ turnier_id: t.id, verein_name: name }).orderBy('id').first();

        // --- Umstellung ---
        const t1 = await neuesTurnier();
        const tOffen = await neuesTurnier();
        await speichere(t1, 'JC A', vA, 'u-ben', false);
        await speichere(tOffen, 'JC A', vA, 'u-ben', false);
        await speichere(t1, 'JC B', vB, 'u-benb', false);
        const altToken = tokenAus(mails.find((x) => x.to === 'ad1@test.de'));
        mails.length = 0;

        // Anmeldung offen: nichts passiert
        assert.equal(await stelleUnbestaetigteUm(knex), 0);
        assert.equal((await zahlweg(t1)).zahlweg, 'lastschrift');

        await setzeSchluss(t1, -2);
        // Export-Aufruf: nur das eine Turnier
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: tOffen.id }), 0);
        assert.equal((await zahlweg(t1)).zahlweg, 'lastschrift');

        // Bestätigung nach dem Anmeldeschluss: gesperrt (410), Anzeige ebenso
        const gesperrt = await fehlerInfo(() => m.entscheideMandat(knex, altToken, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true }));
        assert.equal(gesperrt.status, 410);
        assert.match(gesperrt.text, /Die Anmeldefrist ist abgelaufen/);
        assert.equal((await fehlerInfo(() => m.ladeMandatFuerToken(knex, altToken))).status, 410);
        assert.equal((await mandat(t1)).status, 'unbestaetigt');

        // Ein Mailfehler macht die Umstellung nicht rückgängig
        const anzahl = await stelleUnbestaetigteUm(knex, { turnierId: t1.id, sende: async () => { throw new Error('smtp'); } });
        assert.equal(anzahl, 2);
        let z = await zahlweg(t1);
        assert.equal(z.zahlweg, 'bar');
        assert.equal(z.mandat_gueltig, false);
        const md = await mandat(t1);
        assert.equal(md.status, 'umgestellt');
        assert.equal(md.daten_verschluesselt, null);
        assert.ok(md.loeschen_ab);
        assert.equal(await pruefeToken(knex, altToken, 'mandat'), null);
        assert.equal((await zahlweg(t1, 'JC B')).zahlweg, 'bar');
        assert.equal((await zahlweg(tOffen)).zahlweg, 'lastschrift');

        // Zweiter Lauf: nichts mehr
        assert.equal(await stelleUnbestaetigteUm(knex), 0);

        // Protokoll beim zahlenden Verein (Systemaktion ohne Konto)
        const eintraege = await knex('aktionsprotokoll').where({ aktion: 'mandat.umgestellt' });
        assert.equal(eintraege.length, 2);
        const eintragA = eintraege.find((e) => e.verein_id === vA);
        assert.ok(eintragA);
        assert.equal(eintragA.verein_name, 'JC A');
        assert.equal(eintragA.benutzer_id, null);
        assert.ok(!JSON.stringify(eintragA).includes(IBAN));

        // --- Mails: Rechnungs-E-Mail und Admins des zahlenden Vereins, ohne IBAN ---
        const t2 = await neuesTurnier();
        await speichere(t2, 'JC A', vA, 'u-ben', false);
        await setzeSchluss(t2, -1);
        mails.length = 0;
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: t2.id }), 1);
        assert.deepEqual(mails.map((x) => x.to).sort(), ['ad1@test.de', 'ad2@test.de', 'zahler@jc-a.de']);
        for (const mail of mails) {
            assert.match(mail.text, /wird das Startgeld bar vor Ort kassiert/);
            const alles = JSON.stringify(mail);
            for (const muster of [IBAN, 'DE89 3704', 'DE89 ****', 'Kasse JC A', '203.0.113.7']) assert.ok(!alles.includes(muster), `${muster} in Mail`);
        }

        // --- Gültiges Mandat bleibt ---
        const t3 = await neuesTurnier();
        await speichere(t3, 'JC A', vA, 'u-ad1', true);
        assert.equal((await mandat(t3)).status, 'gueltig');
        await setzeSchluss(t3, -3);
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: t3.id }), 0);
        z = await zahlweg(t3);
        assert.equal(z.zahlweg, 'lastschrift');
        assert.equal(z.mandat_gueltig, true);
        assert.equal((await mandat(t3)).status, 'gueltig');

        // --- Abgelehntes Mandat wird ebenfalls umgestellt ---
        const t4 = await neuesTurnier();
        mails.length = 0;
        await speichere(t4, 'JC A', vA, 'u-ben', false);
        await m.entscheideMandat(knex, tokenAus(mails.find((x) => x.to === 'ad1@test.de')), { entscheidung: 'ablehnen' });
        assert.equal((await mandat(t4)).status, 'abgelehnt');
        await setzeSchluss(t4, -1);
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: t4.id }), 1);
        assert.equal((await zahlweg(t4)).zahlweg, 'bar');
        assert.equal((await mandat(t4)).status, 'abgelehnt');

        // --- Erinnerung ---
        const t5 = await neuesTurnier({ anmeldeschluss: inTagen(2) });
        const tFern = await neuesTurnier({ anmeldeschluss: inTagen(6) });
        mails.length = 0;
        await speichere(t5, 'JC A', vA, 'u-ben', false);
        await speichere(tFern, 'JC A', vA, 'u-ben', false);
        const ersteToken = tokenAus(mails.find((x) => x.to === 'ad1@test.de'));
        mails.length = 0;
        const erinnerung = [];
        const sende = (mail) => { erinnerung.push(mail); };
        const lauf = await Promise.all([
            erinnereUnbestaetigte(knex, { sende, basisUrl: BASIS }),
            erinnereUnbestaetigte(knex, { sende, basisUrl: BASIS })
        ]);
        assert.equal(lauf[0] + lauf[1], 1);
        assert.deepEqual(erinnerung.map((x) => x.to).sort(), ['ad1@test.de', 'ad2@test.de']);
        assert.ok((await mandat(t5)).erinnert_am);
        assert.equal((await mandat(tFern)).erinnert_am, null);
        for (const mail of erinnerung) assert.ok(!JSON.stringify(mail).includes('DE89 3704'));
        assert.equal(await erinnereUnbestaetigte(knex, { sende, basisUrl: BASIS }), 0);
        assert.equal(erinnerung.length, 2);
        // Alte Links sind verbraucht, neue gelten und bestätigen
        assert.equal(await pruefeToken(knex, ersteToken, 'mandat'), null);
        const neuToken = tokenAus(erinnerung.find((x) => x.to === 'ad1@test.de'));
        assert.ok(await pruefeToken(knex, neuToken, 'mandat'));
        assert.equal((await m.entscheideMandat(knex, neuToken, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })).status, 'gueltig');
    } finally {
        setzeTestVersand(null);
        await stoppe();
    }
});

test('Abgesagt, Entwurf, ohne Anmeldeschluss und Export (Verhalten)', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const mails = [];
    setzeTestVersand((mail) => { mails.push(mail); });
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const konto = async (n, verein, rolle) => {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: verein });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: verein, freigegeben: 1, rolle });
        };
        await konto('aus', vAus, 'admin');
        await konto('ben', vA, 'benutzer');
        await konto('ad1', vA, 'admin');
        const vB = id((await knex('vereine').insert({ name: 'JC B' }).returning('id'))[0]);
        await konto('adb', vB, 'admin');
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-aus');
        const neuesTurnier = async (extra = {}) => (await knex('turniere').insert({
            bezeichnung: 'Herbst-Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift', ...extra
        }).returning('*'))[0];
        const speichereB = (turnier) => zw.speichereZahlweg(knex, {
            turnier, vereinName: 'JC B', vereinId: vB, benutzerId: 'u-adb', eingabe: { zahlweg: 'lastschrift', ...RECHNUNG, ...MANDAT },
            istAdminDesVereins: true, ip: '203.0.113.7', basisUrl: BASIS
        });
        const protokollAnzahl = async () => (await knex('aktionsprotokoll').whereIn('aktion', ['mandat.widerrufen', 'mandat.umgestellt'])).length;
        const speichere = (turnier) => zw.speichereZahlweg(knex, {
            turnier, vereinName: 'JC A', vereinId: vA, benutzerId: 'u-ben', eingabe: { zahlweg: 'lastschrift', ...RECHNUNG, ...MANDAT },
            istAdminDesVereins: false, ip: '203.0.113.7', basisUrl: BASIS
        });
        const tokenAus = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
        const zahlweg = (t) => knex('turnier_zahlwege').where({ turnier_id: t.id, verein_name: 'JC A' }).first();
        const mandat = (t) => knex('lastschrift_mandate').where({ turnier_id: t.id, verein_name: 'JC A' }).orderBy('id').first();

        // abgesagt: Mandat zurückgezogen (IBAN weg), Zahlweg bleibt, keine Mail, Bestätigung 410 "abgesagt"
        const tAbg = await neuesTurnier();
        await speichere(tAbg);
        await speichereB(tAbg); // sofort gültig
        const token = tokenAus(mails.find((x) => x.to === 'ad1@test.de'));
        mails.length = 0;
        await knex('turniere').where({ id: tAbg.id }).update({ status: 'abgesagt', anmeldeschluss: inTagen(-2) });
        const sperre = await fehlerInfo(() => m.entscheideMandat(knex, token, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true }));
        assert.equal(sperre.status, 410);
        assert.equal(sperre.text, 'Das Turnier wurde abgesagt.');
        assert.equal((await fehlerInfo(() => m.ladeMandatFuerToken(knex, token))).text, 'Das Turnier wurde abgesagt.');
        assert.equal(await stelleUnbestaetigteUm(knex), 0);
        const protokollNach1 = await protokollAnzahl();
        assert.equal(protokollNach1, 2);
        const stand1 = JSON.stringify(await knex('lastschrift_mandate').where({ turnier_id: tAbg.id }).orderBy('id'));
        assert.equal(await stelleUnbestaetigteUm(knex), 0); // zweiter Lauf: nichts mehr, kein Protokoll
        assert.equal(await protokollAnzahl(), protokollNach1);
        assert.equal(JSON.stringify(await knex('lastschrift_mandate').where({ turnier_id: tAbg.id }).orderBy('id')), stand1);
        assert.deepEqual((await knex('lastschrift_mandate').where({ turnier_id: tAbg.id }).orderBy('id')).map((x) => x.status), ['widerrufen', 'widerrufen']);
        assert.equal((await zahlweg(tAbg)).zahlweg, 'lastschrift');
        const md = await mandat(tAbg);
        assert.equal(md.status, 'widerrufen');
        assert.equal(md.daten_verschluesselt, null);
        assert.ok(md.loeschen_ab);
        assert.equal(mails.length, 0);
        assert.equal(await pruefeToken(knex, token, 'mandat'), null);

        // abgeschlossen: stille Umstellung, ebenfalls nur einmal protokolliert
        const tFertig = await neuesTurnier();
        await speichere(tFertig);
        await knex('turniere').where({ id: tFertig.id }).update({ status: 'abgeschlossen', anmeldeschluss: inTagen(-5), datum: inTagen(-3) });
        mails.length = 0;
        const vorher = await protokollAnzahl();
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: tFertig.id }), 1);
        assert.equal(await stelleUnbestaetigteUm(knex, { turnierId: tFertig.id }), 0);
        assert.equal(await protokollAnzahl(), vorher + 1);
        assert.equal((await zahlweg(tFertig)).zahlweg, 'bar');
        assert.equal(mails.length, 0);

        // Entwurf und Turnier ohne Anmeldeschluss: unberührt
        const tEnt = await neuesTurnier();
        await speichere(tEnt);
        await knex('turniere').where({ id: tEnt.id }).update({ status: 'entwurf', anmeldeschluss: inTagen(-2) });
        const tOhne = await neuesTurnier();
        await speichere(tOhne);
        await knex('turniere').where({ id: tOhne.id }).update({ anmeldeschluss: null });
        mails.length = 0;
        assert.equal(await stelleUnbestaetigteUm(knex), 0);
        for (const t of [tEnt, tOhne]) {
            assert.equal((await zahlweg(t)).zahlweg, 'lastschrift');
            assert.equal((await mandat(t)).status, 'unbestaetigt');
        }
        assert.equal(mails.length, 0);

        // Export-Handler: stellt um, Antwort enthält den Bar-Zahlweg, Mails kommen ohne Warten hinterher
        const tExp = await neuesTurnier();
        await speichere(tExp);
        await knex('turniere').where({ id: tExp.id }).update({ anmeldeschluss: inTagen(-2) });
        mails.length = 0;
        const { exportTurnier } = await import('../../src/controllers/turnierController.js');
        const antwort = { kopf: {}, status: 200 };
        const res = {
            status(code) { antwort.status = code; return this; },
            json(daten) { antwort.daten = daten; return this; },
            setHeader(k, v) { antwort.kopf[k] = v; },
            send(text) { antwort.text = text; return this; }
        };
        await exportTurnier(knex, { params: { id: String(tExp.id) }, user: { id: 'u-aus' }, query: {} }, res);
        assert.equal(antwort.status, 200, JSON.stringify(antwort.daten));
        assert.equal((await zahlweg(tExp)).zahlweg, 'bar');
        assert.equal((await mandat(tExp)).status, 'umgestellt');
        assert.ok(!antwort.text.includes('DE89'));
        for (let i = 0; i < 50 && mails.length < 2; i += 1) await new Promise((r) => setTimeout(r, 100));
        assert.ok(mails.some((x) => x.to === 'zahler@jc-a.de'));
    } finally {
        setzeTestVersand(null);
        await stoppe();
    }
});

test('startMandatJob liefert eine Stopp-Funktion, die App startet den Job nur in der Cloud', () => {
    const stopp = startMandatJob({}, { intervallMs: 1000 });
    assert.equal(typeof stopp, 'function');
    stopp();
    const app = fs.readFileSync(new URL('../../src/app.js', import.meta.url), 'utf8');
    assert.match(app, /istCloud && process\.env\.NODE_ENV !== 'test'\) \{\s+startMandatJob\(knex\)/);
});
