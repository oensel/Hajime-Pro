import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { hashPassword } from '../../src/utils/password.js';
import { datumAlsText } from '../../src/services/helferPlan.js';
import { sendeFaelligeErinnerungen } from '../../src/services/orgaErinnerung.js';

const id = (r) => (typeof r === 'object' ? r.id : r);
const BASIS = 'https://hajime.example';
// 10.12.2026, 11:00 Berlin
const JETZT = new Date('2026-12-10T10:00:00Z');
let db;
let knex;

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
});
after(async () => { await db?.stoppe?.(); });

function sammler(wirf = false) {
    const mails = [];
    const sende = async (m) => { if (wirf) throw new Error('SMTP down'); mails.push(m); };
    return { mails, sende };
}
async function neuesTurnier() {
    const vid = id((await knex('vereine').insert({ name: `V-${crypto.randomUUID()}` }).returning('id'))[0]);
    const tid = id((await knex('turniere').insert({
        bezeichnung: 'Nikolausturnier', ort: 'O', datum: '2026-12-20', ausrichter: 'A', anmeldeschluss: '2026-12-01', verein_id: vid
    }).returning('id'))[0]);
    return { vid, tid };
}
async function neuesKonto(email) {
    const bid = crypto.randomUUID();
    await knex('benutzer').insert({
        id: bid, email, vorname: 'Vor', nachname: 'Nach', password_hash: hashPassword('altes-passwort'),
        email_bestaetigt_am: knex.fn.now()
    });
    return bid;
}
async function aufgabe(tid, felder = {}) {
    return id((await knex('orga_aufgaben').insert({
        turnier_id: tid, phase: 'vorbereitung', art: 'aufgabe', titel: 'Halle', ...felder
    }).returning('id'))[0]);
}
const hole = (aid) => knex('orga_aufgaben').where({ id: aid }).first();
const text = datumAlsText;

test('Fälligkeit in 3 Tagen: Mail mit Link, erinnert_fuer gesetzt, zweiter Lauf ohne Mail', async () => {
    const { tid } = await neuesTurnier();
    const k = await neuesKonto(`e1-${crypto.randomUUID()}@x.de`);
    const aid = await aufgabe(tid, { benutzer_id: k, faellig_am: '2026-12-13' });
    const { mails, sende } = sammler();
    const r = await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende, basisUrl: BASIS });
    assert.ok(r.gesendet >= 1);
    const mail = mails.find((m) => m.text.includes('Halle') && m.text.includes('Nikolausturnier'));
    assert.ok(mail);
    assert.match(mail.text, /https:\/\/hajime\.example\/helfer\.html#aufgaben/);
    assert.equal(text((await hole(aid)).erinnert_fuer), '2026-12-13');
    const zweiter = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende: zweiter.sende, basisUrl: BASIS });
    assert.equal(zweiter.mails.filter((m) => m.to === mail.to).length, 0);
});

test('4 Tage, überfällig, erledigt, ohne Zuständigen: keine Mail', async () => {
    const { tid } = await neuesTurnier();
    const k = await neuesKonto(`e2-${crypto.randomUUID()}@x.de`);
    await aufgabe(tid, { benutzer_id: k, faellig_am: '2026-12-14', titel: 'vier' });
    await aufgabe(tid, { benutzer_id: k, faellig_am: '2026-12-09', titel: 'ueberfaellig' });
    await aufgabe(tid, { benutzer_id: k, faellig_am: '2026-12-11', titel: 'erledigt', erledigt_am: knex.fn.now() });
    await aufgabe(tid, { faellig_am: '2026-12-11', titel: 'niemand' });
    const { mails, sende } = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende, basisUrl: BASIS });
    assert.equal(mails.filter((m) => /vier|ueberfaellig|erledigt|niemand/.test(m.subject)).length, 0);
});

test('Geänderte Fälligkeit: erneute Erinnerung; freie Person mit Adresse ohne Link', async () => {
    const { tid } = await neuesTurnier();
    const mail = `frei-${crypto.randomUUID()}@x.de`;
    const aid = await aufgabe(tid, { name_frei: 'Frei', email_frei: mail, faellig_am: '2026-12-11', titel: 'FreiAufgabe' });
    const a = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende: a.sende, basisUrl: BASIS });
    const m1 = a.mails.find((m) => m.to === mail);
    assert.ok(m1);
    assert.ok(!m1.text.includes('http'));
    await knex('orga_aufgaben').where({ id: aid }).update({ faellig_am: '2026-12-12' });
    const b = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende: b.sende, basisUrl: BASIS });
    assert.equal(b.mails.filter((m) => m.to === mail).length, 1);
    assert.equal(text((await hole(aid)).erinnert_fuer), '2026-12-12');
});

test('sende wirft: erinnert_fuer bleibt null, nächster Lauf versucht es erneut', async () => {
    const { tid } = await neuesTurnier();
    const k = await neuesKonto(`e4-${crypto.randomUUID()}@x.de`);
    const aid = await aufgabe(tid, { benutzer_id: k, faellig_am: '2026-12-12' });
    const orig = console.error;
    console.error = () => {};
    try {
        await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende: sammler(true).sende, basisUrl: BASIS });
    } finally { console.error = orig; }
    assert.equal((await hole(aid)).erinnert_fuer, null);
    const { mails, sende } = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende, basisUrl: BASIS });
    assert.ok(mails.some((m) => m.to.startsWith('e4-')));
    assert.equal(text((await hole(aid)).erinnert_fuer), '2026-12-12');
});

test('Posten mit Zuständigem nutzt die Fälligkeit der Eltern', async () => {
    const { tid } = await neuesTurnier();
    const k = await neuesKonto(`e5-${crypto.randomUUID()}@x.de`);
    const eltern = await aufgabe(tid, { faellig_am: '2026-12-12', titel: 'Catering' });
    const posten = await aufgabe(tid, { art: 'posten', eltern_id: eltern, benutzer_id: k, faellig_am: null, titel: 'Kuchen' });
    const { mails, sende } = sammler();
    await sendeFaelligeErinnerungen(knex, { jetzt: JETZT, sende, basisUrl: BASIS });
    assert.ok(mails.some((m) => m.to.startsWith('e5-') && m.text.includes('Kuchen')));
    assert.equal(text((await hole(posten)).erinnert_fuer), '2026-12-12');
});
