import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { meldeAn, meldeAb, pruefeUndSende, loescheAbgelaufeneAbos } from '../../src/liveCloud/push.js';
import { liesPushKonfig } from '../../src/liveCloud/pushKonfig.js';

const konfig = liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'p', LIVE_PUSH_VAPID_PRIVATE: 'q', LIVE_PUSH_BETREFF: 'mailto:a@b.de' });
const ENDPUNKT = 'https://fcm.googleapis.com/fcm/send/geraet-1';
const abo = (endpoint = ENDPUNKT) => ({ endpoint, keys: { p256dh: 'pk', auth: 'ak' } });
const glocken = (extra = {}) => ({ teilnehmer: [], vereine: [], ausnahmen: [], ...extra });
const t = (key, vorname, extra = {}) => ({
    key, vorname, nachname: 'Test', vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'Pool 10', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'wartet_auf_gegner', abstand: null,
    naechsterKampfId: null, platz: null, ...extra
});
let sequenz = 1000;
const paket = (teilnehmer, kaempfe, pools, extra = {}) => ({
    version: 1, turnierKey: 'P', name: 'Push-Turnier', datum: '2026-10-13', stand: '2026-10-13T10:00:00.000Z', sequenz: sequenz++,
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Test' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer, warteschlangen: [], pools, kaempfe, ...extra
});
const pool = (id, extra = {}) => ({ id, bezeichnung: `Pool ${id}`, modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', ...extra });
const kampf = (id, poolId, extra = {}) => ({ id, poolId, nr: `R${id}`, status: 'bereit', reihenfolge: id, k1: null, k2: null, sieger: null, p1: 0, p2: 0, ...extra });

let db;
const jetzt = () => new Date('2026-10-13T12:00:00Z');
const gesendet = [];
const sender = async (aboDaten, nachricht) => { gesendet.push({ endpoint: aboDaten.endpoint, ...nachricht }); };
const stumm = { warn() {}, log() {} };

before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });
beforeEach(async () => {
    gesendet.length = 0;
    await db.knex('live_turniere').del();
});

// Warteschlange der Matte 1: Kämpfe 1..6. Pool 10 hat 1 und 2 (Anna, Bea), Pool 11 hat 3..6 (Clara, Dora).
async function aufbau(zustaende = {}) {
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1, ...zustaende.a }),
        t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 2, ...zustaende.b }),
        t('c', 'Clara', { poolId: 11, poolBezeichnung: 'Pool 11', zustand: 'in_n', abstand: 5, naechsterKampfId: 5, ...zustaende.c }),
        t('d', 'Dora', { poolId: 11, poolBezeichnung: 'Pool 11', zustand: 'in_n', abstand: 4, naechsterKampfId: 4, vereinKey: 'v2', verein: 'TV Test', ...zustaende.d })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6].map(id => kampf(id, id <= 2 ? 10 : 11));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
}

test('Anmeldung: leere Glockenliste löscht, ungültiger Endpunkt wird abgelehnt', async () => {
    await aufbau();
    await assert.rejects(meldeAn(db.knex, 'P', { abo: abo('https://evil.example/x'), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { code: 'UNGUELTIG' });
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { status: 'ok' });
    assert.equal((await db.knex('live_push_abos')).length, 1);
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken() }, { konfig, jetzt }), { status: 'geloescht' });
    assert.equal((await db.knex('live_push_abos')).length, 0);
    assert.deepEqual(await meldeAn(db.knex, 'gibtsnicht', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt }), { status: 'unbekannt' });
});

test('Anmeldung: bereits erfüllte Bedingungen lösen nichts aus, neue schon, einmal', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a', 'b'] }) }, { konfig, jetzt });
    assert.deepEqual(await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt }), { gesendet: 0 });
    // Anna bekommt einen neuen Kampf 7 in Pool 10 an Position 2: neuer Bezug, also eine Nachricht.
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'in_n', abstand: 2, naechsterKampfId: 7 }), t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 2 }),
        t('c', 'Clara', { poolId: 11, zustand: 'in_n', abstand: 5, naechsterKampfId: 5 }), t('d', 'Dora', { poolId: 11, zustand: 'in_n', abstand: 4, naechsterKampfId: 4 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6, 7].map(id => kampf(id, id <= 2 || id === 7 ? 10 : 11, id === 1 ? { status: 'beendet' } : {}));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    const r = await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.equal(r.gesendet, 1);
    assert.equal(gesendet[0].text, 'Anna Test: Kampf in 2 Kämpfen (Matte 1)');
    assert.deepEqual(await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt }), { gesendet: 0 });
});

test('Kampf rückt in die Schwelle: eine Nachricht', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['c'] }) }, { konfig, jetzt });
    assert.equal((await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt })).gesendet, 0);
    // Kämpfe 1 und 2 (Pool 10) sind beendet: Pool 11 ist an der Spitze, Claras Kampf 5 an Position 2.
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'keine_weiteren' }), t('b', 'Bea', { zustand: 'keine_weiteren' }),
        t('c', 'Clara', { poolId: 11, poolBezeichnung: 'Pool 11', zustand: 'in_n', abstand: 2, naechsterKampfId: 5 }),
        t('d', 'Dora', { poolId: 11, zustand: 'in_n', abstand: 1, naechsterKampfId: 4 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6].map(id => kampf(id, id <= 2 ? 10 : 11, id <= 2 ? { status: 'beendet' } : {}));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    const r = await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.equal(r.gesendet, 1);
    assert.equal(gesendet[0].text, 'Clara Test: Kampf in 2 Kämpfen (Matte 1)');
});

