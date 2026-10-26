import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Startgeld Stufe 3, Task 5: Lastschrift im Turnier-Transfer. Zum Hallen-Server reist nur zahlweg + gesichert,
// nie Mandat, IBAN oder verschlüsselte Daten. Dort gibt es keine Mandatszeile, nur das Flag mandat_gueltig.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.ZAHLUNGSDATEN_SCHLUESSEL = 'transfer-test-schluessel-mit-mindestens-32-zeichen';

const { baueTurnierExport, importiereTurnierDaten, importTurnierErgebnisse } = await import('../../src/controllers/turnierController.js');
const { pruefeTransferZeile, ersetzeZahlwege } = await import('../../src/services/zahlwegTransfer.js');
const { uebernehmeNeueZahlwege } = await import('../../src/services/rueckspielen.js');
const zw = await import('../../src/services/zahlwege.js');
const { speichereStammdaten } = await import('../../src/services/abrechnungStammdaten.js');
const { IBAN_MUSTER } = await import('../../src/shared/iban.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const ZAHLER_IBAN = 'DE89370400440532013000';
const AUSRICHTER_IBAN = 'DE75512108001245126199';
const STAMMDATEN = {
    anschrift: 'Weg 1, 50667 Köln', rechnung_email: 'kasse@jc.de', absender_name: 'JC Ausrichter e.V.',
    steuernummer: '12/345/67890', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
    rechnungs_praefix: 'JCA-', kontoinhaber: 'JC Ausrichter e.V.', iban: AUSRICHTER_IBAN, glaeubiger_id: 'DE98ZZZ09999999999'
};
const MAIL = { rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };
const MANDAT = { iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Kasse JC L e.V.', zustimmung: true, vertretung_bestaetigt: true };

let nr = 0;
async function tn(knex, turnierId, verein) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `L-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
    }).returning('id'))[0]);
}

function schluesselNamen(wert, ausgabe = []) {
    if (Array.isArray(wert)) wert.forEach((x) => schluesselNamen(x, ausgabe));
    else if (wert && typeof wert === 'object') {
        for (const [k, v] of Object.entries(wert)) { ausgabe.push(k); schluesselNamen(v, ausgabe); }
    }
    return ausgabe;
}

test('pruefeTransferZeile: Lastschrift und gesichert-Flag', () => {
    const z = pruefeTransferZeile({ verein_name: 'X', zahlweg: 'lastschrift', gesichert: true });
    assert.equal(z.zahlweg, 'lastschrift');
    assert.equal(z.mandat_gueltig, true);
    assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'lastschrift', gesichert: false }).mandat_gueltig, false);
    assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'lastschrift' }).mandat_gueltig, false);
    // gesichert nur für Lastschrift maßgeblich
    assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'bar', gesichert: true }).mandat_gueltig, false);
    assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'ueberweisung', gesichert: true }).mandat_gueltig, false);
    // gesichert muss ein Boolean sein
    for (const falsch of ['true', 1, 0, {}, []]) {
        assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'lastschrift', gesichert: falsch }), null);
        assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'bar', gesichert: falsch }), null);
    }
    assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'sepa', gesichert: true }), null);
});

test('Export trägt Lastschrift + gesichert, nie Mandat/IBAN; Import am Hallen-Server setzt mandat_gueltig; Kasse', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vL = id((await knex('vereine').insert({ name: 'JC L' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-ad', email: 'ad@test.de', vorname: 'ad', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vL });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-ad', verein_id: vL, freigegeben: 1, rolle: 'admin' });
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ad');
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2028-03-04', ausrichter: 'JC Ausrichter', verein_id: vAus,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2028-03-01', angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('*'))[0];
        // Gültiges Mandat (Admin des Vereins erteilt -> sofort gültig)
        await zw.speichereZahlweg(knex, {
            turnier: t, vereinName: 'JC L', vereinId: vL, benutzerId: 'u-ad', istAdminDesVereins: true,
            eingabe: { zahlweg: 'lastschrift', ...MAIL, ...MANDAT }, basisUrl: 'https://hajime.example.de'
        });
        // Lastschrift ohne gültiges Mandat (nur Zeile, wie nach Ablehnung/Widerruf), Überweisung, Bar
        await knex('turnier_zahlwege').insert([
            { turnier_id: t.id, verein_name: 'JC Offen', zahlweg: 'lastschrift', mandat_gueltig: false, geaendert_von: 'u1', ...MAIL },
            { turnier_id: t.id, verein_name: 'JC Ue', zahlweg: 'ueberweisung', geaendert_von: 'u1', ...MAIL },
            { turnier_id: t.id, verein_name: 'JC Bar', zahlweg: 'bar', geaendert_von: 'u1', ...MAIL }
        ]);
        for (const v of ['JC L', 'JC Offen', 'JC Ue', 'JC Bar']) await tn(knex, t.id, v);
        await zw.synchronisiereGesichert(knex, t.id);
        assert.equal((await knex('lastschrift_mandate').where({ turnier_id: t.id, status: 'gueltig' })).length, 1);

        const export1 = await baueTurnierExport(knex, t.id);
        const byName = Object.fromEntries(export1.zahlwege.map((z) => [z.verein_name, z]));
        for (const z of export1.zahlwege) {
            assert.deepEqual(Object.keys(z).sort(), ['gesichert', 'rechnung_anschrift', 'rechnung_ansprechperson', 'rechnung_email', 'verein_name', 'zahlweg']);
        }
        assert.deepEqual([byName['JC L'].zahlweg, byName['JC L'].gesichert], ['lastschrift', true]);
        assert.deepEqual([byName['JC Offen'].zahlweg, byName['JC Offen'].gesichert], ['lastschrift', false]);
        assert.deepEqual([byName['JC Ue'].zahlweg, byName['JC Ue'].gesichert], ['ueberweisung', true]);
        assert.deepEqual([byName['JC Bar'].zahlweg, byName['JC Bar'].gesichert], ['bar', false]);

        // Nichts Sensibles in der gesamten Datei: keine Schlüsselnamen mit mandat/iban/daten, keine IBAN im Text
        const text = JSON.stringify(export1);
        // Ausnahme: turnier.iban ist das öffentliche Überweisungskonto des Ausrichters (Ausschreibung), kein Zahlerkonto.
        const { iban: _ausrichterKonto, ...turnierOhneKonto } = export1.turnier;
        const verbotene = schluesselNamen({ ...export1, turnier: turnierOhneKonto }).filter((k) => /mandat|iban|daten/i.test(k));
        assert.deepEqual(verbotene, []);
        assert.deepEqual([...text.matchAll(new RegExp(IBAN_MUSTER.source, 'gi'))].map((m) => m[0]), []);
        for (const muster of [ZAHLER_IBAN, AUSRICHTER_IBAN, 'DE89 3704', 'Kasse JC L', 'daten_verschluesselt']) {
            assert.ok(!text.includes(muster), `${muster} in der Exportdatei`);
        }

        // Import (Hallen-Server): Flag mandat_gueltig, keine Mandatszeile, Teilnehmer-Flag abgeleitet
        const datei = JSON.parse(text);
        datei.turnier.datum = '2028-05-06';
        datei.teilnehmer.forEach((x) => { delete x.startgeld_zahlweg_gesichert; });
        // Manipulierte Zeile: gesichert:true bei Bar bleibt wirkungslos
        datei.zahlwege.find((z) => z.verein_name === 'JC Bar').gesichert = true;
        const { turnierId } = await importiereTurnierDaten(knex, undefined, datei);
        const zeilen = Object.fromEntries((await knex('turnier_zahlwege').where({ turnier_id: turnierId })).map((z) => [z.verein_name, z]));
        assert.deepEqual([zeilen['JC L'].zahlweg, zeilen['JC L'].mandat_gueltig], ['lastschrift', true]);
        assert.deepEqual([zeilen['JC Offen'].zahlweg, zeilen['JC Offen'].mandat_gueltig], ['lastschrift', false]);
        assert.equal(zeilen['JC Bar'].mandat_gueltig, false);
        assert.equal(zeilen['JC Ue'].mandat_gueltig, false);
        assert.equal((await knex('lastschrift_mandate').where({ turnier_id: turnierId })).length, 0);
        await zw.synchronisiereGesichert(knex, turnierId);
        const flags = Object.fromEntries((await knex('turnier_teilnehmer').where({ turnier_id: turnierId })).map((x) => [x.verein, x.startgeld_zahlweg_gesichert]));
        assert.deepEqual(flags, { 'JC L': true, 'JC Offen': false, 'JC Ue': true, 'JC Bar': false });

        // Kasse am Hallen-Server: gesicherte Lastschrift nicht, nicht bestätigte als eigener Eintrag, Bar wie gehabt
        const vorherModus = process.env.BETRIEBSMODUS;
        process.env.BETRIEBSMODUS = 'server';
        let kasse;
        try { kasse = await zw.ladeKasse(knex, turnierId); } finally { process.env.BETRIEBSMODUS = vorherModus; }
        const kk = Object.fromEntries(kasse.map((k) => [k.vereinName, k]));
        assert.deepEqual(Object.keys(kk).sort(), ['JC Bar', 'JC Offen']);
        assert.equal(kk['JC Offen'].zahlweg, 'lastschriftOffen');
        assert.equal(kk['JC Offen'].anzahlOffen, 1);
        assert.equal(kk['JC Bar'].zahlweg, 'bar');
        // Der Kassierer kann kassieren
        process.env.BETRIEBSMODUS = 'server';
        try { assert.equal(await zw.kassiereBar(knex, turnierId, 'JC Offen'), 1); } finally { process.env.BETRIEBSMODUS = vorherModus; }

        // Ersetzen einer Lastschrift-Zeile durch ersetzeZahlwege übernimmt das Flag
        await knex.transaction(async (trx) => {
            await ersetzeZahlwege(trx, turnierId, [{ verein_name: 'JC Neu', zahlweg: 'lastschrift', gesichert: true, ...MAIL }]);
        });
        const neu = await knex('turnier_zahlwege').where({ turnier_id: turnierId }).first();
        assert.deepEqual([neu.zahlweg, neu.mandat_gueltig], ['lastschrift', true]);
    } finally {
        await stoppe();
    }
});

test('Cloud: Lastschrift-Vereine stehen nie auf der Kasse und lassen sich nicht bar kassieren; Hallen-Server: lastschriftOffen', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vL = id((await knex('vereine').insert({ name: 'JC L' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-ad', email: 'ad@test.de', vorname: 'ad', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vL });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-ad', verein_id: vL, freigegeben: 1, rolle: 'admin' });
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ad');
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2098-03-04', ausrichter: 'JC Ausrichter', verein_id: vAus,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2098-03-01', angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('*'))[0];
        // JC L: Mandat offen (Nicht-Admin erteilt -> unbestätigt)
        const erteilt = await zw.speichereZahlweg(knex, {
            turnier: t, vereinName: 'JC L', vereinId: vL, benutzerId: 'u-ad', istAdminDesVereins: false,
            eingabe: { zahlweg: 'lastschrift', ...MAIL, ...MANDAT }, basisUrl: 'https://hajime.example.de'
        });
        assert.equal(erteilt.mandat.status, 'unbestaetigt');
        // JC G: gültiges Flag, JC O: Zeile ohne Mandat (wie am Hallen-Server nach Import)
        await knex('turnier_zahlwege').insert([
            { turnier_id: t.id, verein_name: 'JC G', zahlweg: 'lastschrift', mandat_gueltig: true, geaendert_von: 'u1', ...MAIL },
            { turnier_id: t.id, verein_name: 'JC O', zahlweg: 'lastschrift', mandat_gueltig: false, geaendert_von: 'u1', ...MAIL }
        ]);
        for (const v of ['JC L', 'JC G', 'JC O']) await tn(knex, t.id, v);
        await zw.synchronisiereGesichert(knex, t.id);
        const flags = Object.fromEntries((await knex('turnier_teilnehmer').where({ turnier_id: t.id })).map((x) => [x.verein, x.startgeld_zahlweg_gesichert]));
        assert.deepEqual(flags, { 'JC L': false, 'JC G': true, 'JC O': false });

        // Cloud: keiner der Lastschrift-Vereine steht auf der Kasse
        assert.deepEqual(await zw.ladeKasse(knex, t.id), []);
        // Defence in depth: kassiereBar verweigert den Verein mit offenem Mandat, nichts wird markiert
        await assert.rejects(() => zw.kassiereBar(knex, t.id, 'JC L'), (e) => e.statusCode === 409 && /Lastschrift/.test(e.message));
        assert.equal((await knex('turnier_teilnehmer').where({ turnier_id: t.id, verein: 'JC L' }).first()).startgeld_bezahlt, false);
        assert.equal((await knex('turnier_barzahlungen').where({ turnier_id: t.id })).length, 0);

        // Hallen-Server (nur Flag, keine Mandatszeile): JC O steht als lastschriftOffen auf der Kasse und lässt sich kassieren
        const vorherModus = process.env.BETRIEBSMODUS;
        process.env.BETRIEBSMODUS = 'server';
        try {
            assert.deepEqual((await zw.ladeKasse(knex, t.id)).map((k) => [k.vereinName, k.zahlweg]), [['JC L', 'lastschriftOffen'], ['JC O', 'lastschriftOffen']]);
            assert.equal(await zw.kassiereBar(knex, t.id, 'JC O'), 1);
        } finally { process.env.BETRIEBSMODUS = vorherModus; }
    } finally {
        await stoppe();
    }
});

test('Rückspielen: neue Vereine nur als Bar, bestehende Lastschrift samt Mandat unberührt, lastschrift_mandate unangetastet', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const vAus = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vL = id((await knex('vereine').insert({ name: 'JC L' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-ad', email: 'ad@test.de', vorname: 'ad', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: vAus });
        await knex('benutzer_vereine').insert([
            { benutzer_id: 'u-ad', verein_id: vAus, freigegeben: 1, rolle: 'admin' },
            { benutzer_id: 'u-ad', verein_id: vL, freigegeben: 1, rolle: 'admin' }
        ]);
        await speichereStammdaten(knex, vAus, STAMMDATEN, 'u-ad');
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup3', ort: 'O', datum: '2099-03-04', ausrichter: 'JC Ausrichter', verein_id: vAus,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2098-03-01', angebotene_zahlwege: 'ueberweisung,bar,lastschrift'
        }).returning('*'))[0];
        await zw.speichereZahlweg(knex, {
            turnier: t, vereinName: 'JC L', vereinId: vL, benutzerId: 'u-ad', istAdminDesVereins: true,
            eingabe: { zahlweg: 'lastschrift', ...MAIL, ...MANDAT }, basisUrl: 'https://hajime.example.de'
        });
        await knex('turniere').where({ id: t.id }).update({ anmeldeschluss: '2020-03-01' });
        const vorher = {
            zahlweg: await knex('turnier_zahlwege').where({ turnier_id: t.id }).orderBy('id'),
            mandate: await knex('lastschrift_mandate').orderBy('id')
        };
        assert.equal(vorher.mandate.length, 1);
        assert.equal(vorher.zahlweg[0].mandat_gueltig, true);

        const datei = {
            turnier: { id: t.id }, kampfflaechen: [], pools: [], kaempfe: [],
            zahlwege: [
                { verein_name: 'JC L', zahlweg: 'bar', gesichert: false, ...MAIL, rechnung_email: 'boese@x.de' },
                { verein_name: 'JC Gast', zahlweg: 'lastschrift', gesichert: true, ...MAIL }
            ],
            teilnehmer: []
        };
        let antwort;
        const res = { status(c) { this.code = c; return this; }, json(b) { antwort = { code: this.code, ...b }; return this; } };
        await importTurnierErgebnisse(knex, {
            params: { id: String(t.id) }, user: { id: 'u-ad' },
            body: { contentBase64: Buffer.from(JSON.stringify(datei)).toString('base64') }
        }, res);
        assert.equal(antwort.success, true, JSON.stringify(antwort));

        const nachher = await knex('turnier_zahlwege').where({ turnier_id: t.id }).orderBy('id');
        assert.deepEqual(nachher[0], vorher.zahlweg[0]);
        const gast = nachher.find((z) => z.verein_name === 'JC Gast');
        assert.deepEqual([gast.zahlweg, gast.mandat_gueltig, gast.verein_id, gast.geaendert_von], ['bar', false, null, null]);
        assert.deepEqual(await knex('lastschrift_mandate').orderBy('id'), vorher.mandate);

        // Direkt: nur Bar, auch bei Lastschrift/gesichert in der Datei
        const n = await knex.transaction((trx) => uebernehmeNeueZahlwege(trx, t.id, [
            { verein_name: 'JC Zwei', zahlweg: 'lastschrift', gesichert: true, ...MAIL }
        ]));
        assert.equal(n, 1);
        const zwei = await knex('turnier_zahlwege').where({ turnier_id: t.id, verein_name: 'JC Zwei' }).first();
        assert.deepEqual([zwei.zahlweg, zwei.mandat_gueltig], ['bar', false]);
    } finally {
        await stoppe();
    }
});
