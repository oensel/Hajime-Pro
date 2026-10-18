import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { hashPassword, verifyPassword } from '../../src/utils/password.js';
import { weiseZu, sendeEinladungNeu } from '../../src/services/orgaZuweisung.js';
import { pruefeEinladung, loeseEinladungEin } from '../../src/services/orgaEinladung.js';

const id = (r) => (typeof r === 'object' ? r.id : r);
const BASIS = 'https://hajime.example';
let db;
let knex;

before(async () => {
    db = await starteTestPostgres();
    knex = db.knex;
});
after(async () => { await db?.stoppe?.(); });

function sammler() {
    const mails = [];
    const sende = async (m) => { mails.push(m); };
    return { mails, sende };
}
let zaehler = 0;
async function neuerVerein() {
    zaehler += 1;
    return id((await knex('vereine').insert({ name: `Verein ${zaehler}-${crypto.randomUUID()}` }).returning('id'))[0]);
}
async function neuesKonto(email, vereinId, { bestaetigt = true, freigegeben = 1, rolle = 'helfer', passwort = 'altes-passwort' } = {}) {
    const bid = crypto.randomUUID();
    await knex('benutzer').insert({
        id: bid, email, vorname: 'Vor', nachname: 'Nach', password_hash: hashPassword(passwort),
        email_bestaetigt_am: bestaetigt ? knex.fn.now() : null, aktiver_verein_id: vereinId ?? null
    });
    if (vereinId) await knex('benutzer_vereine').insert({ benutzer_id: bid, verein_id: vereinId, freigegeben, rolle });
    return bid;
}
async function neueAufgabe(vereinId, felder = {}) {
    const tid = id((await knex('turniere').insert({
        bezeichnung: 'Turnier', ort: 'O', datum: '2026-12-12', ausrichter: 'A', anmeldeschluss: '2026-12-01', verein_id: vereinId
    }).returning('id'))[0]);
    const aid = id((await knex('orga_aufgaben').insert({
        turnier_id: tid, phase: 'vorbereitung', art: 'aufgabe', titel: 'Halle', ...felder
    }).returning('id'))[0]);
    return { tid, aid };
}
const holeAufgabe = (aid) => knex('orga_aufgaben').where({ id: aid }).first();
function tokenAus(text) {
    const m = /\/einladung\.html\?token=([A-Za-z0-9_-]+)/.exec(text);
    assert.ok(m, `Einladungslink fehlt: ${text}`);
    return m[1];
}

test('Konto mit Mitgliedschaft: Mail mit Link auf helfer.html#aufgaben', async () => {
    const v = await neuerVerein();
    const konto = await neuesKonto(`k1-${v}@x.de`, v);
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    const r = await weiseZu(knex, aid, { benutzerId: konto }, { basisUrl: BASIS, sende });
    assert.equal(r.modus, 'konto');
    assert.equal((await holeAufgabe(aid)).benutzer_id, konto);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, `k1-${v}@x.de`);
    assert.ok(mails[0].text.includes(`${BASIS}/helfer.html#aufgaben`));
});

test('Konto ohne freigegebene Mitgliedschaft im Verein: 400', async () => {
    const v = await neuerVerein();
    const anderer = await neuerVerein();
    const fremd = await neuesKonto(`k2-${v}@x.de`, anderer);
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    await assert.rejects(weiseZu(knex, aid, { benutzerId: fremd }, { basisUrl: BASIS, sende }), (e) => e.statusCode === 400);
    assert.equal(mails.length, 0);
    assert.equal((await holeAufgabe(aid)).benutzer_id, null);
});

test('Freier Name ohne E-Mail: keine Mail', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    const r = await weiseZu(knex, aid, { name: 'Oma Else' }, { basisUrl: BASIS, sende });
    assert.equal(r.modus, 'frei');
    assert.equal(mails.length, 0);
    const a = await holeAufgabe(aid);
    assert.equal(a.name_frei, 'Oma Else');
    assert.equal(a.benutzer_id, null);
});

