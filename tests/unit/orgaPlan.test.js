import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import {
    legeAusVorlageAn, ladeOrga, legeAufgabeAn, aendereAufgabe, loescheAufgabe, setzeErledigt, berechneFaelligkeitenNeu
} from '../../src/services/orgaPlan.js';
import { ORGA_VORLAGE } from '../../src/shared/orgaVorlage.js';

const id = (r) => (typeof r === 'object' ? r.id : r);
let db;
let knex;

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
});
after(async () => { await db?.stoppe?.(); });

async function neuesTurnier(datum = '2026-12-12', anmeldeschluss = '2026-12-01') {
    return id((await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum, ausrichter: 'A', anmeldeschluss }).returning('id'))[0]);
}
const alle = (phasen) => phasen.flatMap((p) => p.aufgaben);
const finde = (phasen, key) => alle(phasen).find((a) => a.vorlage_key === key);

test('Vorlage anlegen: alle Phasen, idempotent', async () => {
    const tid = await neuesTurnier();
    const r1 = await legeAusVorlageAn(knex, tid);
    assert.equal(r1.angelegt, ORGA_VORLAGE.length);
    const r2 = await legeAusVorlageAn(knex, tid);
    assert.equal(r2.angelegt, 0);
    const orga = await ladeOrga(knex, tid);
    assert.deepEqual(orga.phasen.map((p) => p.phase), ['grundlage', 'vorbereitung', 'meldephase', 'turniertag', 'nachbereitung']);
    assert.equal(orga.kennzahlen.gesamt, ORGA_VORLAGE.length);
    const catering = finde(orga.phasen, 'catering');
    assert.equal(catering.mitbringliste, true);
    assert.equal(catering.kinder.length, 7);
    assert.equal(finde(orga.phasen, 'ausschreibung').faellig_am, '2026-10-17');
    assert.equal(finde(orga.phasen, 'mattenzahl').faellig_am, '2026-12-01');
});

test('Datumsänderung verschiebt nur Aufgaben ohne faellig_manuell', async () => {
    const tid = await neuesTurnier();
    await legeAusVorlageAn(knex, tid);
    const vorher = await ladeOrga(knex, tid);
    const manuell = finde(vorher.phasen, 'wiegen');
    await aendereAufgabe(knex, manuell.id, { faellig_am: '2026-12-10' });
    await knex('turniere').where({ id: tid }).update({ datum: '2027-01-09', anmeldeschluss: '2026-12-20' });
    await berechneFaelligkeitenNeu(knex, tid);
    const nachher = await ladeOrga(knex, tid);
    assert.equal(finde(nachher.phasen, 'wiegen').faellig_am, '2026-12-10');
    assert.equal(finde(nachher.phasen, 'abbau').faellig_am, '2027-01-09');
    assert.equal(finde(nachher.phasen, 'mattenzahl').faellig_am, '2026-12-20');
});

test('Posten erledigt macht Eltern erledigt; Mitbringeintrag zählt nicht', async () => {
    const tid = await neuesTurnier();
    await legeAusVorlageAn(knex, tid);
    let orga = await ladeOrga(knex, tid);
    const cat = finde(orga.phasen, 'catering');
    await legeAufgabeAn(knex, tid, { eltern_id: cat.id, art: 'mitbringen', titel: 'Kuchen', benutzerId: null });
    orga = await ladeOrga(knex, tid);
    assert.equal(finde(orga.phasen, 'catering').status.status, 'offen');
    for (const k of cat.kinder) await setzeErledigt(knex, k.id, { erledigt: true, benutzerId: null });
    orga = await ladeOrga(knex, tid);
    const c = finde(orga.phasen, 'catering');
    assert.equal(c.status.status, 'erledigt');
    assert.equal(c.kinder.length, 8);
    const mit = c.kinder.find((k) => k.art === 'mitbringen');
    assert.equal(mit.titel, 'Kuchen');
    // Rückgängig
    await setzeErledigt(knex, cat.kinder[0].id, { erledigt: false, benutzerId: null });
    orga = await ladeOrga(knex, tid);
    assert.equal(finde(orga.phasen, 'catering').status.status, 'angefangen');
});

