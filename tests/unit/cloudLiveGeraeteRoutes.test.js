import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeVerwalter } from '../../src/cloudLive/verwalter.js';
import { getCloudLiveGeraeteRoutes } from '../../src/cloudLive/geraeteRoutes.js';

let pg, knex, verzeichnis, verwalter, server, basis;
let A, B, zugangA, zugangB;
const id = (r) => (typeof r === 'object' ? r.id : r);

async function baueTurnier(name) {
    const turnierId = id((await knex('turniere').insert({ bezeichnung: name, ort: 'Ort', datum: '2099-03-01', ausrichter: 'X', status: 'veroeffentlicht' }).returning('id'))[0]);
    const matteId = id((await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id'))[0]);
    return { turnierId, matteId };
}

const sende = (pfad, { methode = 'GET', body, secret, ip = '10.0.0.1' } = {}) => fetch(`${basis}${pfad}`, {
    method: methode,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
        'X-Forwarded-For': ip,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(secret ? { 'x-hajime-sync-secret': secret } : {})
    }
});
const koppeln = (zugang, code, ip, vorspann = '') => sende(`${vorspann}/turnierlive/${zugang.schluessel}/api/client/koppeln`, { methode: 'POST', body: { code, clientId: 'test' }, ip });

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-geraete-'));
    verwalter = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis } });
    A = await baueTurnier('A');
    B = await baueTurnier('B');
    zugangA = await verwalter.starte(A.turnierId);
    zugangB = await verwalter.starte(B.turnierId);
    const app = express();
    app.set('trust proxy', true);
    app.use('/turnierlive/:schluessel', getCloudLiveGeraeteRoutes({ knex, verwalter, schluesselVersuche: 100 }));
    // Zweiter Mountpunkt mit enger Schlüssel-Grenze (4), um sie getrennt von der IP-Grenze (5) zu prüfen
    app.use('/streng/turnierlive/:schluessel', getCloudLiveGeraeteRoutes({ knex, verwalter, schluesselVersuche: 4 }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    basis = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await verwalter.schliesseAlle();
    await pg.stoppe();
    try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows hält LevelDB-Dateien kurz fest */ }
});

test('Status: Instanz des Schlüssels, unbekannter Schlüssel 404', async () => {
    const antwort = await sende(`/turnierlive/${zugangA.schluessel}/api/sync/status`);
    assert.equal(antwort.status, 200);
    const status = await antwort.json();
    assert.equal(status.instanz_id, zugangA.instanzId);
    assert.equal(status.turnier_id, A.turnierId);
    assert.equal(status.db_name, `turnier_${zugangA.instanzId}`);
    assert.equal(status.modus, 'master');
    assert.equal((await sende('/turnierlive/gibt-es-nicht/api/sync/status')).status, 404);
});

test('Koppeln: richtiger Code liefert das Geheimnis, falscher 401', async () => {
    const ok = await koppeln(zugangA, zugangA.code, '10.1.0.1');
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).secret, zugangA.geheimnis);
    const falsch = zugangA.code === '000000' ? '000001' : '000000';
    assert.equal((await koppeln(zugangA, falsch, '10.1.0.2')).status, 401);
});

test('Koppeln: der Code eines anderen Turniers gilt nicht unter diesem Schlüssel', async () => {
    if (zugangA.code === zugangB.code) return; // 1 zu 10^6, dann ist der Fall nicht prüfbar
    assert.equal((await koppeln(zugangA, zugangB.code, '10.1.0.3')).status, 401);
});

test('Koppeln: nach 5 Fehlversuchen von einer IP antwortet 429, auch mit dem richtigen Code', async () => {
    const falsch = zugangB.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) assert.equal((await koppeln(zugangB, falsch, '10.2.0.9')).status, 401);
    const gesperrt = await koppeln(zugangB, zugangB.code, '10.2.0.9');
    assert.equal(gesperrt.status, 429);
    assert.ok((await gesperrt.json()).restSekunden > 0);
});

test('Koppeln: Fehlversuche aus verschiedenen IPs sperren den Schlüssel (429)', async () => {
    const C = await baueTurnier('C');
    const zugangC = await verwalter.starte(C.turnierId);
    const falsch = zugangC.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 4; i++) assert.equal((await koppeln(zugangC, falsch, `10.3.0.${i + 1}`, '/streng')).status, 401);
    assert.equal((await koppeln(zugangC, zugangC.code, '10.3.0.99', '/streng')).status, 429);
});

test('/db: ohne Geheimnis 401, mit falschem 401, mit richtigem 200', async () => {
    const dbName = `turnier_${zugangA.instanzId}`;
    assert.equal((await sende(`/turnierlive/${zugangA.schluessel}/db/${dbName}`)).status, 401);
    assert.equal((await sende(`/turnierlive/${zugangA.schluessel}/db/${dbName}`, { secret: zugangB.geheimnis })).status, 401);
    const ok = await sende(`/turnierlive/${zugangA.schluessel}/db/${dbName}`, { secret: zugangA.geheimnis });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).db_name, dbName);
});

