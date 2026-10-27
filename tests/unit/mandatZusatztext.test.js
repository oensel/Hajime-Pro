import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'zusatz-test-schluessel-mit-mindestens-32-zeichen';

const { setzeTestVersand } = await import('../../src/utils/mailer.js');
const zw = await import('../../src/services/zahlwege.js');
const { speichereStammdaten, ladeStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const {
    baueMandatstext, mandatstextVersion, normalisiereZusatztext, MANDATSTEXT_VERSION, MANDAT_ZUSATZTEXT_MAX
} = await import('../../src/shared/mandatText.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const STAMMDATEN = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Keine Umsatzsteuer.', rechnungs_praefix: 'JCA-',
    kontoinhaber: 'JC Ausrichter e.V.', iban: 'DE75512108001245126199', glaeubiger_id: 'DE98ZZZ09999999999'
};
const BASIS = {
    glaeubigerName: 'JC', glaeubigerId: 'DE98ZZZ09999999999', mandatsreferenz: 'R1', vorabTage: 5,
    turnierBezeichnung: 'Cup', zahlenderVerein: 'V'
};
const fehlerStatus = async (fn) => {
    try { await fn(); } catch (e) { return e.statusCode ?? e; }
    return null;
};

test('Zusatztext: normalisieren, Version und Text mit festem Kern', () => {
    assert.equal(normalisiereZusatztext(null), null);
    assert.equal(normalisiereZusatztext('  \n '), null);
    assert.equal(normalisiereZusatztext(' Zeile 1\r\nZeile\u0000 2 '), 'Zeile 1\nZeile 2');
    assert.equal(mandatstextVersion(null), MANDATSTEXT_VERSION);
    assert.equal(mandatstextVersion('  '), MANDATSTEXT_VERSION);
    assert.equal(mandatstextVersion('Hinweis'), `${MANDATSTEXT_VERSION}+zusatz`);

    const ohne = baueMandatstext(BASIS);
    const mit = baueMandatstext({ ...BASIS, zusatztext: 'Kontakt: kasse@jc.de' });
    assert.ok(!ohne.includes('Zusatz'));
    assert.ok(mit.startsWith(ohne), 'der feste Text bleibt unverändert, der Zusatz hängt nur hinten an');
    assert.ok(mit.endsWith('Zusatz des Gläubigers: Kontakt: kasse@jc.de'));
    for (const pflicht of ['Wir ermächtigen', 'weisen wir unser Kreditinstitut an', 'acht Wochen', 'DE98ZZZ09999999999', 'R1']) {
        assert.ok(mit.includes(pflicht), pflicht);
    }
});

test('Zusatztext: speichern, prüfen, leeren; neues Mandat übernimmt ihn samt Version, altes bleibt unverändert', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    setzeTestVersand(() => {});
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-ad', email: 'ad@test.de', vorname: 'A', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vA });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-ad', verein_id: vA, freigegeben: 1, rolle: 'admin' });

        // Eingabeprüfung
        assert.equal(await fehlerStatus(() => speichereStammdaten(knex, vAus, { ...STAMMDATEN, mandat_zusatztext: 'x'.repeat(MANDAT_ZUSATZTEXT_MAX + 1) }, 'u-ad')), 400);
        assert.equal(await fehlerStatus(() => speichereStammdaten(knex, vAus, { ...STAMMDATEN, mandat_zusatztext: { a: 1 } }, 'u-ad')), 400);
        assert.equal((await ladeStammdaten(knex, vAus)), null, 'bei Fehlern wird nichts gespeichert');

        const gespeichert = await speichereStammdaten(knex, vAus, { ...STAMMDATEN, mandat_zusatztext: '  Rückfragen: kasse@jc.de  ' }, 'u-ad');
        assert.equal(gespeichert.mandat_zusatztext, 'Rückfragen: kasse@jc.de');
        // Feld nicht mitgeschickt: bleibt erhalten
        assert.equal((await speichereStammdaten(knex, vAus, { absender_name: 'JC Ausrichter e.V.' }, 'u-ad')).mandat_zusatztext, 'Rückfragen: kasse@jc.de');

        const neuesTurnier = async (bezeichnung) => (await knex('turniere').insert({
            bezeichnung, ort: 'Halle', datum: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10),
            anmeldeschluss: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10), ausrichter: 'JC Ausrichter',
            verein_id: vAus, status: 'veroeffentlicht', startgeld: 8, angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('*'))[0];
        const erteile = (turnier) => zw.speichereZahlweg(knex, {
            turnier, vereinName: 'JC A', vereinId: vA, benutzerId: 'u-ad',
            eingabe: {
                zahlweg: 'lastschrift', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 2, Köln',
                iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Kasse JC A e.V.', zustimmung: true, vertretung_bestaetigt: true
            },
            istAdminDesVereins: true, ip: '203.0.113.7', basisUrl: 'https://hajime.example.de'
        });

        const t1 = await neuesTurnier('Cup Eins');
        await erteile(t1);
        const m1 = await knex('lastschrift_mandate').where({ turnier_id: t1.id }).first();
        assert.equal(m1.textversion, `${MANDATSTEXT_VERSION}+zusatz`);
        assert.ok(m1.mandatstext.endsWith('Zusatz des Gläubigers: Rückfragen: kasse@jc.de'));

        // Zusatz leeren: nur neue Mandate betroffen, das alte behält Wortlaut und Version
        assert.equal((await speichereStammdaten(knex, vAus, { mandat_zusatztext: '   ' }, 'u-ad')).mandat_zusatztext, null);
        const t2 = await neuesTurnier('Cup Zwei');
        await erteile(t2);
        const m2 = await knex('lastschrift_mandate').where({ turnier_id: t2.id }).first();
        assert.equal(m2.textversion, MANDATSTEXT_VERSION);
        assert.ok(!m2.mandatstext.includes('Zusatz'));
        const m1neu = await knex('lastschrift_mandate').where({ id: m1.id }).first();
        assert.equal(m1neu.mandatstext, m1.mandatstext);
        assert.equal(m1neu.textversion, m1.textversion);
    } finally {
        setzeTestVersand(null);
        await stoppe();
    }
});
