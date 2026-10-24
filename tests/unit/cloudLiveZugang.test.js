import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import {
    starteZugang, ladeZugang, ladeZugangPerSchluessel, pruefeCode, pruefeGeheimnis,
    erneuereZugang, setzeGesperrt, beendeZugang, MAX_FEHLVERSUCHE
} from '../../src/cloudLive/zugang.js';

let pg, knex, turnierA, turnierB;

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    const zeile = (r) => (typeof r === 'object' ? r.id : r);
    const ids = [];
    for (const [n, d] of [['Turnier A', '2099-03-01'], ['Turnier B', '2099-03-01']]) {
        ids.push(zeile((await knex('turniere').insert({ bezeichnung: n, ort: 'Ort', datum: d, ausrichter: 'X', status: 'veroeffentlicht' }).returning('id'))[0]));
    }
    [turnierA, turnierB] = ids;
});
after(async () => { await pg.stoppe(); });

test('starteZugang: sechsstelliger Code, 22-stelliger Schlüssel, idempotent', async () => {
    const z = await starteZugang(knex, turnierA);
    assert.match(z.code, /^\d{6}$/);
    assert.match(z.schluessel, /^[A-Za-z0-9_-]{22}$/);
    assert.match(z.geheimnis, /^[0-9a-f]{64}$/);
    assert.ok(z.instanzId);
    const nochmal = await starteZugang(knex, turnierA);
    assert.equal(nochmal.schluessel, z.schluessel);
    assert.equal(nochmal.code, z.code);
    assert.equal((await ladeZugang(knex, turnierA)).schluessel, z.schluessel);
    assert.equal((await ladeZugangPerSchluessel(knex, z.schluessel)).turnierId, turnierA);
    assert.equal(await ladeZugangPerSchluessel(knex, 'gibt-es-nicht'), null);
});

test('pruefeCode: richtiger Code liefert das Geheimnis, falscher oder fremder Code nicht', async () => {
    const a = await starteZugang(knex, turnierA);
    const b = await starteZugang(knex, turnierB);
    const ok = await pruefeCode(knex, a.schluessel, a.code);
    assert.deepEqual(ok, { ok: true, geheimnis: a.geheimnis });
    const falsch = a.code === '000000' ? '000001' : '000000';
    assert.deepEqual(await pruefeCode(knex, a.schluessel, falsch), { ok: false, grund: 'ungueltig' });
    // Der Code von Turnier B gilt nicht unter dem Schlüssel von Turnier A
    if (a.code !== b.code) assert.deepEqual(await pruefeCode(knex, a.schluessel, b.code), { ok: false, grund: 'ungueltig' });
    // Leerzeichen/Trennzeichen im Code werden toleriert (Eingabe "123 456")
    const mitLeerzeichen = `${a.code.slice(0, 3)} ${a.code.slice(3)}`;
    assert.equal((await pruefeCode(knex, a.schluessel, mitLeerzeichen)).ok, true);
});

test('pruefeGeheimnis: nur das Geheimnis des eigenen Turniers', async () => {
    const a = await starteZugang(knex, turnierA);
    const b = await starteZugang(knex, turnierB);
    assert.equal((await pruefeGeheimnis(knex, a.schluessel, a.geheimnis)).ok, true);
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, b.geheimnis), { ok: false, grund: 'ungueltig' });
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, undefined), { ok: false, grund: 'ungueltig' });
    assert.deepEqual(await pruefeGeheimnis(knex, 'unbekannt', a.geheimnis), { ok: false, grund: 'ungueltig' });
});

