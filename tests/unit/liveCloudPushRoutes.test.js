import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { getLiveRoutes } from '../../src/routes/liveRoutes.js';
import { erzeugeToken } from '../../src/liveCloud/token.js';
import { erzeugeRatenbegrenzung } from '../../src/liveCloud/ratenbegrenzung.js';
import { liesPushKonfig } from '../../src/liveCloud/pushKonfig.js';

const konfig = liesPushKonfig({ LIVE_PUSH_VAPID_PUBLIC: 'oeffentlich', LIVE_PUSH_VAPID_PRIVATE: 'privat', LIVE_PUSH_BETREFF: 'mailto:a@b.de' });
const ENDPUNKT = 'https://fcm.googleapis.com/fcm/send/geraet-1';
const t = (key, vorname, extra = {}) => ({
    key, vorname, nachname: 'Test', vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'Pool 10', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 9, naechsterKampfId: 1, platz: null, ...extra
});
let sequenz = 5000;
const paket = (teilnehmer, extra = {}) => ({
    version: 1, turnierKey: 'R', name: 'Routen-Turnier', datum: '2026-10-13', stand: '2026-10-13T10:00:00.000Z', sequenz: sequenz++,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }], teilnehmer, warteschlangen: [],
    pools: [{ id: 10, bezeichnung: 'Pool 10', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' }],
    kaempfe: [{ id: 1, poolId: 10, nr: 'R1', status: 'bereit', reihenfolge: 1, k1: null, k2: null, sieger: null, p1: 0, p2: 0 }], ...extra
});

let db, server, basis, token;
const gesendet = [];
let senderFehler = false;
const sender = async (abo, nachricht) => {
    if (senderFehler) throw new Error('Push-Dienst kaputt');
    gesendet.push({ endpoint: abo.endpoint, ...nachricht });
};
const sende = (pfad, { methode = 'GET', body, header = {} } = {}) => fetch(`${basis}${pfad}`, {
    method: methode, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...header }
});
const ingest = (p) => sende('/ingest', { methode: 'POST', body: p, header: { Authorization: `Bearer ${token}` } });
const anmeldung = (extra = {}) => ({ abo: { endpoint: ENDPUNKT, keys: { p256dh: 'pk', auth: 'ak' } }, glocken: { teilnehmer: ['a'], vereine: [], ausnahmen: [] }, ...extra });

async function starte(pushOptionen) {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/live', getLiveRoutes(db.knex, {
        begrenzung: erzeugeRatenbegrenzung({ max: 200 }), fehlerBegrenzung: erzeugeRatenbegrenzung({ max: 30 }),
        jetzt: () => new Date('2026-10-13T12:00:00Z'), env: {}, push: pushOptionen
    }));
    const s = http.createServer(app);
    await new Promise(r => s.listen(0, '127.0.0.1', r));
    return s;
}

before(async () => {
    db = await starteTestPostgres();
    ({ token } = await erzeugeToken(db.knex, { name: 'test' }));
    server = await starte({ konfig, sender });
    basis = `http://127.0.0.1:${server.address().port}/api/live`;
});
after(async () => {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.stoppe();
});

test('Push ohne Konfiguration: Schlüssel und Anmeldung liefern 503', async () => {
    const aus = await starte({ konfig: liesPushKonfig({}), sender: null });
    const b = `http://127.0.0.1:${aus.address().port}/api/live`;
    try {
        assert.equal((await fetch(`${b}/push/schluessel`)).status, 503);
        assert.equal((await fetch(`${b}/turniere/R/push`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(anmeldung()) })).status, 503);
    } finally {
        await new Promise(r => aus.close(r));
    }
});

test('Push-Routen: Schlüssel, Anmelden, Fehlerfälle, Abmelden', async () => {
    const schluessel = await sende('/push/schluessel');
    assert.equal(schluessel.status, 200);
    assert.deepEqual(await schluessel.json(), { schluessel: 'oeffentlich' });

    assert.equal((await ingest(paket([t('a', 'Anna')]))).status, 204);
    assert.equal((await sende('/turniere/gibtsnicht/push', { methode: 'PUT', body: anmeldung() })).status, 404);
    assert.equal((await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung({ abo: { endpoint: 'https://evil.example/x', keys: { p256dh: 'p', auth: 'a' } } }) })).status, 400);
    assert.equal((await sende('/turniere/R/push', { methode: 'PUT', body: {} })).status, 400);
    assert.equal((await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung() })).status, 204);
    assert.equal((await db.knex('live_push_abos')).length, 1);
    assert.equal((await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung({ glocken: { teilnehmer: [], vereine: [], ausnahmen: [] } }) })).status, 204);
    assert.equal((await db.knex('live_push_abos')).length, 0);
    await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung() });
    assert.equal((await sende('/turniere/R/push', { methode: 'DELETE', body: { endpoint: ENDPUNKT } })).status, 204);
    assert.equal((await db.knex('live_push_abos')).length, 0);
});

test('Ingest löst Push aus; ein Fehler des Push-Dienstes lässt den Ingest bei 204', async () => {
    gesendet.length = 0;
    await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung() });
    // Anna rückt in die Schwelle: Kampf 1 ist als Nächstes (abstand 0 → als_naechstes).
    const r = await ingest(paket([t('a', 'Anna', { zustand: 'als_naechstes', abstand: null })]));
    assert.equal(r.status, 204);
    for (let i = 0; i < 40 && !gesendet.length; i++) await new Promise(res => setTimeout(res, 50));
    assert.equal(gesendet.length, 1);
    assert.equal(gesendet[0].text, 'Anna Test: Kampf als Nächstes (Matte 1)');

    senderFehler = true;
    await sende('/turniere/R/push', { methode: 'PUT', body: anmeldung({ glocken: { teilnehmer: ['b'], vereine: [], ausnahmen: [] } }) });
    const r2 = await ingest(paket([t('a', 'Anna', { zustand: 'als_naechstes', abstand: null }), t('b', 'Bea', { zustand: 'in_n', abstand: 2, naechsterKampfId: 2 })],
        { kaempfe: [{ id: 1, poolId: 10, nr: 'R1', status: 'bereit', reihenfolge: 1, k1: null, k2: null, sieger: null, p1: 0, p2: 0 }, { id: 2, poolId: 10, nr: 'R2', status: 'bereit', reihenfolge: 2, k1: null, k2: null, sieger: null, p1: 0, p2: 0 }] }));
    assert.equal(r2.status, 204);
    senderFehler = false;
});