test('Freier Name + E-Mail ohne Konto: Einladungsmail, nur Hash gespeichert', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    const r = await weiseZu(knex, aid, { name: 'Neu Mensch', email: ` Neu-${v}@X.de ` }, { basisUrl: BASIS, sende });
    assert.equal(r.modus, 'einladung');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, `neu-${v}@x.de`);
    const token = tokenAus(mails[0].text);
    const zeile = await knex('orga_einladungen').where({ verein_id: v }).first();
    assert.equal(zeile.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
    assert.notEqual(zeile.token_hash, token);
    const a = await holeAufgabe(aid);
    assert.equal(a.email_frei, `neu-${v}@x.de`);
    const info = await pruefeEinladung(knex, token);
    assert.equal(info.kontoVorhanden, false);
    assert.equal(info.email, `neu-${v}@x.de`);
});

test('E-Mail eines bestätigten Kontos mit Mitgliedschaft verhält sich wie Konto', async () => {
    const v = await neuerVerein();
    const konto = await neuesKonto(`k3-${v}@x.de`, v);
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    const r = await weiseZu(knex, aid, { name: 'Egal', email: `K3-${v}@x.de` }, { basisUrl: BASIS, sende });
    assert.equal(r.modus, 'konto');
    assert.equal((await holeAufgabe(aid)).benutzer_id, konto);
    assert.ok(mails[0].text.includes('/helfer.html#aufgaben'));
    assert.equal(await knex('orga_einladungen').where({ verein_id: v }).first(), undefined);
});

test('Neu einladen entwertet ältere offene Einladungen', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    await weiseZu(knex, aid, { name: 'N', email: `n-${v}@x.de` }, { basisUrl: BASIS, sende });
    await sendeEinladungNeu(knex, aid, BASIS, { sende });
    assert.equal(mails.length, 2);
    const alt = tokenAus(mails[0].text);
    const neu = tokenAus(mails[1].text);
    assert.equal(await pruefeEinladung(knex, alt), null);
    assert.ok(await pruefeEinladung(knex, neu));
});

test('Fehlendes basisUrl: 503, nichts gespeichert', async () => {
    const v = await neuerVerein();
    const konto = await neuesKonto(`k4-${v}@x.de`, v);
    const { aid } = await neueAufgabe(v);
    const { sende } = sammler();
    await assert.rejects(weiseZu(knex, aid, { benutzerId: konto }, { basisUrl: null, sende }), (e) => e.statusCode === 503);
    await assert.rejects(weiseZu(knex, aid, { name: 'N', email: `n4-${v}@x.de` }, { basisUrl: null, sende }), (e) => e.statusCode === 503);
    assert.equal((await holeAufgabe(aid)).benutzer_id, null);
    assert.equal((await weiseZu(knex, aid, { name: 'Ohne' }, { basisUrl: null, sende })).modus, 'frei');
});

test('Mailfehler bricht die Zuweisung nicht', async () => {
    const v = await neuerVerein();
    const konto = await neuesKonto(`k5-${v}@x.de`, v);
    const { aid } = await neueAufgabe(v);
    const r = await weiseZu(knex, aid, { benutzerId: konto }, { basisUrl: BASIS, sende: async () => { throw new Error('smtp'); } });
    assert.equal(r.modus, 'konto');
    assert.equal((await holeAufgabe(aid)).benutzer_id, konto);
});

test('Zuweisung aufheben leert alle Felder', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v, { name_frei: 'X', email_frei: 'x@x.de' });
    await weiseZu(knex, aid, { frei: false }, { basisUrl: BASIS, sende: sammler().sende });
    const a = await holeAufgabe(aid);
    assert.deepEqual([a.benutzer_id, a.name_frei, a.email_frei], [null, null, null]);
});