test('Sperre, Ablauf, Erneuern, Beenden', async () => {
    const a = await starteZugang(knex, turnierA);
    await setzeGesperrt(knex, turnierA, true);
    assert.deepEqual(await pruefeCode(knex, a.schluessel, a.code), { ok: false, grund: 'gesperrt' });
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, a.geheimnis), { ok: false, grund: 'gesperrt' });
    await setzeGesperrt(knex, turnierA, false);
    assert.equal((await pruefeCode(knex, a.schluessel, a.code)).ok, true);

    // Ende des Turniertags (Turnier am 2099-03-01 -> Ablauf 2099-03-02 06:00 Berliner Zeit)
    const nachAblauf = () => new Date('2099-03-02T06:00:00.000Z');
    assert.deepEqual(await pruefeCode(knex, a.schluessel, a.code, { jetzt: nachAblauf }), { ok: false, grund: 'abgelaufen' });
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, a.geheimnis, { jetzt: nachAblauf }), { ok: false, grund: 'abgelaufen' });

    const neu = await erneuereZugang(knex, turnierA);
    assert.notEqual(neu.geheimnis, a.geheimnis);
    assert.equal(neu.schluessel, a.schluessel);
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, a.geheimnis), { ok: false, grund: 'ungueltig' });
    assert.equal((await pruefeGeheimnis(knex, a.schluessel, neu.geheimnis)).ok, true);

    await beendeZugang(knex, turnierA);
    assert.deepEqual(await pruefeCode(knex, a.schluessel, neu.code), { ok: false, grund: 'ungueltig' });
    assert.deepEqual(await pruefeGeheimnis(knex, a.schluessel, neu.geheimnis), { ok: false, grund: 'ungueltig' });
    assert.equal((await ladeZugang(knex, turnierA)).beendetAm instanceof Date, true);
    // Nach dem Beenden startet ein neuer Live-Betrieb mit neuer Instanz, neuem Schlüssel und Code
    const wieder = await starteZugang(knex, turnierA);
    assert.notEqual(wieder.instanzId, a.instanzId);
    assert.equal(wieder.beendetAm, null);
    assert.equal((await pruefeCode(knex, wieder.schluessel, wieder.code)).ok, true);
});

test('Fehlversuche: nach 10 falschen Codes ist der Zugang gesperrt, auch der richtige Code hilft dann nicht', async () => {
    const z = await starteZugang(knex, turnierB);
    const falsch = z.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < MAX_FEHLVERSUCHE - 1; i++) {
        assert.deepEqual(await pruefeCode(knex, z.schluessel, falsch), { ok: false, grund: 'ungueltig' });
    }
    // Ein richtiger Code setzt den Zähler zurück
    assert.equal((await pruefeCode(knex, z.schluessel, z.code)).ok, true);
    for (let i = 0; i < MAX_FEHLVERSUCHE; i++) await pruefeCode(knex, z.schluessel, falsch);
    assert.equal((await ladeZugang(knex, turnierB)).gesperrt, true);
    assert.deepEqual(await pruefeCode(knex, z.schluessel, z.code), { ok: false, grund: 'gesperrt' });
    // Heben der Sperre durch den Admin setzt den Zähler zurück
    await setzeGesperrt(knex, turnierB, false);
    assert.equal((await pruefeCode(knex, z.schluessel, z.code)).ok, true);
});

test('Gesperrt oder abgelaufen antwortet unabhängig vom Code gleich (kein Raten über diese Antwort)', async () => {
    const z = await starteZugang(knex, turnierB);
    const falsch = z.code === '000000' ? '000001' : '000000';
    await setzeGesperrt(knex, turnierB, true);
    assert.deepEqual(await pruefeCode(knex, z.schluessel, falsch), { ok: false, grund: 'gesperrt' });
    assert.deepEqual(await pruefeCode(knex, z.schluessel, z.code), { ok: false, grund: 'gesperrt' });
    await setzeGesperrt(knex, turnierB, false);
    const nachAblauf = () => new Date('2099-03-02T06:00:00.000Z');
    assert.deepEqual(await pruefeCode(knex, z.schluessel, falsch, { jetzt: nachAblauf }), { ok: false, grund: 'abgelaufen' });
    assert.deepEqual(await pruefeCode(knex, z.schluessel, z.code, { jetzt: nachAblauf }), { ok: false, grund: 'abgelaufen' });
});
