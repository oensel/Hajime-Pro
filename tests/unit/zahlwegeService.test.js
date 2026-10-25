import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

// wie src/app.js: DATE-Spalten als Text
pg.types.setTypeParser(1082, (val) => val);

process.env.BETRIEBSMODUS = 'cloud';
delete process.env.IS_OFFLINE;
delete process.env.SYNC_ROLLE;

const zw = await import('../../src/services/zahlwege.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const EINGABE = { zahlweg: 'ueberweisung', rechnung_email: 'a@b.de', rechnung_ansprechperson: 'Anna', rechnung_anschrift: 'Weg 1, Köln' };

function morgen() {
    const d = new Date(Date.now() + 5 * 86400000);
    return d.toISOString().slice(0, 10);
}

let nr = 0;
async function teilnehmer(knex, turnierId, verein, extra = {}) {
    nr += 1;
    return id((await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, judopass_id: `P-${nr}`, vorname: 'V', nachname: `N${nr}`, geschlecht: 'm',
        verein, gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012, ...extra
    }).returning('id'))[0]);
}

test('Zahlwege-Service', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const ausrichter = id((await knex('vereine').insert({ name: 'JC Ausrichter' }).returning('id'))[0]);
        const vA = id((await knex('vereine').insert({ name: 'JC A' }).returning('id'))[0]);
        const neuesTurnier = async (extra = {}) => {
            const t = await knex('turniere').insert({
                bezeichnung: 'Cup', ort: 'O', datum: morgen(), ausrichter: 'JC Ausrichter', verein_id: ausrichter,
                status: 'veroeffentlicht', startgeld: 10, anmeldeschluss: morgen(), ...extra
            }).returning('*');
            return t[0];
        };
        const t = await neuesTurnier();
        const speichere = (vereinName, eingabe = EINGABE, turnier = t) =>
            zw.speichereZahlweg(knex, { turnier, vereinName, vereinId: vA, benutzerId: 'u1', eingabe });
        const fehlerStatus = async (fn) => { try { await fn(); } catch (e) { return e.statusCode; } return null; };

        // Upsert zweimal -> genau eine Zeile
        await speichere('JC A');
        await speichere('JC A', { ...EINGABE, rechnung_email: 'neu@b.de' });
        const zeilen = await knex('turnier_zahlwege').where({ turnier_id: t.id });
        assert.equal(zeilen.length, 1);
        assert.equal(zeilen[0].rechnung_email, 'neu@b.de');
        assert.equal((await zw.ladeZahlwegFuerVerein(knex, t.id, 'JC A')).zahlweg, 'ueberweisung');
        assert.equal(await zw.ladeZahlwegFuerVerein(knex, t.id, 'JC X'), null);

        // Vorbelegung: jüngste Zeile desselben Namens über alle Turniere
        const v = await zw.ladeVorbelegung(knex, 'JC A');
        assert.equal(v.rechnung_email, 'neu@b.de');
        assert.equal(await zw.ladeVorbelegung(knex, 'JC Nirgends'), null);

        // Fehlerfälle
        const gratis = await neuesTurnier({ startgeld: 0 });
        assert.equal(await fehlerStatus(() => speichere('JC A', EINGABE, gratis)), 400);
        assert.equal(await fehlerStatus(() => speichere('JC A', { ...EINGABE, rechnung_email: 'kaputt' })), 400);
        assert.equal(await fehlerStatus(() => speichere('JC A', { ...EINGABE, zahlweg: 'lastschrift' })), 400);
        const spaet = await neuesTurnier({ anmeldeschluss: '2020-01-01' });
        assert.equal(await fehlerStatus(() => speichere('JC A', EINGABE, spaet)), 403);
        assert.equal(await fehlerStatus(() => speichere('JC Ausrichter')), 403);

        // synchronisiereGesichert
        const tnA = await teilnehmer(knex, t.id, 'JC A');
        const tnB = await teilnehmer(knex, t.id, 'JC B');
        const tnK = await teilnehmer(knex, t.id, 'JC Köln e.V');
        const tnO = await teilnehmer(knex, t.id, 'JC Ausrichter');
        await speichere('JC B', { ...EINGABE, zahlweg: 'bar' });
        await zw.synchronisiereGesichert(knex, t.id);
        const flag = async (i) => (await knex('turnier_teilnehmer').where({ id: i }).first()).startgeld_zahlweg_gesichert;
        assert.equal(await flag(tnA), true);
        assert.equal(await flag(tnO), true);
        assert.equal(await flag(tnB), false);
        assert.equal(await flag(tnK), false);
        assert.equal(await zw.synchronisiereGesichert(knex, t.id), 0);

        // Wechsel ueberweisung -> bar: Flag zurück, startgeld_bezahlt bleibt, Status fällt zurück
        const tnA2 = await teilnehmer(knex, t.id, 'JC A', { gewogen: true, status: 'kampfbereit', startgeld_zahlweg_gesichert: true });
        const tnA3 = await teilnehmer(knex, t.id, 'JC A', { gewogen: true, status: 'kampfbereit', startgeld_zahlweg_gesichert: true, startgeld_bezahlt: true });
        await speichere('JC A', { ...EINGABE, zahlweg: 'bar' });
        assert.equal(await flag(tnA), false);
        const a2 = await knex('turnier_teilnehmer').where({ id: tnA2 }).first();
        assert.equal(a2.status, 'angemeldet');
        const a3 = await knex('turnier_teilnehmer').where({ id: tnA3 }).first();
        assert.equal(a3.startgeld_bezahlt, true);
        assert.equal(a3.status, 'kampfbereit');
        // und zurück: wieder gesichert, Status wieder kampfbereit
        await speichere('JC A', EINGABE);
        assert.equal((await knex('turnier_teilnehmer').where({ id: tnA2 }).first()).status, 'kampfbereit');

        // Kasse: JC B (bar) und JC Köln e.V (ohne Zeile), nicht JC A, nicht Ausrichter
        await speichere('JC A', { ...EINGABE, rechnung_email: 'a@b.de' });
        await knex('turnier_teilnehmer').where({ id: tnB }).update({ gewogen: true, status: 'angemeldet' });
        const kasse = await zw.ladeKasse(knex, t.id);
        assert.deepEqual(kasse.map((k) => k.vereinName).sort(), ['JC B', 'JC Köln e.V']);
        const kB = kasse.find((k) => k.vereinName === 'JC B');
        assert.equal(kB.zahlweg, 'bar');
        assert.equal(kB.anzahlKaempfer, 1);
        assert.equal(kB.anzahlOffen, 1);
        assert.equal(kB.rechnungEmail, 'a@b.de');
        const kK = kasse.find((k) => k.vereinName === 'JC Köln e.V');
        assert.equal(kK.zahlweg, 'ohneZahlweg');
        assert.equal(kK.rechnungEmail, null);

        // kassiereBar
        assert.equal(await zw.kassiereBar(knex, t.id, 'JC B'), 1);
        const b = await knex('turnier_teilnehmer').where({ id: tnB }).first();
        assert.equal(b.startgeld_bezahlt, true);
        assert.equal(b.status, 'kampfbereit');
        assert.equal(await zw.kassiereBar(knex, t.id, 'JC B'), 0);
        assert.equal((await zw.ladeKasse(knex, t.id)).find((k) => k.vereinName === 'JC B').anzahlOffen, 0);

        // Zurückgezogene Kämpfer zählen weder in der Kasse noch beim Bar-Kassieren
        const t3 = await neuesTurnier();
        const w1 = await teilnehmer(knex, t3.id, 'JC W');
        const w2 = await teilnehmer(knex, t3.id, 'JC W');
        await knex('turnier_teilnehmer').where({ id: w2 }).update({ status: 'zurueckgezogen' });
        const kW = (await zw.ladeKasse(knex, t3.id)).find((k) => k.vereinName === 'JC W');
        assert.equal(kW.anzahlKaempfer, 1);
        assert.equal(kW.anzahlOffen, 1);
        assert.equal(await zw.kassiereBar(knex, t3.id, 'JC W'), 1);
        assert.equal((await knex('turnier_teilnehmer').where({ id: w2 }).first()).startgeld_bezahlt, false);
        assert.equal((await knex('turnier_teilnehmer').where({ id: w1 }).first()).startgeld_bezahlt, true);
        assert.equal((await zw.ladeKasse(knex, t3.id)).find((k) => k.vereinName === 'JC W').anzahlKaempfer, 1);

        // synchronisiereGesichert ohne Statusableitung ändert nur das Flag
        const t4 = await neuesTurnier();
        const s1 = await teilnehmer(knex, t4.id, 'JC Ausrichter', { status: 'nicht_erschienen', gewogen: true, startgeld_bezahlt: true });
        assert.equal(await zw.synchronisiereGesichert(knex, t4.id, { statusAbleiten: false }), 1);
        const s = await knex('turnier_teilnehmer').where({ id: s1 }).first();
        assert.equal(s.startgeld_zahlweg_gesichert, true);
        assert.equal(s.status, 'nicht_erschienen');

        // Parallel: zwei Speicherungen desselben Vereins werfen nicht
        const t2 = await neuesTurnier();
        await Promise.all([speichere('JC P', EINGABE, t2), speichere('JC P', { ...EINGABE, zahlweg: 'bar' }, t2)]);
        assert.equal((await knex('turnier_zahlwege').where({ turnier_id: t2.id })).length, 1);
    } finally {
        await stoppe();
    }
});
