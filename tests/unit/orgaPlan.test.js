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