test('Einlösen: Konto, Mitgliedschaft helfer, offene Aufgaben der Adresse, Token verbraucht', async () => {
    const v = await neuerVerein();
    const { tid, aid } = await neueAufgabe(v);
    const email = `e1-${v}@x.de`;
    const { mails, sende } = sammler();
    await weiseZu(knex, aid, { name: 'Else', email }, { basisUrl: BASIS, sende });
    const erledigt = id((await knex('orga_aufgaben').insert({
        turnier_id: tid, phase: 'vorbereitung', art: 'aufgabe', titel: 'Fertig', email_frei: email, erledigt_am: knex.fn.now()
    }).returning('id'))[0]);
    const fremdVerein = await neuerVerein();
    const fremd = await neueAufgabe(fremdVerein, { email_frei: email });
    const zweite = id((await knex('orga_aufgaben').insert({
        turnier_id: tid, phase: 'vorbereitung', art: 'aufgabe', titel: 'Zweite', email_frei: email, name_frei: 'Else'
    }).returning('id'))[0]);
    const token = tokenAus(mails[0].text);

    const r = await loeseEinladungEin(knex, token, { password: 'langes-passwort', vorname: 'Else', nachname: 'Meyer' });
    assert.equal(r.ok, true);
    assert.equal(r.vereinId, v);
    const konto = await knex('benutzer').where({ id: r.benutzerId }).first();
    assert.equal(konto.email, email);
    assert.ok(konto.email_bestaetigt_am);
    assert.ok(verifyPassword('langes-passwort', konto.password_hash));
    const mit = await knex('benutzer_vereine').where({ benutzer_id: r.benutzerId, verein_id: v }).first();
    assert.equal(mit.rolle, 'helfer');
    assert.equal(Number(mit.freigegeben), 1);
    assert.equal((await holeAufgabe(aid)).benutzer_id, r.benutzerId);
    assert.equal((await holeAufgabe(zweite)).benutzer_id, r.benutzerId);
    assert.equal((await holeAufgabe(erledigt)).benutzer_id, null);
    assert.equal((await holeAufgabe(fremd.aid)).benutzer_id, null);
    assert.equal((await holeAufgabe(aid)).name_frei, 'Else');

    const nochmal = await loeseEinladungEin(knex, token, { password: 'langes-passwort', vorname: 'E', nachname: 'M' });
    assert.equal(nochmal.ok, false);
    assert.equal(await pruefeEinladung(knex, token), null);
});

test('Einlösen: abgelaufen, unbekannt, manipuliert', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    await weiseZu(knex, aid, { name: 'N', email: `e2-${v}@x.de` }, { basisUrl: BASIS, sende });
    const token = tokenAus(mails[0].text);
    const daten = { password: 'langes-passwort', vorname: 'A', nachname: 'B' };
    assert.equal((await loeseEinladungEin(knex, token + 'x', daten)).ok, false);
    assert.equal((await loeseEinladungEin(knex, 'unbekannt', daten)).ok, false);
    assert.equal((await loeseEinladungEin(knex, undefined, daten)).ok, false);
    await knex('orga_einladungen').where({ verein_id: v }).update({ laeuft_ab_am: knex.raw("now() - interval '1 minute'") });
    assert.equal(await pruefeEinladung(knex, token), null);
    const r = await loeseEinladungEin(knex, token, daten);
    assert.equal(r.ok, false);
    assert.equal(await knex('benutzer').where({ email: `e2-${v}@x.de` }).first(), undefined);
});

test('Einlösen: zu kurzes Passwort 400 und Token bleibt gültig', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    await weiseZu(knex, aid, { name: 'N', email: `e3-${v}@x.de` }, { basisUrl: BASIS, sende });
    const token = tokenAus(mails[0].text);
    const r = await loeseEinladungEin(knex, token, { password: 'kurz', vorname: 'A', nachname: 'B' });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.ok(await pruefeEinladung(knex, token));
    const ok = await loeseEinladungEin(knex, token, { password: 'langes-passwort', vorname: 'A', nachname: 'B' });
    assert.equal(ok.ok, true);
});