test('Glocke für alle: später gemeldete Vereinsmitglieder zählen, Ausnahmen nicht', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ vereine: ['v1'], ausnahmen: ['b'] }) }, { konfig, jetzt });
    const teilnehmer = [
        t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1 }), t('b', 'Bea', { zustand: 'in_n', abstand: 1, naechsterKampfId: 8 }),
        t('c', 'Clara', { poolId: 11, zustand: 'in_n', abstand: 5, naechsterKampfId: 5 }),
        t('e', 'Eva', { zustand: 'in_n', abstand: 1, naechsterKampfId: 9 })
    ];
    const kaempfe = [1, 2, 3, 4, 5, 6, 8, 9].map(id => kampf(id, id <= 2 || id >= 8 ? 10 : 11));
    await uebernimmPaket(db.knex, paket(teilnehmer, kaempfe, [pool(10), pool(11)]));
    await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.deepEqual(gesendet.map(g => g.text.split(':')[0]).sort(), ['Eva Test']);
});

test('Pool-Start: der Pool beginnt in höchstens 3 Kämpfen, bei 4 noch nicht', async () => {
    // Pool 12 steht hinter den vier Kämpfen von Pool 10 (Position 4): keine Nachricht.
    const t1 = [t('x', 'Xenia', { poolId: 12, poolBezeichnung: 'Pool 12', zustand: 'in_n', abstand: 9, naechsterKampfId: 15 })];
    const k1 = [1, 2, 3, 4].map(id => kampf(id, 10)).concat([kampf(15, 12)]);
    await uebernimmPaket(db.knex, paket(t1, k1, [pool(10), pool(12)]));
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['x'] }) }, { konfig, jetzt });
    assert.equal((await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt })).gesendet, 0);
    // Kampf 1 beendet: Pool 12 rückt auf Position 3 vor, Xenias Kampf ist dort der erste des Pools. Pool-Start und Kampf zusammen.
    const k2 = [kampf(1, 10, { status: 'beendet' }), kampf(2, 10), kampf(3, 10), kampf(4, 10), kampf(15, 12)];
    await uebernimmPaket(db.knex, paket([t('x', 'Xenia', { poolId: 12, poolBezeichnung: 'Pool 12', zustand: 'in_n', abstand: 3, naechsterKampfId: 15 })], k2, [pool(10), pool(12)]));
    const r = await pruefeUndSende(db.knex, 'P', { sender, konfig, jetzt });
    assert.equal(r.gesendet, 1);
    assert.equal(gesendet[0].text, 'Xenia Test: Pool Pool 12 startet in 3 Kämpfen, Kampf in 3 Kämpfen (Matte 1)');
});

test('Push-Dienst meldet 410: Anmeldung wird gelöscht', async () => {
    await aufbau({ a: { zustand: 'in_n', abstand: 9, naechsterKampfId: 1 } });
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    await uebernimmPaket(db.knex, paket([t('a', 'Anna', { zustand: 'als_naechstes', naechsterKampfId: 1 })], [kampf(1, 10)], [pool(10)]));
    const weg = async () => { throw Object.assign(new Error('weg'), { statusCode: 410 }); };
    await pruefeUndSende(db.knex, 'P', { sender: weg, konfig, jetzt, log: stumm });
    assert.equal((await db.knex('live_push_abos')).length, 0);
});

test('Abmelden, Ablauf nach 3 Tagen und Rücknahme des Turniers räumen auf', async () => {
    await aufbau();
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    assert.equal(await meldeAb(db.knex, 'P', ENDPUNKT), true);
    assert.equal(await meldeAb(db.knex, 'P', ENDPUNKT), false);
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    assert.equal(await loescheAbgelaufeneAbos(db.knex, { jetzt: () => new Date('2026-10-16T11:59:00Z') }), 0);
    assert.equal(await loescheAbgelaufeneAbos(db.knex, { jetzt: () => new Date('2026-10-16T12:01:00Z') }), 1);
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig, jetzt });
    await uebernimmPaket(db.knex, { version: 1, turnierKey: 'P', zurueckgezogen: true, stand: '2026-10-13T13:00:00.000Z', sequenz: sequenz++ });
    assert.equal((await db.knex('live_push_abos')).length, 0);
});

test('Begrenzung: höchstens maxAbos Anmeldungen je Turnier', async () => {
    await aufbau();
    const klein = { ...konfig, maxAbos: 1 };
    await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig: klein, jetzt });
    await assert.rejects(meldeAn(db.knex, 'P', { abo: abo('https://fcm.googleapis.com/fcm/send/geraet-2'), glocken: glocken({ teilnehmer: ['a'] }) }, { konfig: klein, jetzt }), { code: 'ZU_VIELE' });
    assert.deepEqual(await meldeAn(db.knex, 'P', { abo: abo(), glocken: glocken({ teilnehmer: ['a', 'b'] }) }, { konfig: klein, jetzt }), { status: 'ok' });
});
