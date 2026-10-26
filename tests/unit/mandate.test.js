import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// wie src/app.js: DATE-Spalten als Text
pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'mandat-test-schluessel-mit-mindestens-32-zeichen';

const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const m = await import('../../src/services/mandate.js');
const zw = await import('../../src/services/zahlwege.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { erzeugeToken } = await import('../../src/services/einmalToken.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const IBAN = 'DE89370400440532013000';
const IBAN2 = 'DE02120300000000202051';
const BASIS = 'https://hajime.example.de';
const STAMMDATEN = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE75512108001245126199',
    glaeubiger_id: 'DE98ZZZ09999999999'
};
const RECHNUNG = { rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 2, Köln' };
const MANDAT = { iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Kasse JC A e.V.', zustimmung: true, vertretung_bestaetigt: true };

function inTagen(n) {
    return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

const fehlerStatus = async (fn) => {
    try { await fn(); } catch (e) { return e.statusCode ?? e; }
    return null;
};

test('berechneLoeschenAb: plus 14 Monate, Monatsende begrenzt', () => {
    assert.equal(m.berechneLoeschenAb('2026-11-03'), '2028-01-03');
    assert.equal(m.berechneLoeschenAb('2026-12-31'), '2028-02-29');
    assert.equal(m.berechneLoeschenAb('2027-12-31'), '2029-02-28');
    assert.equal(m.berechneLoeschenAb('2026-01-15T10:00:00Z'), '2027-03-15');
});

test('Mandats-Service: erteilen, bestätigen, ablehnen, widerrufen', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const mails = [];
    setzeTestVersand((mail) => { mails.push(mail); });
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const konto = async (n, verein, rolle, extra = {}) => {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: verein, ...extra });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: verein, freigegeben: 1, rolle });
        };
        await konto('aus', vAus, 'admin');
        await konto('ben', vA, 'benutzer');
        await konto('ad1', vA, 'admin');
        await konto('ad2', vA, 'admin');
        await konto('gesperrt', vA, 'admin', { gesperrt: true });
        await konto('unbest', vA, 'admin', { email_bestaetigt_am: null });
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-aus');

        const neuesTurnier = async (extra = {}) => (await knex('turniere').insert({
            bezeichnung: 'Herbst-Cup', ort: 'Halle', datum: inTagen(20), anmeldeschluss: inTagen(10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift', ...extra
        }).returning('*'))[0];
        const t = await neuesTurnier();
        const tnA = id((await knex('turnier_teilnehmer').insert({
            turnier_id: t.id, judopass_id: 'P-1', vorname: 'V', nachname: 'N', geschlecht: 'm', verein: 'JC A',
            gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
        }).returning('id'))[0]);

        const speichere = (benutzerId, istAdmin, eingabe, turnier = t) => zw.speichereZahlweg(knex, {
            turnier, vereinName: 'JC A', vereinId: vA, benutzerId, eingabe,
            istAdminDesVereins: istAdmin, ip: '203.0.113.7', basisUrl: BASIS
        });
        const zahlweg = () => knex('turnier_zahlwege').where({ turnier_id: t.id, verein_name: 'JC A' }).first();
        const mandate = () => knex('lastschrift_mandate').where({ turnier_id: t.id, verein_name: 'JC A' }).orderBy('id');
        const gesichert = async () => (await knex('turnier_teilnehmer').where({ id: tnA }).first()).startgeld_zahlweg_gesichert;
        const tokenAus = (mail) => /token=([A-Za-z0-9_-]+)/.exec(mail.text)[1];
        const keineKlarIban = async () => {
            for (const tabelle of ['lastschrift_mandate', 'turnier_zahlwege', 'token_einmal', 'turnier_teilnehmer']) {
                const text = JSON.stringify(await knex(tabelle).select('*'));
                for (const muster of [IBAN, IBAN2, 'DE89 3704', 'Kasse JC A', '203.0.113.7']) {
                    assert.ok(!text.includes(muster), `${muster} im Klartext in ${tabelle}`);
                }
            }
        };

        // Eingabeprüfungen (400), ohne dass etwas gespeichert wird
        const lastschrift = { zahlweg: 'lastschrift', ...RECHNUNG };
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, iban: 'DE00 1234' })), 400);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, vertretung_bestaetigt: false })), 400);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, zustimmung: false })), 400);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, kontoinhaber: ' ' })), 400);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, kontoinhaber: 'x'.repeat(71) })), 400);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, lastschrift)), 400);
        assert.equal(await zahlweg(), undefined);
        assert.equal((await mandate()).length, 0);
        // Benutzer ohne Basis-URL: Bestätigungsmail nicht möglich -> 503, nichts gespeichert
        assert.equal(await fehlerStatus(() => zw.speichereZahlweg(knex, {
            turnier: t, vereinName: 'JC A', vereinId: vA, benutzerId: 'u-ben', eingabe: { ...lastschrift, ...MANDAT }, istAdminDesVereins: false, ip: '203.0.113.7', basisUrl: null
        })), 503);
        assert.equal(await zahlweg(), undefined);

        // Benutzer erteilt -> unbestätigt, je Admin (bestätigt, freigegeben, nicht gesperrt) eine Mail
        const erteilt = await speichere('u-ben', false, { ...lastschrift, ...MANDAT });
        assert.equal(erteilt.zahlweg, 'lastschrift');
        assert.equal(erteilt.mandat_gueltig, false);
        assert.equal(erteilt.bestaetigungNoetig, true);
        assert.equal(erteilt.mandat.status, 'unbestaetigt');
        assert.equal(erteilt.mandat.iban_maske, 'DE89 **** **** **** **** 00');
        assert.equal(erteilt.mandat.kontoinhaber_maske, 'Ka…');
        assert.equal(erteilt.mandat.textversion, '2026-11-v1');
        assert.ok(!JSON.stringify(erteilt).includes(IBAN));
        assert.deepEqual(Object.keys(erteilt.mandat).sort(),
            ['bestaetigt_am', 'erteilt_am', 'iban_maske', 'id', 'kontoinhaber_maske', 'mandatsreferenz', 'status', 'textversion']);
        assert.equal(mails.length, 2);
        assert.deepEqual(mails.map((x) => x.to).sort(), ['ad1@test.de', 'ad2@test.de']);
        const mail1 = mails.find((x) => x.to === 'ad1@test.de');
        const mail2 = mails.find((x) => x.to === 'ad2@test.de');
        assert.match(mail1.text, /Bitte bestätigen Sie das SEPA-Lastschriftmandat/);
        assert.match(mail1.text, /https:\/\/hajime\.example\.de\/mandat-bestaetigen\.html\?token=/);
        assert.notEqual(tokenAus(mail1), tokenAus(mail2));
        for (const mail of mails) {
            assert.ok(mail.text.includes('DE89 **** **** **** **** 00'));
            const alles = JSON.stringify(mail);
            for (const muster of [IBAN, 'DE89 3704', 'Kasse JC A', '203.0.113.7']) assert.ok(!alles.includes(muster), `${muster} in Mail`);
        }
        let [mandat] = await mandate();
        assert.equal(mandat.status, 'unbestaetigt');
        assert.match(mandat.daten_verschluesselt, /^z1:/);
        assert.equal(mandat.mandatsreferenz, `JCAM${t.id}V${(await zahlweg()).id}`);
        assert.equal(mandat.glaeubiger_id, 'DE98ZZZ09999999999');
        assert.equal(mandat.glaeubiger_name, 'JC Ausrichter e.V.');
        assert.equal(mandat.erteilt_von, 'u-ben');
        assert.equal(mandat.zahlender_verein_id, vA);
        assert.equal(mandat.vertretung_bestaetigt, true);
        assert.match(mandat.mandatstext, new RegExp(`Mandatsreferenz: ${mandat.mandatsreferenz}`));
        assert.deepEqual(await m.ladeMandatIban(knex, mandat.id), { iban: IBAN, kontoinhaber: 'Kasse JC A e.V.' });
        assert.equal((await zahlweg()).mandat_gueltig, false);
        assert.equal(await gesichert(), false);
        await keineKlarIban();

        // Anzeige über den Token: nur maskiert
        const anzeige = await m.ladeMandatFuerToken(knex, tokenAus(mail1));
        assert.equal(anzeige.mandat.status, 'unbestaetigt');
        assert.equal(anzeige.vereinName, 'JC A');
        assert.equal(anzeige.turnierBezeichnung, 'Herbst-Cup');
        assert.match(anzeige.mandatstext, /SEPA-Lastschriftmandat/);
        assert.ok(!JSON.stringify(anzeige).includes(IBAN));
        assert.equal(await m.ladeMandatFuerToken(knex, 'gibt-es-nicht'), null);

        // Bestätigen ohne Vertretungs-Häkchen -> 400, der Token bleibt gültig
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mail1), { entscheidung: 'bestaetigen', vertretung_bestaetigt: false })), 400);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mail1), { entscheidung: 'vielleicht', vertretung_bestaetigt: true })), 400);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, 'gibt-es-nicht', { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 404);

        // Admin 1 bestätigt -> gültig, gesichert; Token von Admin 2 danach 410
        const bestaetigt = await m.entscheideMandat(knex, tokenAus(mail1), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true });
        assert.equal(bestaetigt.status, 'gueltig');
        assert.ok(bestaetigt.bestaetigt_am);
        [mandat] = await mandate();
        assert.equal(mandat.bestaetigt_von, 'u-ad1');
        assert.ok(mandat.entschieden_am);
        assert.equal((await zahlweg()).mandat_gueltig, true);
        assert.equal(await gesichert(), true);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mail2), { entscheidung: 'ablehnen', vertretung_bestaetigt: true })), 410);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mail1), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);
        assert.equal(await m.ladeMandatFuerToken(knex, tokenAus(mail2)), null);
        assert.equal((await mandate())[0].status, 'gueltig');

        // Nur die Rechnungsangaben ändern: das gültige Mandat bleibt
        const nurMail = await speichere('u-ben', false, { ...lastschrift, rechnung_email: 'neu@b.de' });
        assert.equal(nurMail.mandat_gueltig, true);
        assert.equal(nurMail.rechnung_email, 'neu@b.de');
        assert.equal((await mandate()).length, 1);

        // Benutzer darf ein gültiges Mandat weder widerrufen noch ersetzen
        mails.length = 0;
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { zahlweg: 'ueberweisung', ...RECHNUNG })), 403);
        assert.equal(await fehlerStatus(() => speichere('u-ben', false, { ...lastschrift, ...MANDAT, iban: IBAN2 })), 403);
        assert.equal((await zahlweg()).zahlweg, 'lastschrift');
        assert.equal((await mandate())[0].status, 'gueltig');
        assert.equal(mails.length, 0);

        // Admin des Vereins wechselt auf Überweisung -> Mandat widerrufen, Chiffretext weg
        const ueberweisung = await speichere('u-ad2', true, { zahlweg: 'ueberweisung', ...RECHNUNG });
        assert.equal(ueberweisung.zahlweg, 'ueberweisung');
        assert.equal(ueberweisung.mandat_gueltig, false);
        [mandat] = await mandate();
        assert.equal(mandat.status, 'widerrufen');
        assert.equal(mandat.daten_verschluesselt, null);
        assert.ok(mandat.loeschen_ab >= m.berechneLoeschenAb(inTagen(-1)));
        assert.equal(await gesichert(), true); // Überweisung sichert sofort
        assert.equal(await fehlerStatus(() => m.ladeMandatIban(knex, mandat.id)), 409);

        // Benutzer erteilt neu (Wechsel von Überweisung); Admin widerruft, während der Link noch offen ist -> 410
        mails.length = 0;
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT, iban: IBAN2 });
        assert.equal(await gesichert(), false);
        assert.equal(mails.length, 2);
        const offenerToken = tokenAus(mails[0]);
        const neuesMandat = (await mandate())[1];
        assert.equal(neuesMandat.mandatsreferenz, `JCAM${t.id}V${(await zahlweg()).id}-2`);
        // Benutzer zieht ein unbestätigtes Mandat selbst zurück
        await speichere('u-ben', false, { zahlweg: 'bar', ...RECHNUNG });
        assert.equal((await mandate())[1].status, 'widerrufen');
        assert.equal((await mandate())[1].daten_verschluesselt, null);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, offenerToken, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);
        assert.equal((await mandate())[1].status, 'widerrufen');
        assert.equal((await zahlweg()).mandat_gueltig, false);
        assert.equal(await gesichert(), false);
        // Auch ein nachträglich zum alten Mandat erzeugter Token belebt es nicht wieder
        const spaeterToken = await erzeugeToken(knex, { benutzerId: 'u-ad1', zweck: 'mandat', vereinId: vA, gueltigStunden: 168, bezug: neuesMandat.id });
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, spaeterToken, { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);
        assert.equal((await mandate())[1].status, 'widerrufen');

        // Ablehnen -> abgelehnt, Chiffretext gelöscht, Zahlweg bleibt Lastschrift (nicht gesichert)
        mails.length = 0;
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT });
        const abzulehnen = tokenAus(mails[1]);
        const abgelehnt = await m.entscheideMandat(knex, abzulehnen, { entscheidung: 'ablehnen', vertretung_bestaetigt: false });
        assert.equal(abgelehnt.status, 'abgelehnt');
        let zeile = (await mandate())[2];
        assert.equal(zeile.daten_verschluesselt, null);
        assert.ok(zeile.loeschen_ab);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mails[0]), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);
        assert.equal((await zahlweg()).zahlweg, 'lastschrift');
        assert.equal((await zahlweg()).mandat_gueltig, false);
        // Nach Ablehnung darf der Benutzer selbst wechseln
        assert.equal(await m.widerrufeMandat(knex, { turnierId: t.id, vereinName: 'JC A', benutzer: { id: 'u-ben', istAdminDesVereins: false }, grund: 'wechsel' }), false);

        // Zweites Erteilen ersetzt das erste: genau ein aktives Mandat
        mails.length = 0;
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT });
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT, iban: IBAN2 });
        let aktiv = (await mandate()).filter((x) => ['unbestaetigt', 'gueltig'].includes(x.status));
        assert.equal(aktiv.length, 1);
        assert.equal((await m.ladeMandatIban(knex, aktiv[0].id)).iban, IBAN2);
        // Links zum ersetzten Mandat sind verbraucht
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mails[0]), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);

        // Admin erteilt -> sofort gültig, keine Mail, ersetzt das unbestätigte
        mails.length = 0;
        const adminErteilt = await speichere('u-ad1', true, { ...lastschrift, ...MANDAT });
        assert.equal(adminErteilt.bestaetigungNoetig, false);
        assert.equal(adminErteilt.mandat.status, 'gueltig');
        assert.equal(adminErteilt.mandat_gueltig, true);
        assert.equal(mails.length, 0);
        aktiv = (await mandate()).filter((x) => ['unbestaetigt', 'gueltig'].includes(x.status));
        assert.equal(aktiv.length, 1);
        assert.equal(aktiv[0].bestaetigt_von, 'u-ad1');
        assert.equal(await gesichert(), true);

        // Gleichzeitiges Erteilen: genau ein aktives Mandat, kein Fehler
        const zahlwegZeile = await zahlweg();
        const parallel = await Promise.allSettled([1, 2, 3].map(() => m.erteileMandat(knex, {
            turnier: t, zahlwegZeile, eingabe: MANDAT,
            benutzer: { id: 'u-ad2', istAdminDesVereins: true }, ip: '203.0.113.7', basisUrl: BASIS
        })));
        assert.deepEqual(parallel.map((p) => p.status), ['fulfilled', 'fulfilled', 'fulfilled'], JSON.stringify(parallel.map((p) => p.reason?.message)));
        aktiv = (await mandate()).filter((x) => ['unbestaetigt', 'gueltig'].includes(x.status));
        assert.equal(aktiv.length, 1);
        assert.equal(new Set((await mandate()).map((x) => x.mandatsreferenz)).size, (await mandate()).length);

        // Gleichzeitige Entscheidungen zweier Admins: genau eine gewinnt
        mails.length = 0;
        await m.widerrufeMandat(knex, { turnierId: t.id, vereinName: 'JC A', benutzer: { id: 'u-ad1', istAdminDesVereins: true }, grund: 'wechsel' });
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT });
        const entscheidungen = await Promise.allSettled([
            m.entscheideMandat(knex, tokenAus(mails[0]), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true }),
            m.entscheideMandat(knex, tokenAus(mails[1]), { entscheidung: 'ablehnen', vertretung_bestaetigt: true })
        ]);
        assert.equal(entscheidungen.filter((p) => p.status === 'fulfilled').length, 1);
        assert.equal(entscheidungen.find((p) => p.status === 'rejected').reason.statusCode, 410);
        zeile = (await mandate()).at(-1);
        const gewinner = entscheidungen.find((p) => p.status === 'fulfilled').value.status;
        assert.equal(zeile.status, gewinner);
        assert.equal((await zahlweg()).mandat_gueltig, gewinner === 'gueltig');

        // Ein Token eines Kontos, das nicht mehr Admin ist, entscheidet nicht
        mails.length = 0;
        await m.widerrufeMandat(knex, { turnierId: t.id, vereinName: 'JC A', benutzer: { id: 'u-ad1', istAdminDesVereins: true }, grund: 'wechsel' });
        await speichere('u-ben', false, { ...lastschrift, ...MANDAT });
        await knex('benutzer_vereine').where({ benutzer_id: 'u-ad2', verein_id: vA }).update({ rolle: 'benutzer' });
        const vonAd2 = mails.find((x) => x.to === 'ad2@test.de');
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(vonAd2), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 403);
        assert.equal((await mandate()).at(-1).status, 'unbestaetigt');

        // Umstellung (Job) setzt den Status 'umgestellt'
        assert.equal(await m.widerrufeMandat(knex, { turnierId: t.id, vereinName: 'JC A', benutzer: null, grund: 'umstellung' }), true);
        zeile = (await mandate()).at(-1);
        assert.equal(zeile.status, 'umgestellt');
        assert.equal(zeile.daten_verschluesselt, null);
        assert.equal(await fehlerStatus(() => m.entscheideMandat(knex, tokenAus(mails.find((x) => x.to === 'ad1@test.de')), { entscheidung: 'bestaetigen', vertretung_bestaetigt: true })), 410);

        // Am Ende: keine Klar-IBAN, kein Kontoinhaber, keine IP außerhalb des Chiffretexts
        await keineKlarIban();
    } finally {
        setzeTestVersand(null);
        await stoppe();
    }
});
