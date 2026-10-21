import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { PDFDocument } from 'pdf-lib';
import { starteTestPostgres } from '../helpers/testPostgres.js';

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;
process.env.JWT_SECRET = 'helfer-ausweis-test-geheimnis';

const jwt = (await import('jsonwebtoken')).default;
const dienst = await import('../../src/services/helferAusweis.js');
const { einsatzZeitText, erzeugeAusweisPdf, baueAusweisDaten, planeZeilen, MAX_ZEILEN, PALETTE, kontrastVerhaeltnis, waehleTextFarbe, bereinigeText } = dienst;
const { getHelferPlanRoutes } = await import('../../src/routes/helferPlanRoutes.js');
const { hashPassword } = await import('../../src/utils/password.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const seiten = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

let db; let knex; let vereinId; let zaehler = 0;

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
    vereinId = id((await knex('vereine').insert({ name: 'JC Ausweis' }).returning('id'))[0]);
});
after(async () => { await db.stoppe(); });

// Turnier mit einer Tätigkeit; personen: { konto?, vorname?, nachname?, manuell?, ohneEinsatz? }
async function aufbau(personen, einsaetzeJe = 1) {
    const turnier = id((await knex('turniere').insert({
        bezeichnung: 'Pokal', ort: 'Halle', datum: '2026-11-01', ausrichter: 'JC', verein_id: vereinId
    }).returning('id'))[0]);
    const t = id((await knex('helfer_taetigkeiten').insert({
        turnier_id: turnier, art: 'frei', bezeichnung: 'Matte 1', bedarf: 5
    }).returning('id'))[0]);
    for (const p of personen) {
        if (p.konto) {
            p.konto = `${p.konto}-${++zaehler}`;
            await knex('benutzer').insert({ id: p.konto, email: `${p.konto}@t.de`, vorname: p.vorname ?? null, nachname: p.nachname ?? null });
        }
    }
    for (let i = 0; i < einsaetzeJe; i++) {
        const slot = id((await knex('helfer_slots').insert({
            taetigkeit_id: t, von_min: 540 + i * 30, bis_min: 570 + i * 30, bedarf: 10
        }).returning('id'))[0]);
        for (const p of personen) {
            if (p.ohneEinsatz) continue;
            await knex('helfer_einsaetze').insert(p.konto ? { slot_id: slot, benutzer_id: p.konto } : { slot_id: slot, name_manuell: p.manuell });
        }
    }
    return { turnier, personen };
}

test('drei Personen mit Einsatz und eine ohne ergeben eine Seite und drei Ausweise', async () => {
    const { turnier } = await aufbau([
        { konto: 'u1', vorname: 'Anna', nachname: 'Beck' }, { konto: 'u2', vorname: 'Bert', nachname: 'Cord' },
        { manuell: 'Dora Extern' }, { konto: 'u3', vorname: 'Ohne', nachname: 'Einsatz', ohneEinsatz: true }
    ]);
    assert.equal((await baueAusweisDaten(knex, turnier)).length, 3);
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 1);
});

test('fünf Personen ergeben zwei Seiten', async () => {
    const { turnier } = await aufbau([1, 2, 3, 4].map(n => ({ konto: 'a', vorname: 'A', nachname: `N${n}` })).concat([{ manuell: 'Fünf Manuell' }]));
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 2);
});

test('benutzerIds-Filter wählt Konten aus und schließt manuelle Namen aus', async () => {
    const { turnier, personen } = await aufbau([
        { konto: 'f', vorname: 'Fil', nachname: 'Eins' }, { konto: 'f', vorname: 'Fil', nachname: 'Zwei' }, { manuell: 'Manuell Mann' }
    ]);
    assert.equal((await baueAusweisDaten(knex, turnier)).length, 3);
    const gefiltert = await baueAusweisDaten(knex, turnier, { benutzerIds: [personen[0].konto] });
    assert.deepEqual(gefiltert.map(p => p.name), ['Fil Eins']);
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier, { benutzerIds: [personen[0].konto] })), 1);
});

test('QR-Kennung: Konto-ID bzw. m<n> für manuelle Namen', async () => {
    const { turnier, personen } = await aufbau([{ konto: 'q', vorname: 'Quirin', nachname: 'Test' }, { manuell: 'Mia Manuell' }, { manuell: 'Max Manuell' }]);
    const daten = await baueAusweisDaten(knex, turnier);
    const kennungen = Object.fromEntries(daten.map(p => [p.name, p.kennung]));
    assert.equal(kennungen['Quirin Test'], personen[0].konto);
    assert.deepEqual([kennungen['Mia Manuell'], kennungen['Max Manuell']].sort(), ['m1', 'm2']);
});

test('zwölf Einsätze: Zeilenbegrenzung mit Rest 2, PDF fehlerfrei', async () => {
    const { turnier } = await aufbau([{ konto: 'v', vorname: 'Viel', nachname: 'Beschäftigt' }], 12);
    const [person] = await baueAusweisDaten(knex, turnier);
    assert.equal(person.einsaetze.length, 12);
    const { anzeige, rest } = planeZeilen(person.einsaetze);
    assert.equal(anzeige.length, MAX_ZEILEN - 1);
    assert.equal(rest, 2);
    assert.deepEqual(planeZeilen(person.einsaetze.slice(0, MAX_ZEILEN)).rest, 0);
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 1);
});

test('Umlaute bleiben im Namen erhalten und das PDF entsteht fehlerfrei', async () => {
    const { turnier } = await aufbau([{ konto: 'j', vorname: 'Jörg', nachname: 'Müller' }]);
    assert.equal((await baueAusweisDaten(knex, turnier))[0].name, 'Jörg Müller');
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 1);
});