test('/db: nur die Datenbank des eigenen Turniers, keine globalen Endpunkte, kein Löschen', async () => {
    const wurzel = `/turnierlive/${zugangA.schluessel}/db`;
    const s = zugangA.geheimnis;
    assert.equal((await sende(`${wurzel}/turnier_${zugangB.instanzId}`, { secret: s })).status, 404);
    assert.equal((await sende(`${wurzel}/turnier_${zugangB.instanzId}/_all_docs`, { secret: s })).status, 404);
    for (const global of ['_all_dbs', '_users', '_session', '_utils', '_active_tasks']) {
        assert.equal((await sende(`${wurzel}/${global}`, { secret: s })).status, 404, global);
    }
    assert.equal((await sende(`${wurzel}/_replicate`, { methode: 'POST', body: { source: 'x', target: 'y' }, secret: s })).status, 404);
    const eigene = `${wurzel}/turnier_${zugangA.instanzId}`;
    assert.equal((await sende(eigene, { methode: 'DELETE', secret: s })).status, 403);
    assert.equal((await sende(`${eigene}/_security`, { methode: 'PUT', body: {}, secret: s })).status, 403);
    assert.equal((await sende(`${eigene}/_compact`, { methode: 'POST', body: {}, secret: s })).status, 403);
    // Replikation braucht diese Endpunkte
    assert.equal((await sende(`${eigene}/_changes?limit=1`, { secret: s })).status, 200);
    assert.equal((await sende(`${eigene}/_all_docs?limit=1`, { secret: s })).status, 200);
    // Die Dokument-DB eines anderen Turniers bleibt auch mit dem eigenen Geheimnis unerreichbar, wenn der Schlüssel fremd ist
    assert.equal((await sende(`/turnierlive/${zugangB.schluessel}/db/turnier_${zugangB.instanzId}`, { secret: s })).status, 401);
});

test('Replikation eines Geräts landet nur in der Dokument-DB seines Turniers', async () => {
    const PouchDB = verwalter.dokumentDb.PouchDB;
    const lokal = new PouchDB(`lokal-geraet-${Date.now()}`);
    await lokal.put({ _id: 'client:testgeraet', dokumenttyp: 'client', bearbeitet_von: 'client-heartbeat' });
    const remote = new PouchDB(`${basis}/turnierlive/${zugangA.schluessel}/db/turnier_${zugangA.instanzId}`, {
        skip_setup: true,
        fetch: (url, optionen = {}) => {
            optionen.headers = optionen.headers || new Headers();
            optionen.headers.set('x-hajime-sync-secret', zugangA.geheimnis);
            optionen.headers.set('X-Forwarded-For', '10.9.0.1');
            return PouchDB.fetch(url, optionen);
        }
    });
    const ergebnis = await lokal.replicate.to(remote);
    assert.equal(ergebnis.ok, true);
    assert.ok(await verwalter.instanz(zugangA.schluessel).db.get('client:testgeraet'));
    assert.equal(await verwalter.instanz(zugangB.schluessel).db.get('client:testgeraet').catch(() => null), null);
    // und zurück: das Gerät bekommt die Matte seines Turniers
    await lokal.replicate.from(remote);
    assert.ok(await lokal.get(`kampfflaeche:${A.matteId}`));
    assert.equal(await lokal.get(`kampfflaeche:${B.matteId}`).catch(() => null), null);
    await lokal.destroy();
});

test('Wird der Live-Betrieb während der Prüfung beendet, erreicht die Anfrage die Dokument-DB nicht mehr', async () => {
    const D = await baueTurnier('Rennen');
    const zugangD = await verwalter.starte(D.turnierId);
    const instanz = verwalter.instanz(zugangD.schluessel);
    // Simulation: die Instanz ist beim ersten Nachschlagen noch da, nach der Geheimnisprüfung (await) schon beendet.
    let nachschlagen = 0;
    let weitergereicht = false;
    const stub = Object.create(verwalter);
    stub.instanz = () => (nachschlagen++ === 0 ? instanz : null);
    stub.dokumentMiddleware = (req, res) => { weitergereicht = true; res.status(200).end(); };
    const app = express();
    app.use('/turnierlive/:schluessel', getCloudLiveGeraeteRoutes({ knex, verwalter: stub }));
    const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    try {
        const antwort = await fetch(`http://127.0.0.1:${srv.address().port}/turnierlive/${zugangD.schluessel}/db/turnier_${zugangD.instanzId}/_changes`, { headers: { 'x-hajime-sync-secret': zugangD.geheimnis } });
        assert.ok([404, 410].includes(antwort.status), `Status ${antwort.status}`);
        assert.equal(weitergereicht, false);
    } finally {
        await new Promise((resolve) => srv.close(resolve));
    }
});
