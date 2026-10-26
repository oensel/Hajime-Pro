import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { starteTestPostgres } from '../helpers/testPostgres.js';

pg.types.setTypeParser(1082, (val) => val);

const ALT = 'a'.repeat(40);
const NEU = 'n'.repeat(40);
const ENV_ALT = { ZAHLUNGSDATEN_SCHLUESSEL: ALT };
const ENV_WECHSEL = { ZAHLUNGSDATEN_SCHLUESSEL: NEU, ZAHLUNGSDATEN_SCHLUESSEL_ALT: ALT };
const IBAN = 'DE89370400440532013000';

const { verschluesseleFeld, entschluesseleFeld, schluesselKennung } = await import('../../src/utils/feldVerschluesselung.js');
const { schluesseleUm, pruefeSchluessel } = await import('../../scripts/zahlungsdaten-schluessel.mjs');
const { loescheAbgelaufeneMandate } = await import('../../src/services/mandate.js');
const { erzeugeToken } = await import('../../src/services/einmalToken.js');

const id = (r) => (typeof r === 'object' ? r.id : r);
const tag = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function mandatZeile(knex, n, extra) {
    return id((await knex('lastschrift_mandate').insert({
        verein_name: 'JC A', mandatsreferenz: `REF${n}`, mandatstext: 't', textversion: '1', glaeubiger_id: 'DE98ZZZ09999999999',
        glaeubiger_name: 'G', status: 'gueltig', erteilt_am: knex.fn.now(), erteilt_von: 'x', vertretung_bestaetigt: true, ...extra
    }).returning('id'))[0]);
}

test('Schlüsselwechsel: pruefen zählt je kid, umschluesseln ist atomar, idempotent und verlangt beide Schlüssel', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const v = id((await knex('vereine').insert({ name: 'JC Aus' }).returning('id'))[0]);
        await knex('vereins_abrechnung').insert({ verein_id: v, iban_verschluesselt: verschluesseleFeld(IBAN, ENV_ALT) });
        const m1 = await mandatZeile(knex, 1, { daten_verschluesselt: verschluesseleFeld(JSON.stringify({ iban: IBAN, kontoinhaber: 'K', ip: null }), ENV_ALT) });
        const m2 = await mandatZeile(knex, 2, { daten_verschluesselt: verschluesseleFeld('{"iban":"X"}', ENV_WECHSEL) });
        await mandatZeile(knex, 3, { daten_verschluesselt: null, status: 'widerrufen' });
        await mandatZeile(knex, 4, { daten_verschluesselt: verschluesseleFeld('{}', { ZAHLUNGSDATEN_SCHLUESSEL: 'q'.repeat(40) }) });
        const kid = schluesselKennung(ENV_WECHSEL);

        const bericht = await pruefeSchluessel(knex, ENV_WECHSEL);
        assert.equal(bericht.nachKid[kid.alt], 2);
        assert.equal(bericht.nachKid[kid.aktuell], 1);
        assert.equal(bericht.nichtEntschluesselbar, 1);
        assert.ok(!JSON.stringify(bericht).includes(IBAN));

        // alter Schlüssel fehlt, aber alte Kennungen existieren: Abbruch, nichts geändert
        await assert.rejects(() => schluesseleUm(knex, { ZAHLUNGSDATEN_SCHLUESSEL: NEU }), /ZAHLUNGSDATEN_SCHLUESSEL_ALT/);
        const vorher = await knex('vereins_abrechnung').where({ verein_id: v }).first('iban_verschluesselt');
        assert.equal(vorher.iban_verschluesselt.split(':')[1], kid.alt);

        // eine nicht lesbare Zeile bricht ab; ALLES bleibt unverändert (eine Transaktion)
        await assert.rejects(() => schluesseleUm(knex, ENV_WECHSEL));
        assert.equal((await knex('vereins_abrechnung').where({ verein_id: v }).first('iban_verschluesselt')).iban_verschluesselt, vorher.iban_verschluesselt);
        assert.ok(entschluesseleFeld((await knex('lastschrift_mandate').where({ id: m1 }).first()).daten_verschluesselt, ENV_ALT).includes(IBAN));

        await knex('lastschrift_mandate').where({ mandatsreferenz: 'REF4' }).del();
        const r = await schluesseleUm(knex, ENV_WECHSEL);
        assert.deepEqual(r, { vereinsKonten: 1, mandate: 1 });
        const nur = { ZAHLUNGSDATEN_SCHLUESSEL: NEU };
        assert.equal(entschluesseleFeld((await knex('vereins_abrechnung').where({ verein_id: v }).first()).iban_verschluesselt, nur), IBAN);
        assert.equal(JSON.parse(entschluesseleFeld((await knex('lastschrift_mandate').where({ id: m1 }).first()).daten_verschluesselt, nur)).iban, IBAN);
        assert.equal((await knex('lastschrift_mandate').where({ id: m2 }).first()).daten_verschluesselt.split(':')[1], kid.aktuell);
        // idempotent
        assert.deepEqual(await schluesseleUm(knex, ENV_WECHSEL), { vereinsKonten: 0, mandate: 0 });
        // ohne alte Kennungen im Bestand genügt der aktuelle Schlüssel
        assert.deepEqual(await schluesseleUm(knex, nur), { vereinsKonten: 0, mandate: 0 });
    } finally { await stoppe(); }
});