test('ungewöhnliche Zeichen im manuellen Namen erzeugen keinen Fehler', async () => {
    const { turnier } = await aufbau([
        { manuell: 'Emoji 😀 Judo' }, { manuell: '山田\n太郎' }, { manuell: 'Tab\tund\Steuer\u0007zeichen' }, { manuell: 'x'.repeat(250) }
    ]);
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 1);
    assert.equal(bereinigeText('a\nb\tc\u0000d'), 'a b c d');
    assert.equal(bereinigeText('a😀b', new Set([97, 98])), 'a?b');
});

test('Konto ohne Vor- und Nachname heißt Helfer, nie die E-Mail-Adresse', async () => {
    const { turnier } = await aufbau([{ konto: 'leer' }]);
    assert.equal((await baueAusweisDaten(knex, turnier))[0].name, 'Helfer');
});

test('jede Palettenfarbe hat mit der gewählten Textfarbe mindestens Kontrast 4,5', () => {
    for (const farbe of PALETTE) {
        assert.ok(kontrastVerhaeltnis(farbe, waehleTextFarbe(farbe)) >= 4.5, farbe);
    }
});

test('Turnier ohne Einsätze: 404', async () => {
    const { turnier } = await aufbau([{ konto: 'x', vorname: 'X', nachname: 'Y', ohneEinsatz: true }]);
    await assert.rejects(erzeugeAusweisPdf(knex, turnier), (e) => e.statusCode === 404);
});

test('HTTP-Route: Helfer/Benutzer 403, Orga (Admin) application/pdf, ohne Einsätze 404 mit deutscher Meldung', async () => {
    const mitEinsatz = (await aufbau([{ konto: 'r', vorname: 'Rita', nachname: 'Route' }])).turnier;
    const ohne = (await aufbau([{ konto: 'o', vorname: 'O', nachname: 'O', ohneEinsatz: true }])).turnier;
    for (const t of [mitEinsatz, ohne]) await knex('turniere').where({ id: t }).update({ status: 'veroeffentlicht' });
    for (const n of ['orga', 'benutzer', 'helfer']) {
        await knex('benutzer').insert({
            id: `ru-${n}`, email: `ru-${n}@t.de`, vorname: n, nachname: 'T', email_bestaetigt_am: knex.fn.now(),
            password_hash: hashPassword('pw-pw-pw-pw'), aktiver_verein_id: vereinId
        });
    }
    await knex('benutzer_vereine').insert([
        { benutzer_id: 'ru-orga', verein_id: vereinId, freigegeben: 1, rolle: 'admin' },
        { benutzer_id: 'ru-benutzer', verein_id: vereinId, freigegeben: 1, rolle: 'benutzer' },
        { benutzer_id: 'ru-helfer', verein_id: vereinId, freigegeben: 1, rolle: 'helfer' }
    ]);
    const app = express();
    app.use('/api/helfer-plan', getHelferPlanRoutes(knex));
    const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const aufruf = (benutzer, turnierId) => fetch(`http://127.0.0.1:${server.address().port}/api/helfer-plan/${turnierId}/ausweise`, {
        headers: { Authorization: `Bearer ${jwt.sign({ id: benutzer }, process.env.JWT_SECRET)}` }
    });
    try {
        assert.equal((await aufruf('ru-helfer', mitEinsatz)).status, 403);
        assert.equal((await aufruf('ru-benutzer', mitEinsatz)).status, 403); // Rolle Benutzer verwaltet den Helferplan nicht
        const ok = await aufruf('ru-orga', mitEinsatz);
        assert.equal(ok.status, 200);
        assert.match(ok.headers.get('content-type'), /application\/pdf/);
        assert.equal(Buffer.from(await ok.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
        const leer = await aufruf('ru-orga', ohne);
        assert.equal(leer.status, 404);
        assert.match((await leer.json()).error, /Helfer/);
    } finally {
        await new Promise(r => server.close(r));
    }
});

test('Vortag-Dienste stehen vor dem Turniertag und tragen das Präfix „Vortag“', async () => {
    const { turnier } = await aufbau([{ konto: 'vt', vorname: 'Vera', nachname: 'Vortag' }]);
    const vortag = id((await knex('helfer_taetigkeiten').insert({
        turnier_id: turnier, art: 'aufbau', bezeichnung: 'Aufbau', bedarf: 2, tag_versatz: -1
    }).returning('id'))[0]);
    const slot = id((await knex('helfer_slots').insert({ taetigkeit_id: vortag, von_min: 1020, bis_min: 1140, bedarf: 2 }).returning('id'))[0]);
    const konto = (await knex('benutzer').where('email', 'like', 'vt-%').first()).id;
    await knex('helfer_einsaetze').insert({ slot_id: slot, benutzer_id: konto });
    const [person] = await baueAusweisDaten(knex, turnier);
    assert.equal(person.einsaetze.length, 2);
    assert.equal(person.einsaetze[0].taetigkeit, 'Aufbau');
    assert.equal(person.einsaetze[0].vortag, true);
    assert.equal(person.einsaetze[1].vortag, false);
    assert.equal(einsatzZeitText(person.einsaetze[0]), 'Vortag 17:00–19:00');
    assert.equal(einsatzZeitText(person.einsaetze[1]), '09:00–09:30');
    assert.equal(await seiten(await erzeugeAusweisPdf(knex, turnier)), 1);
});