test('Einlösen: Konto in anderem Verein bekommt nur die Mitgliedschaft', async () => {
    const v = await neuerVerein();
    const anderer = await neuerVerein();
    const email = `e4-${v}@x.de`;
    const konto = await neuesKonto(email, anderer, { passwort: 'mein-altes-pw' });
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    const z = await weiseZu(knex, aid, { name: 'N', email }, { basisUrl: BASIS, sende });
    assert.equal(z.modus, 'einladung');
    const token = tokenAus(mails[0].text);
    assert.equal((await pruefeEinladung(knex, token)).kontoVorhanden, true);

    const falsch = await loeseEinladungEin(knex, token, { password: 'falsches-passwort' });
    assert.equal(falsch.ok, false);
    assert.equal(falsch.status, 401);
    assert.ok(await pruefeEinladung(knex, token), 'Token bleibt nach falschem Passwort gültig');

    const r = await loeseEinladungEin(knex, token, { password: 'mein-altes-pw', vorname: 'Neu', nachname: 'Name' });
    assert.deepEqual([r.ok, r.benutzerId, r.vereinId], [true, konto, v]);
    assert.equal((await knex('benutzer').where({ email }).count('* as n').first()).n, '1');
    const b = await knex('benutzer').where({ id: konto }).first();
    assert.equal(b.vorname, 'Vor');
    assert.ok(verifyPassword('mein-altes-pw', b.password_hash));
    const mit = await knex('benutzer_vereine').where({ benutzer_id: konto, verein_id: v }).first();
    assert.equal(mit.rolle, 'helfer');
    assert.equal(Number(mit.freigegeben), 1);
    assert.equal((await holeAufgabe(aid)).benutzer_id, konto);
});

test('Einlösen: unbestätigtes Konto wird überschrieben und bestätigt, alter E-Mail-Token tot', async () => {
    const v = await neuerVerein();
    const email = `e5-${v}@x.de`;
    const konto = await neuesKonto(email, null, { bestaetigt: false, passwort: 'angreifer-pw' });
    await knex('token_einmal').insert({
        benutzer_id: konto, zweck: 'email', token_hash: crypto.randomUUID(), laeuft_ab_am: knex.raw("now() + interval '1 day'")
    });
    const { aid } = await neueAufgabe(v);
    const { mails, sende } = sammler();
    await weiseZu(knex, aid, { name: 'N', email }, { basisUrl: BASIS, sende });
    const token = tokenAus(mails[0].text);
    assert.equal((await pruefeEinladung(knex, token)).kontoVorhanden, false);
    assert.equal((await loeseEinladungEin(knex, token, { password: 'kurz', vorname: 'A', nachname: 'B' })).status, 400);
    const r = await loeseEinladungEin(knex, token, { password: 'neues-passwort', vorname: 'Echt', nachname: 'Person' });
    assert.deepEqual([r.ok, r.benutzerId], [true, konto]);
    const b = await knex('benutzer').where({ id: konto }).first();
    assert.ok(b.email_bestaetigt_am);
    assert.equal(b.vorname, 'Echt');
    assert.ok(verifyPassword('neues-passwort', b.password_hash));
    assert.ok(!verifyPassword('angreifer-pw', b.password_hash));
    assert.equal((await knex('token_einmal').where({ benutzer_id: konto, zweck: 'email' }).whereNull('benutzt_am')).length, 0);
    assert.equal((await holeAufgabe(aid)).benutzer_id, konto);
});

test('Einlösen: bestehende Admin-Mitgliedschaft bleibt unverändert', async () => {
    const v = await neuerVerein();
    const email = `e6-${v}@x.de`;
    const konto = await neuesKonto(email, v, { rolle: 'admin', passwort: 'admin-pw-123' });
    await knex('orga_einladungen').insert({
        token_hash: crypto.createHash('sha256').update('tok-e6').digest('hex'), email, verein_id: v,
        laeuft_ab_am: knex.raw("now() + interval '1 day'")
    });
    const r = await loeseEinladungEin(knex, 'tok-e6', { password: 'admin-pw-123' });
    assert.equal(r.ok, true);
    const mit = await knex('benutzer_vereine').where({ benutzer_id: konto, verein_id: v }).first();
    assert.equal(mit.rolle, 'admin');
});

test('Zuweisen: ungültige Adressen werden abgelehnt', async () => {
    const v = await neuerVerein();
    const { aid } = await neueAufgabe(v);
    const { sende } = sammler();
    for (const mail of ['a@b', 'a@b.de,c@d.de', 'a b@c.de', '<a@b.de>', 'a@b.de;c@d.de', 'a"@b.de', 'a@b.']) {
        await assert.rejects(weiseZu(knex, aid, { name: 'N', email: mail }, { basisUrl: BASIS, sende }), (e) => e.statusCode === 400, mail);
    }
});