test('Aufbewahrung: abgelaufene Mandate werden gelöscht, Rechnungen und fremde Tokens bleiben', async () => {
    const { knex, stoppe } = await starteTestPostgres();
    try {
        const v = id((await knex('vereine').insert({ name: 'JC Aus' }).returning('id'))[0]);
        await knex('benutzer').insert({ id: 'u1', email: 'u1@test.de', vorname: 'U', nachname: 'T', email_bestaetigt_am: knex.fn.now() });
        const alt = await mandatZeile(knex, 1, { status: 'widerrufen', loeschen_ab: tag(-1) });
        const heute = await mandatZeile(knex, 2, { status: 'widerrufen', loeschen_ab: tag(0) });
        const offen = await mandatZeile(knex, 3, { loeschen_ab: null });
        const rechnung = id((await knex('rechnungen').insert({
            aussteller_verein_id: v, verein_name: 'JC A', zahlweg: 'lastschrift', art: 'rechnung', nummer: 'R1', rechnungsdatum: tag(-30),
            anzahl: 1, einzelpreis_cent: 800, betrag_cent: 800, positionen: '[]', empfaenger: '{}', aussteller: '{}',
            mandat_id: alt, mandatsreferenz: 'REF1', iban_maske_zahler: 'DE89 **** 3000'
        }).returning('id'))[0]);
        await erzeugeToken(knex, { benutzerId: 'u1', zweck: 'mandat', bezug: alt });
        await erzeugeToken(knex, { benutzerId: 'u1', zweck: 'mandat', bezug: heute });
        await erzeugeToken(knex, { benutzerId: 'u1', zweck: 'email', bezug: alt }); // anderer Zweck: bleibt

        assert.equal(await loescheAbgelaufeneMandate(knex, tag(0)), 1);
        assert.deepEqual(await knex('lastschrift_mandate').orderBy('id').pluck('id'), [heute, offen]);
        const r = await knex('rechnungen').where({ id: rechnung }).first();
        assert.equal(r.mandat_id, null);
        assert.equal(r.mandatsreferenz, 'REF1');
        assert.equal(r.iban_maske_zahler, 'DE89 **** 3000');
        const tokens = await knex('token_einmal').select('zweck', 'bezug').orderBy('id');
        assert.deepEqual(tokens, [{ zweck: 'mandat', bezug: String(heute) }, { zweck: 'email', bezug: String(alt) }]);
        assert.equal(await loescheAbgelaufeneMandate(knex, tag(0)), 0);
    } finally { await stoppe(); }
});
