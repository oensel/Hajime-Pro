import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeVerwalter } from '../../src/cloudLive/verwalter.js';
import { getCloudLiveGeraeteRoutes } from '../../src/cloudLive/geraeteRoutes.js';
import { ladeZugang } from '../../src/cloudLive/zugang.js';

let pg, knex, verzeichnis, verwalter, server, basis;
const id = (r) => (typeof r === 'object' ? r.id : r);

async function baueTurnier(name) {
    const turnierId = id((await knex('turniere').insert({ bezeichnung: name, ort: 'Ort', datum: '2099-03-01', ausrichter: 'X', status: 'veroeffentlicht' }).returning('id'))[0]);
    const matteId = id((await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id'))[0]);
    return { turnierId, matteId };
}
const heartbeat = (clientId, ausstehend, letzterKontakt = new Date().toISOString()) => ({
    _id: `client:${clientId}`, dokumenttyp: 'client', client_id: clientId, geraet: 'Notebook', matte_id: 1,
    letzter_kontakt: letzterKontakt, ausstehend, bearbeitet_von: 'client-heartbeat'
});

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-beenden-'));
    verwalter = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis } });
    const app = express();
    app.use('/turnierlive/:schluessel', getCloudLiveGeraeteRoutes({ knex, verwalter }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    basis = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await verwalter.schliesseAlle();
    await pg.stoppe();
    try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ }
});

test('Geräte mit ungesendeten Änderungen: ohne erzwingen 409 mit Zahl, veraltete Heartbeats zählen nicht', async () => {
    const T = await baueTurnier('Ausstehend');
    const z = await verwalter.starte(T.turnierId);
    const instanz = verwalter.instanz(z.schluessel);
    await instanz.db.put(heartbeat('geraet-1', 3));
    await instanz.db.put(heartbeat('geraet-2', 2));
    await instanz.db.put(heartbeat('geraet-alt', 9, new Date(Date.now() - 60 * 60 * 1000).toISOString()));
    await assert.rejects(verwalter.beende(T.turnierId), (e) => e.statusCode === 409 && e.daten.ausstehendeGeraete === 5);
    assert.ok(verwalter.instanz(z.schluessel), 'Instanz bleibt offen');
    assert.equal((await ladeZugang(knex, T.turnierId)).beendetAm, null);
    const ergebnis = await verwalter.beende(T.turnierId, { erzwingen: true });
    assert.equal(ergebnis.ausstehendeGeraete, 5);
    assert.equal(verwalter.instanz(z.schluessel), null);
    assert.ok((await ladeZugang(knex, T.turnierId)).beendetAm instanceof Date);
});

test('Beenden schreibt den letzten Stand der Geräte zurück und löscht die Dokument-DB', async () => {
    const T = await baueTurnier('Rueckschreiben');
    const z = await verwalter.starte(T.turnierId);
    const instanz = verwalter.instanz(z.schluessel);
    const dok = await instanz.db.get(`kampfflaeche:${T.matteId}`);
    await instanz.db.put({ ...dok, status: 'pausiert', bearbeitet_von: 'geraet-1' });
    await verwalter.beende(T.turnierId);
    assert.equal((await knex('kampfflaechen').where({ id: T.matteId }).first()).status, 'pausiert');
    // Die Dokument-DB ist zerstört: unter demselben Namen liegt danach nichts mehr
    const neu = new verwalter.dokumentDb.PouchDB(instanz.dbName);
    assert.equal((await neu.info()).doc_count, 0);
    await neu.destroy();
});

test('Nach dem Beenden antworten Status und /db mit 410, ein neuer Start bekommt neuen Schlüssel und neue Instanz', async () => {
    const T = await baueTurnier('Gone');
    const z = await verwalter.starte(T.turnierId);
    await verwalter.beende(T.turnierId);
    const status = await fetch(`${basis}/turnierlive/${z.schluessel}/api/sync/status`);
    assert.equal(status.status, 410);
    assert.equal((await status.json()).error, 'beendet');
    const replikation = await fetch(`${basis}/turnierlive/${z.schluessel}/db/turnier_${z.instanzId}/_changes`, { headers: { 'x-hajime-sync-secret': z.geheimnis } });
    assert.equal(replikation.status, 410);

    const wieder = await verwalter.starte(T.turnierId);
    assert.notEqual(wieder.schluessel, z.schluessel);
    assert.notEqual(wieder.instanzId, z.instanzId);
    // Ein Neustart ersetzt die Zeile des Turniers: der alte Schlüssel ist danach unbekannt (404), nicht mehr „beendet“.
    assert.equal((await fetch(`${basis}/turnierlive/${z.schluessel}/api/sync/status`)).status, 404);
    assert.equal((await fetch(`${basis}/turnierlive/${wieder.schluessel}/api/sync/status`)).status, 200);
});

test('Beenden eines nicht offenen Turniers (z. B. nach Neustart ohne Wiederaufnahme) beendet nur den Zugang', async () => {
    const T = await baueTurnier('Geschlossen');
    const andere = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis } });
    await verwalter.starte(T.turnierId);
    await verwalter._schliesse(T.turnierId);
    const ergebnis = await andere.beende(T.turnierId);
    assert.equal(ergebnis.ausstehendeGeraete, 0);
    assert.ok((await ladeZugang(knex, T.turnierId)).beendetAm instanceof Date);
    await andere.schliesseAlle();
});