test('Kampfrichter besetzt wird automatisch aus dem Helferplan erledigt', async () => {
    const tid = await neuesTurnier();
    await legeAusVorlageAn(knex, tid);
    const ta = id((await knex('helfer_taetigkeiten').insert({ turnier_id: tid, art: 'kampfrichter', bezeichnung: 'Kampfrichter Matte 1', bedarf: 1 }).returning('id'))[0]);
    const s1 = id((await knex('helfer_slots').insert({ taetigkeit_id: ta, von_min: 480, bis_min: 600, bedarf: 1 }).returning('id'))[0]);
    const s2 = id((await knex('helfer_slots').insert({ taetigkeit_id: ta, von_min: 600, bis_min: 720, bedarf: 1 }).returning('id'))[0]);
    await knex('helfer_einsaetze').insert({ slot_id: s1, name_manuell: 'A' });
    let orga = await ladeOrga(knex, tid);
    assert.equal(finde(orga.phasen, 'kampfrichter').status.status, 'angefangen');
    assert.equal(finde(orga.phasen, 'helferbedarf').status.quelle, 'helferplan');
    await knex('helfer_einsaetze').insert({ slot_id: s2, name_manuell: 'B' });
    orga = await ladeOrga(knex, tid);
    assert.equal(finde(orga.phasen, 'kampfrichter').status.status, 'erledigt');
    assert.equal(finde(orga.phasen, 'kampfrichter').status.quelle, 'helferplan');
});

test('Löschen einer Hauptaufgabe löscht Kinder; Kennzahlen', async () => {
    const tid = await neuesTurnier('2020-01-01', '2019-12-01');
    await legeAusVorlageAn(knex, tid);
    let orga = await ladeOrga(knex, tid);
    assert.ok(orga.kennzahlen.ueberfaellig > 0);
    assert.equal(orga.kennzahlen.ohneZustaendigen, orga.kennzahlen.gesamt);
    const cat = finde(orga.phasen, 'catering');
    await loescheAufgabe(knex, cat.id);
    assert.equal((await knex('orga_aufgaben').where({ eltern_id: cat.id })).length, 0);
    orga = await ladeOrga(knex, tid);
    assert.equal(orga.kennzahlen.gesamt, ORGA_VORLAGE.length - 1);
});

test('Eigene Aufgabe anlegen und ändern', async () => {
    const tid = await neuesTurnier();
    const neu = await legeAufgabeAn(knex, tid, { phase: 'vorbereitung', titel: 'Eigene', frist_anker: 'turnier', frist_tage: -3 });
    const z = await knex('orga_aufgaben').where({ id: neu.id }).first();
    assert.equal(String(z.faellig_am.getDate()), '9');
    await assert.rejects(legeAufgabeAn(knex, tid, { phase: 'quatsch', titel: 'X' }), { statusCode: 400 });
    await assert.rejects(aendereAufgabe(knex, 999999, { titel: 'x' }), { statusCode: 404 });
});

test('Übernahme: ohneZustaendigen zählt nur offene Hauptaufgaben', async () => {
    const tid = await neuesTurnier();
    await legeAusVorlageAn(knex, tid);
    const vorher = (await ladeOrga(knex, tid)).kennzahlen.ohneZustaendigen;
    assert.equal(vorher, ORGA_VORLAGE.length);
    const orga = await ladeOrga(knex, tid);
    await setzeErledigt(knex, finde(orga.phasen, 'wiegen').id, { erledigt: true });
    assert.equal((await ladeOrga(knex, tid)).kennzahlen.ohneZustaendigen, vorher - 1);
});

