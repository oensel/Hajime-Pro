import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const { baueTurnierExport, importiereTurnierDaten, importWettkampfdaten, importTurnierErgebnisse } = await import('../../src/controllers/turnierController.js');
const { synchronisiereGesichert } = await import('../../src/services/zahlwege.js');
const { ersetzeZahlwege } = await import('../../src/services/zahlwegTransfer.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const MAIL = { rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };

let nr = 0;
async function tn(knex, turnierId, verein) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `T-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012
    }).returning('id'))[0]);
}

test('Zahlwege im Turnier-Export und -Import', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC Ue' }).returning('id'))[0]);
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup', ort: 'O', datum: '2028-03-04', ausrichter: 'JC Ausrichter', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2028-03-01'
        }).returning('*'))[0];
        await knex('turnier_zahlwege').insert([
            { turnier_id: t.id, verein_id: vA, verein_name: 'JC Ue', zahlweg: 'ueberweisung', geaendert_von: 'u1', ...MAIL },
            { turnier_id: t.id, verein_name: 'JC Bar', zahlweg: 'bar', geaendert_von: 'u2', ...MAIL }
        ]);
        await tn(knex, t.id, 'JC Ue'); await tn(knex, t.id, 'JC Bar'); await tn(knex, t.id, 'JC Ausrichter');
        await synchronisiereGesichert(knex, t.id);

        // Export: Zahlwege ohne Benutzer- und Vereinsbezug
        const export1 = await baueTurnierExport(knex, t.id);
        assert.equal(export1.zahlwege.length, 2);
        for (const z of export1.zahlwege) {
            assert.deepEqual(Object.keys(z).sort(), ['rechnung_anschrift', 'rechnung_ansprechperson', 'rechnung_email', 'verein_name', 'zahlweg']);
        }
        assert.ok(!JSON.stringify(export1.zahlwege).includes('u1'));

        // Import als neues Turnier: Zeilen unter neuer ID, Flag neu abgeleitet (Datei trägt es nicht)
        const datei = JSON.parse(JSON.stringify(export1));
        datei.turnier.datum = '2028-05-06';
        datei.teilnehmer.forEach((x) => { delete x.startgeld_zahlweg_gesichert; });
        const { turnierId } = await importiereTurnierDaten(knex, undefined, datei);
        assert.notEqual(turnierId, t.id);
        const zeilen = await knex('turnier_zahlwege').where({ turnier_id: turnierId }).orderBy('verein_name');
        assert.deepEqual(zeilen.map((z) => [z.verein_name, z.zahlweg, z.geaendert_von]), [['JC Bar', 'bar', null], ['JC Ue', 'ueberweisung', null]]);
        const flags = Object.fromEntries((await knex('turnier_teilnehmer').where({ turnier_id: turnierId })).map((x) => [x.verein, x.startgeld_zahlweg_gesichert]));
        assert.deepEqual(flags, { 'JC Ue': true, 'JC Bar': false, 'JC Ausrichter': true });

        // Import in ein bestehendes Turnier: ersetzeZahlwege ersetzt nur mit Array, fehlt es, bleibt alles
        await knex.transaction(async (trx) => {
            assert.equal(await ersetzeZahlwege(trx, turnierId, undefined), 0);
        });
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: turnierId })).length, 2);
        // Teilnehmer neu einlesen (Flag fällt auf false), danach leitet synchronisiereGesichert es wieder ab
        await knex('turnier_teilnehmer').where({ turnier_id: turnierId }).del();
        await knex.transaction(async (trx) => {
            await importWettkampfdaten(trx, turnierId, { kampfflaechen: [], pools: [], kaempfe: [], teilnehmer: datei.teilnehmer });
        });
        const vorher = (await knex('turnier_teilnehmer').where({ turnier_id: turnierId, verein: 'JC Ue' }).first()).startgeld_zahlweg_gesichert;
        assert.equal(vorher, false);
        await synchronisiereGesichert(knex, turnierId);
        assert.equal((await knex('turnier_teilnehmer').where({ turnier_id: turnierId, verein: 'JC Ue' }).first()).startgeld_zahlweg_gesichert, true);
        // Mit Zahlwege-Array in der Datei werden die Zeilen ersetzt
        await knex.transaction(async (trx) => {
            await ersetzeZahlwege(trx, turnierId, [{ verein_name: 'JC Neu', zahlweg: 'bar', ...MAIL }]);
        });
        assert.deepEqual((await knex('turnier_zahlwege').where({ turnier_id: turnierId })).map((z) => z.verein_name), ['JC Neu']);
    } finally {
        await stoppe();
    }
});

test('Import verwirft ungültige Zahlweg-Zeilen und speist keine Vorbelegung', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const { ladeVorbelegung } = await import('../../src/services/zahlwege.js');
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Chef' }).returning('id'))[0]);
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup2', ort: 'O', datum: '2028-03-04', ausrichter: 'JC Chef', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2028-03-01'
        }).returning('*'))[0];
        const gut = { verein_name: '  JC Gut ', zahlweg: 'bar', ...MAIL };
        const n = await knex.transaction((trx) => ersetzeZahlwege(trx, t.id, [
            gut,
            { verein_name: 'JC Lastschrift', zahlweg: 'lastschrift', ...MAIL },
            { verein_name: 'JC X', zahlweg: 'x', ...MAIL },
            { verein_name: 'JC Zahl', zahlweg: 'bar', ...MAIL, rechnung_email: 5 },
            { verein_name: 'JC Obj', zahlweg: 'bar', ...MAIL, rechnung_anschrift: { a: 1 } },
            { verein_name: 'JC Mail', zahlweg: 'bar', ...MAIL, rechnung_email: 'keine-mail' },
            { verein_name: 'JC Chef', zahlweg: 'ueberweisung', ...MAIL },
            { verein_name: 'JC Gut', zahlweg: 'ueberweisung', ...MAIL },
            { verein_name: '   ', zahlweg: 'bar', ...MAIL },
            { verein_name: 'JC Lang', zahlweg: 'bar', ...MAIL, rechnung_ansprechperson: 'x'.repeat(300) },
            { verein_name: 'JC Ue', zahlweg: 'ueberweisung', ...MAIL, geaendert_von: 'boese', verein_id: ausrichter }
        ]));
        assert.equal(n, 2);
        const zeilen = await knex('turnier_zahlwege').where({ turnier_id: t.id }).orderBy('verein_name');
        assert.deepEqual(zeilen.map((z) => [z.verein_name, z.zahlweg, z.geaendert_von, z.verein_id]),
            [['JC Gut', 'bar', null, null], ['JC Ue', 'ueberweisung', null, null]]);

        // Importierte Zeilen speisen die Vorbelegung nie, selbst gespeicherte schon
        assert.equal(await ladeVorbelegung(knex, 'JC Gut'), null);
        await knex('turnier_zahlwege').insert({ turnier_id: t.id, verein_name: 'JC Eigen', zahlweg: 'bar', geaendert_von: 'u7', ...MAIL });
        const v = await ladeVorbelegung(knex, 'JC Eigen');
        assert.equal(v.rechnung_email, 'a@b.de');
    } finally {
        await stoppe();
    }
});

test('Ergebnis-Re-Import lässt bestehende Zahlwege und den Teilnehmerstatus unberührt', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Chef' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u-chef', email: 'chef@test.de', vorname: 'c', nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: ausrichter });
        await knex('benutzer_vereine').insert({ benutzer_id: 'u-chef', verein_id: ausrichter, freigegeben: 1, rolle: 'admin' });
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup3', ort: 'O', datum: '2099-03-04', ausrichter: 'JC Chef', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2020-03-01'
        }).returning('*'))[0];
        await knex('turnier_zahlwege').insert({ turnier_id: t.id, verein_name: 'JC Alt', zahlweg: 'ueberweisung', geaendert_von: 'u1', ...MAIL });

        const datei = {
            turnier: { id: t.id }, kampfflaechen: [], pools: [], kaempfe: [],
            zahlwege: [{ verein_name: 'JC Neu', zahlweg: 'bar', ...MAIL }],
            teilnehmer: [
                { id: 1, judopass_id: 'R-1', vorname: 'A', nachname: 'B', geschlecht: 'm', verein: 'JC Alt', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, status: 'angemeldet' },
                { id: 2, judopass_id: 'R-2', vorname: 'C', nachname: 'D', geschlecht: 'm', verein: 'JC Chef', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, status: 'nicht_erschienen' }
            ]
        };
        let antwort;
        const res = { status(c) { this.code = c; return this; }, json(b) { antwort = { code: this.code, ...b }; return this; } };
        await importTurnierErgebnisse(knex, {
            params: { id: String(t.id) }, user: { id: 'u-chef' },
            body: { contentBase64: Buffer.from(JSON.stringify(datei)).toString('base64') }
        }, res);
        assert.equal(antwort.success, true, JSON.stringify(antwort));
        // Bestehende Zeile bleibt, vor Ort neu erfasste Vereine kommen dazu (Stufe 2, E12: immer als Bar)
        assert.deepEqual((await knex('turnier_zahlwege').where({ turnier_id: t.id }).orderBy('verein_name')).map((z) => [z.verein_name, z.zahlweg, z.geaendert_von]),
            [['JC Alt', 'ueberweisung', 'u1'], ['JC Neu', 'bar', null]]);
        const tn = Object.fromEntries((await knex('turnier_teilnehmer').where({ turnier_id: t.id })).map((x) => [x.verein, x]));
        assert.equal(tn['JC Alt'].startgeld_zahlweg_gesichert, true);
        assert.equal(tn['JC Chef'].startgeld_zahlweg_gesichert, true);
        // Archivierte Ergebnisse werden nicht auf kampfbereit umgestellt
        assert.equal(tn['JC Chef'].status, 'nicht_erschienen');
    } finally {
        await stoppe();
    }
});

test('Exportdatei: barzahlungen und anzahl, Import übernimmt Barzahlungen einmalig', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    const { exportiereBarzahlungen, uebernehmeBarzahlungen, pruefeTransferZeile } = await import('../../src/services/zahlwegTransfer.js');
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Chef' }).returning('id'))[0]);
        const t = (await knex('turniere').insert({
            bezeichnung: 'Cup4', ort: 'O', datum: '2028-03-04', ausrichter: 'JC Chef', verein_id: ausrichter,
            status: 'veroeffentlicht', startgeld: 8, anmeldeschluss: '2028-03-01'
        }).returning('*'))[0];
        await tn(knex, t.id, 'JC Bar'); await tn(knex, t.id, 'JC Bar');
        const uid = '11111111-1111-4111-8111-111111111111';
        await knex('turnier_barzahlungen').insert({ uid, turnier_id: t.id, verein_name: 'JC Bar', anzahl: 2, betrag_cent: 1600 });

        const export1 = await baueTurnierExport(knex, t.id);
        assert.equal(export1.barzahlungen.length, 1);
        assert.deepEqual(Object.keys(export1.barzahlungen[0]).sort(), ['anzahl', 'betrag_cent', 'kassiert_am', 'uid', 'verein_name']);
        assert.deepEqual(export1.anzahl, {
            kampfflaechen: export1.kampfflaechen.length, pools: export1.pools.length, teilnehmer: export1.teilnehmer.length,
            kaempfe: export1.kaempfe.length, mannschaften: export1.mannschaften.length, mannschaft_mitglieder: export1.mannschaft_mitglieder.length
        });
        assert.equal(export1.anzahl.teilnehmer, 2);

        const datei = JSON.parse(JSON.stringify(export1));
        datei.turnier.datum = '2028-05-06';
        const { turnierId } = await importiereTurnierDaten(knex, undefined, datei);
        // Dieselbe uid im anderen (neuen) Turnier wird übernommen, im Quell-Turnier bleibt sie unberührt
        assert.equal((await knex('turnier_barzahlungen').where({ uid })).length, 2);
        assert.equal((await knex('turnier_barzahlungen').where({ uid, turnier_id: t.id })).length, 1);
        assert.equal((await knex('turnier_barzahlungen').where({ uid, turnier_id: turnierId })).length, 1);
        await knex('turnier_barzahlungen').where({ turnier_id: turnierId }).del();

        // Neue uid wird übernommen, doppelt nicht; ungültige Zeilen fliegen raus
        const n = await knex.transaction((trx) => uebernehmeBarzahlungen(trx, turnierId, [
            { uid: '22222222-2222-4222-8222-222222222222', verein_name: 'JC Bar', anzahl: 2, betrag_cent: 1600, kassiert_am: '2028-05-06T10:00:00.000Z' },
            { uid: '22222222-2222-4222-8222-222222222222', verein_name: 'JC Bar', anzahl: 2, betrag_cent: 1600 },
            { uid: 'keine-uuid', verein_name: 'JC Bar', anzahl: 1, betrag_cent: 800 },
            { uid: '33333333-3333-4333-8333-333333333333', verein_name: '', anzahl: 1, betrag_cent: 800 },
            { uid: '44444444-4444-4444-8444-444444444444', verein_name: 'JC Bar', anzahl: -1, betrag_cent: 800 },
            { uid: '55555555-5555-4555-8555-555555555555', verein_name: 'JC Bar', anzahl: 1, betrag_cent: 1.5 },
            null
        ]));
        assert.equal(n, 1);
        assert.equal((await knex('turnier_barzahlungen').where({ turnier_id: turnierId })).length, 1);
        // Gleiche uid im selben Turnier wird verworfen, im anderen Turnier übernommen
        assert.equal(await knex.transaction((trx) => uebernehmeBarzahlungen(trx, turnierId, [
            { uid: '22222222-2222-4222-8222-222222222222', verein_name: 'JC Bar', anzahl: 2, betrag_cent: 1600 }
        ])), 0);
        assert.equal(await knex.transaction((trx) => uebernehmeBarzahlungen(trx, t.id, [
            { uid: '22222222-2222-4222-8222-222222222222', verein_name: 'JC Bar', anzahl: 2, betrag_cent: 1600 }
        ])), 1);
        await knex('turnier_barzahlungen').where({ turnier_id: t.id }).whereNot({ uid }).del();
        assert.equal(await knex.transaction((trx) => uebernehmeBarzahlungen(trx, turnierId, undefined)), 0);
        assert.deepEqual((await exportiereBarzahlungen(knex, turnierId)).map((b) => b.uid), ['22222222-2222-4222-8222-222222222222']);

        assert.equal(pruefeTransferZeile({ verein_name: 'X', zahlweg: 'lastschrift' }), null);
        assert.equal(pruefeTransferZeile(null), null);
        assert.equal(pruefeTransferZeile({ verein_name: ' JC A ', zahlweg: 'bar', rechnung_email: 'a@b.de' }).verein_name, 'JC A');
    } finally {
        await stoppe();
    }
});
