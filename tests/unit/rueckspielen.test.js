import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// Zurückspielen in die Cloud (POST /api/turniere/:id/import-ergebnisse): ersetzt die Wettkampfdaten, lässt Zahlungsdaten
// bestehender Vereine und Rechnungen unberührt, übernimmt neue Vereine (als Bar) und das Kassenjournal. Nur Admins des
// Ausrichters bzw. Super-Admins (mit frischer 2FA-Anmeldung oder Code); nach versandten Rechnungen nur mit Freigabe.
pg.types.setTypeParser(1082, (val) => val);
process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
delete process.env.SUPER_ADMIN_2FA;
process.env.SMTP_HOST = '';
process.env.JWT_SECRET = 'rueckspielen-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const { getTurnierRoutes } = await import('../../src/routes/turnierRoutes.js');
const { baueTurnierExport, importiereTurnierDaten } = await import('../../src/controllers/turnierController.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const MAIL_CLOUD = { rechnung_email: 'kasse@jca.de', rechnung_ansprechperson: 'Anna Cloud', rechnung_anschrift: 'Cloudweg 1, Köln' };

let nr = 0;
async function tn(knex, turnierId, verein, extra = {}) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `R-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, ...extra
    }).returning('id'))[0]);
}

test('Zurückspielen: Wettkampfdaten ersetzt, Zahlungsdaten und Rechnungen geschützt, Rechte und 2FA', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    const app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/api/turniere', getTurnierRoutes(knex));
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const basis = `http://127.0.0.1:${server.address().port}`;
    const spieleZurueck = async (benutzerId, turnierId, datei, { zf, code } = {}) => {
        const nutzlast = { id: benutzerId };
        if (zf !== undefined) nutzlast.zf = zf;
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt.sign(nutzlast, process.env.JWT_SECRET)}` };
        if (code) headers['X-2FA-Code'] = code;
        const res = await fetch(`${basis}/api/turniere/${turnierId}/import-ergebnisse`, {
            method: 'POST', headers, body: JSON.stringify({ contentBase64: Buffer.from(JSON.stringify(datei)).toString('base64') })
        });
        return { status: res.status, daten: await res.json().catch(() => null) };
    };
    try {
        const chef = id((await knex('vereine').insert({ name: 'JC Chef' }).returning('id'))[0]);
        for (const [n, rolle] of [['admin', 'admin'], ['benutzer', 'benutzer'], ['super', 'helfer']]) {
            await knex('benutzer').insert({ id: `u-${n}`, email: `${n}@test.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(), aktiver_verein_id: chef });
            await knex('benutzer_vereine').insert({ benutzer_id: `u-${n}`, verein_id: chef, freigegeben: 1, rolle });
        }
        await knex('benutzer').where({ id: 'u-super' }).update({ ist_super_admin: true, super_admin_modus: true });

        // Cloud-Turnier mit Startgeld: Anmeldeschluss vorbei, Wettkampftag in der Zukunft (anmeldung_geschlossen)
        const cloud = (await knex('turniere').insert({
            bezeichnung: 'Cloud-Cup', ort: 'O', datum: '2099-03-04', ausrichter: 'JC Chef', verein_id: chef,
            status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: '2020-03-01', iban: 'DE00', kontoinhaber: 'JC Chef', verwendungszweck: 'Startgeld'
        }).returning('*'))[0];
        await knex('turnier_zahlwege').insert([
            { turnier_id: cloud.id, verein_name: 'JC A', zahlweg: 'ueberweisung', geaendert_von: 'u-a', ...MAIL_CLOUD },
            { turnier_id: cloud.id, verein_name: 'JC B', zahlweg: 'bar', geaendert_von: 'u-b', rechnung_email: 'b@jcb.de' }
        ]);
        await tn(knex, cloud.id, 'JC A'); await tn(knex, cloud.id, 'JC B'); await tn(knex, cloud.id, 'JC B'); await tn(knex, cloud.id, 'JC Chef');

        // Hallen-Server: Turnier geholt (urspruengliche_id), dort geändert und wieder exportiert
        const geholt = await importiereTurnierDaten(knex, undefined, await baueTurnierExport(knex, cloud.id));
        const halle = geholt.turnierId;
        assert.equal((await knex('turniere').where({ id: halle }).first()).urspruengliche_id, cloud.id);
        await knex('turnier_zahlwege').where({ turnier_id: halle, verein_name: 'JC A' }).update({ zahlweg: 'bar', rechnung_email: 'gefaelscht@halle.de' });
        await knex('turnier_zahlwege').insert({ turnier_id: halle, verein_name: 'JC Neu', zahlweg: 'ueberweisung', rechnung_email: 'neu@jcneu.de', rechnung_anschrift: 'Neuweg 2' });
        await knex('turnier_zahlwege').insert({ turnier_id: halle, verein_name: 'JC Chef', zahlweg: 'bar' }).catch(() => {});
        await tn(knex, halle, 'JC Neu');
        await knex('turnier_teilnehmer').where({ turnier_id: halle, verein: 'JC B' }).update({ startgeld_bezahlt: 1 });
        const uid = 'abcdefab-1234-4234-8234-abcdefabcdef';
        await knex('turnier_barzahlungen').insert({ uid, turnier_id: halle, verein_name: 'JC B', anzahl: 2, betrag_cent: 2000 });
        await knex('turniere').where({ id: halle }).update({ bezeichnung: 'Umbenannt in der Halle', startgeld: 99, iban: 'DE99' });
        const datei = await baueTurnierExport(knex, halle);
        assert.equal(datei.turnier.urspruengliche_id, cloud.id);
        const teilnehmerCloud = async () => (await knex('turnier_teilnehmer').where({ turnier_id: cloud.id }).orderBy('id')).map((t) => t.id);

        // Rolle benutzer → 403
        const alsBenutzer = await spieleZurueck('u-benutzer', cloud.id, datei);
        assert.equal(alsBenutzer.status, 403, JSON.stringify(alsBenutzer.daten));
        assert.equal(alsBenutzer.daten.success, false);

        // Datei eines anderen Turniers → 400
        const fremd = JSON.parse(JSON.stringify(datei));
        fremd.turnier.urspruengliche_id = cloud.id + 1000;
        const alsFremd = await spieleZurueck('u-admin', cloud.id, fremd);
        assert.equal(alsFremd.status, 400);
        assert.match(alsFremd.daten.error, /gehört zu Turnier-ID/);

        // anzahl passt nicht zu den Listen → 400, nichts gelöscht
        const vorher = await teilnehmerCloud();
        const abgeschnitten = JSON.parse(JSON.stringify(datei));
        abgeschnitten.anzahl.teilnehmer += 1;
        const alsAbgeschnitten = await spieleZurueck('u-admin', cloud.id, abgeschnitten);
        assert.equal(alsAbgeschnitten.status, 400);
        assert.equal(alsAbgeschnitten.daten.error, 'Die Datei ist unvollständig.');
        assert.deepEqual(await teilnehmerCloud(), vorher);
        const ohneListe = JSON.parse(JSON.stringify(datei));
        ohneListe.kaempfe = { kaputt: true };
        delete ohneListe.anzahl;
        assert.equal((await spieleZurueck('u-admin', cloud.id, ohneListe)).status, 400);
        assert.deepEqual(await teilnehmerCloud(), vorher);

        // Admin spielt zurück → 200
        const ok = await spieleZurueck('u-admin', cloud.id, datei);
        assert.equal(ok.status, 200, JSON.stringify(ok.daten));
        assert.equal(ok.daten.success, true);
        assert.equal(ok.daten.turnierId, cloud.id);
        assert.equal(ok.daten.imported.teilnehmer, 5);
        assert.equal(ok.daten.neueVereine, 1);
        assert.equal(ok.daten.barzahlungen, 1);
        const nachher = await knex('turnier_teilnehmer').where({ turnier_id: cloud.id });
        assert.equal(nachher.length, 5);
        assert.ok(nachher.every((t) => !vorher.includes(t.id)));
        assert.ok(nachher.filter((t) => t.verein === 'JC B').every((t) => t.startgeld_bezahlt));
        const t1 = await knex('turniere').where({ id: cloud.id }).first();
        assert.equal(t1.status, 'abgeschlossen');
        assert.ok(t1.zurueckgespielt_am);
        assert.equal(t1.rueckspielen_freigegeben, false);
        // Turnier-Stammfelder der Datei werden ignoriert
        assert.equal(t1.bezeichnung, 'Cloud-Cup');
        assert.equal(Number(t1.startgeld), 10);
        assert.equal(t1.iban, 'DE00');
        // Zahlwege: bestehende bleiben wie in der Cloud, neue kommen als Bar, Ausrichter nie
        const zw = Object.fromEntries((await knex('turnier_zahlwege').where({ turnier_id: cloud.id })).map((z) => [z.verein_name, z]));
        assert.deepEqual(Object.keys(zw).sort(), ['JC A', 'JC B', 'JC Neu']);
        assert.equal(zw['JC A'].zahlweg, 'ueberweisung');
        assert.equal(zw['JC A'].rechnung_email, MAIL_CLOUD.rechnung_email);
        assert.equal(zw['JC A'].rechnung_anschrift, MAIL_CLOUD.rechnung_anschrift);
        assert.equal(zw['JC A'].geaendert_von, 'u-a');
        assert.equal(zw['JC B'].zahlweg, 'bar');
        assert.equal(zw['JC Neu'].zahlweg, 'bar');
        assert.equal(zw['JC Neu'].rechnung_email, 'neu@jcneu.de');
        assert.equal(zw['JC Neu'].geaendert_von, null);
        // Kassenjournal übernommen
        const bar = await knex('turnier_barzahlungen').where({ turnier_id: cloud.id });
        assert.deepEqual(bar.map((b) => [b.uid, b.verein_name, b.anzahl, b.betrag_cent]), [[uid, 'JC B', 2, 2000]]);

        // Zweites Rückspielen ohne Rechnungen → 200 (Journal idempotent)
        const zweites = await spieleZurueck('u-admin', cloud.id, datei);
        assert.equal(zweites.status, 200, JSON.stringify(zweites.daten));
        assert.equal(zweites.daten.barzahlungen, 0);
        assert.equal(zweites.daten.neueVereine, 0);
        assert.equal((await knex('turnier_barzahlungen').where({ turnier_id: cloud.id })).length, 1);

        // Nach einer versandten Rechnung → 409, Teilnehmer unverändert, Rechnung unverändert
        const [rechnung] = await knex('rechnungen').insert({
            turnier_id: cloud.id, aussteller_verein_id: chef, verein_name: 'JC A', zahlweg: 'ueberweisung', art: 'rechnung',
            nummer: 'JCC-00001', rechnungsdatum: '2099-03-05', anzahl: 1, einzelpreis_cent: 1000, betrag_cent: 1000,
            positionen: JSON.stringify([]), empfaenger: JSON.stringify({}), aussteller: JSON.stringify({}),
            status: 'versandt', versandt_am: knex.fn.now()
        }).returning('*');
        const stand = await teilnehmerCloud();
        const gesperrt = await spieleZurueck('u-admin', cloud.id, datei);
        assert.equal(gesperrt.status, 409);
        assert.equal(gesperrt.daten.error, 'Für dieses Turnier wurden schon Rechnungen versandt. Erneutes Zurückspielen muss ein Admin auf der Abrechnungsseite freigeben.');
        assert.deepEqual(await teilnehmerCloud(), stand);
        const rechnungDanach = await knex('rechnungen').where({ id: rechnung.id }).first();
        assert.deepEqual(rechnungDanach, rechnung);

        // Mit Freigabe genau einmal
        await knex('turniere').where({ id: cloud.id }).update({ rueckspielen_freigegeben: true });
        const freigegeben = await spieleZurueck('u-admin', cloud.id, datei);
        assert.equal(freigegeben.status, 200, JSON.stringify(freigegeben.daten));
        assert.equal((await knex('turniere').where({ id: cloud.id }).first()).rueckspielen_freigegeben, false);
        assert.equal((await spieleZurueck('u-admin', cloud.id, datei)).status, 409);
        assert.deepEqual(await knex('rechnungen').where({ id: rechnung.id }).first(), rechnung);

        // Super-Admin im Modus, 2FA-Pflicht aktiv
        await knex('turniere').where({ id: cloud.id }).update({ rueckspielen_freigegeben: true });
        const ohneZf = await spieleZurueck('u-super', cloud.id, datei);
        assert.equal(ohneZf.status, 403);
        assert.equal(ohneZf.daten.code, 'zwei_faktor');
        const jetzt = Math.floor(Date.now() / 1000);
        const altZf = await spieleZurueck('u-super', cloud.id, datei, { zf: jetzt - 11 * 60 });
        assert.equal(altZf.status, 403);
        assert.equal(altZf.daten.code, 'zwei_faktor');
        assert.equal((await knex('turniere').where({ id: cloud.id }).first()).rueckspielen_freigegeben, true);
        const frisch = await spieleZurueck('u-super', cloud.id, datei, { zf: jetzt });
        assert.equal(frisch.status, 200, JSON.stringify(frisch.daten));

        // Abgeschlossenes Turnier, das nie zurückgespielt wurde → 403 (schreibgeschützt)
        const archiv = id((await knex('turniere').insert({
            bezeichnung: 'Archiv', ort: 'O', datum: '2020-03-04', ausrichter: 'JC Chef', verein_id: chef, status: 'abgeschlossen', anmeldeschluss: '2020-03-01'
        }).returning('id'))[0]);
        const archivDatei = { ...JSON.parse(JSON.stringify(datei)), turnier: { id: archiv } };
        assert.equal((await spieleZurueck('u-admin', archiv, archivDatei)).status, 403);

        // Unbekanntes Turnier → 404
        assert.equal((await spieleZurueck('u-admin', 999999, datei)).status, 404);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        await db.stoppe();
    }
});