test('Übernahme: frist_anker null löscht die Frist, unbekannter Zuständiger 400, Mitbringen nur unter Mitbringliste', async () => {
    const tid = await neuesTurnier();
    await legeAusVorlageAn(knex, tid);
    const orga = await ladeOrga(knex, tid);
    const abbau = finde(orga.phasen, 'abbau');
    await aendereAufgabe(knex, abbau.id, { frist_anker: null });
    const z = await knex('orga_aufgaben').where({ id: abbau.id }).first();
    assert.equal(z.frist_anker, null);
    assert.equal(z.frist_tage, null);
    assert.equal(z.faellig_am, null);
    await assert.rejects(aendereAufgabe(knex, abbau.id, { benutzer_id: 'gibt-es-nicht' }), (e) => e.statusCode === 400);
    const med = finde(orga.phasen, 'medaillen');
    await assert.rejects(legeAufgabeAn(knex, tid, { eltern_id: med.id, art: 'mitbringen', titel: 'x' }), (e) => e.statusCode === 400);
});

test('Zuständige müssen freigegebene Mitglieder des Vereins sein', async () => {
    const verein = id((await knex('vereine').insert({ name: 'JC Mitglied' }).returning('id'))[0]);
    const tid = id((await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2032-01-01', ausrichter: 'A', verein_id: verein }).returning('id'))[0]);
    for (const n of ['mit', 'fremd', 'offen']) {
        await knex('benutzer').insert({ id: `u-zm-${n}`, email: `zm-${n}@test.de`, vorname: n, nachname: 'T' });
    }
    await knex('benutzer_vereine').insert([
        { benutzer_id: 'u-zm-mit', verein_id: verein, freigegeben: 1, rolle: 'helfer' },
        { benutzer_id: 'u-zm-offen', verein_id: verein, freigegeben: 0, rolle: null }
    ]);
    const { id: aid } = await legeAufgabeAn(knex, tid, { titel: 'X', phase: 'turniertag', benutzer_id: 'u-zm-mit' });
    await aendereAufgabe(knex, aid, { benutzer_id: 'u-zm-mit' });
    for (const bid of ['u-zm-fremd', 'u-zm-offen', 'unbekannt']) {
        await assert.rejects(aendereAufgabe(knex, aid, { benutzer_id: bid }), (e) => e.statusCode === 400);
        await assert.rejects(legeAufgabeAn(knex, tid, { titel: 'Y', phase: 'turniertag', benutzer_id: bid }), (e) => e.statusCode === 400);
    }
});

test('Kategorie: oberste Ebene mit Aufgaben darunter, Phasenwechsel nimmt die Aufgaben mit', async () => {
    const tid = await neuesTurnier();
    const { id: kat } = await legeAufgabeAn(knex, tid, { art: 'kategorie', titel: 'Sanitätsdienst', phase: 'vorbereitung' });
    const { id: kind } = await legeAufgabeAn(knex, tid, { eltern_id: kat, titel: 'Arzt anfragen' });
    let orga = await ladeOrga(knex, tid);
    const k = alle(orga.phasen).find((a) => a.id === kat);
    assert.equal(k.art, 'kategorie');
    assert.equal(k.kinder.length, 1);
    // Eine Kategorie liegt nur oben und enthält keine weitere Kategorie
    await assert.rejects(legeAufgabeAn(knex, tid, { art: 'kategorie', eltern_id: kat, titel: 'Unter' }), (e) => e.statusCode === 400);
    await aendereAufgabe(knex, kat, { phase: 'turniertag' });
    orga = await ladeOrga(knex, tid);
    const verschoben = orga.phasen.find((p) => p.phase === 'turniertag').aufgaben.find((a) => a.id === kat);
    assert.equal(verschoben.kinder[0].phase, 'turniertag');
    assert.equal((await knex('orga_aufgaben').where({ id: kind }).first()).phase, 'turniertag');
});
