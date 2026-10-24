import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeVerwalter, MAX_LIVE_TURNIERE } from '../../src/cloudLive/verwalter.js';

let pg, knex, verzeichnis;
const verwalter = [];
const id = (r) => (typeof r === 'object' ? r.id : r);

async function baueTurnier(name) {
    const turnierId = id((await knex('turniere').insert({ bezeichnung: name, ort: 'Ort', datum: '2099-03-01', ausrichter: 'X', status: 'veroeffentlicht' }).returning('id'))[0]);
    const matteId = id((await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: `Matte ${name}` }).returning('id'))[0]);
    return { turnierId, matteId };
}

const neuerVerwalter = (optionen = {}) => {
    const v = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis }, ...optionen });
    verwalter.push(v);
    return v;
};

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cloudlive-'));
});
after(async () => {
    for (const v of verwalter) await v.schliesseAlle().catch(() => {});
    await pg.stoppe();
    try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows hält LevelDB-Dateien kurz fest */ }
});

test('MAX_LIVE_TURNIERE ist 10', () => {
    assert.equal(MAX_LIVE_TURNIERE, 10);
});

test('Zwei Turniere laufen getrennt: jedes hat seine Dokument-DB mit nur den eigenen Dokumenten', async () => {
    const A = await baueTurnier('A');
    const B = await baueTurnier('B');
    const v = neuerVerwalter();
    const za = await v.starte(A.turnierId);
    const zb = await v.starte(B.turnierId);
    assert.equal(v.offeneAnzahl(), 2);
    assert.notEqual(za.schluessel, zb.schluessel);
    const ia = v.instanz(za.schluessel);
    const ib = v.instanz(zb.schluessel);
    assert.equal(ia.turnierId, A.turnierId);
    assert.equal(ia.dbName, `turnier_${za.instanzId}`);
    assert.notEqual(ia.dbName, ib.dbName);
    assert.ok(await ia.db.get(`kampfflaeche:${A.matteId}`));
    assert.equal(await ia.db.get(`kampfflaeche:${B.matteId}`).catch(() => null), null);
    assert.ok(await ib.db.get(`kampfflaeche:${B.matteId}`));
    assert.equal(v.instanz('unbekannt'), null);
});

test('Doppelter Start ist idempotent, auch gleichzeitig', async () => {
    const T = await baueTurnier('Doppelt');
    const v = neuerVerwalter();
    const [z1, z2] = await Promise.all([v.starte(T.turnierId), v.starte(T.turnierId)]);
    assert.equal(z1.schluessel, z2.schluessel);
    assert.equal(v.offeneAnzahl(), 1);
});

test('Über dem Limit wird der Start abgelehnt (409), ein bereits laufendes Turnier bleibt startbar', async () => {
    const T1 = await baueTurnier('L1');
    const T2 = await baueTurnier('L2');
    const T3 = await baueTurnier('L3');
    const v = neuerVerwalter({ maxTurniere: 2 });
    await v.starte(T1.turnierId);
    await v.starte(T2.turnierId);
    await assert.rejects(v.starte(T3.turnierId), (e) => e.statusCode === 409 && /2 Turniere/.test(e.message));
    assert.equal((await v.starte(T1.turnierId)).turnierId, T1.turnierId);
    assert.equal(v.offeneAnzahl(), 2);
    assert.equal(await knex('cloud_live').where({ turnier_id: T3.turnierId }).first(), undefined);
});

test('Wiederaufnahme nach Neustart: dieselben Instanzen und Dokumente', async () => {
    const T = await baueTurnier('Neustart');
    const v1 = neuerVerwalter();
    const z = await v1.starte(T.turnierId);
    await v1.instanz(z.schluessel).db.put({ _id: 'geraet:marker', dokumenttyp: 'marker', bearbeitet_von: 'geraet-1' });
    await v1.schliesseAlle();
    assert.equal(v1.offeneAnzahl(), 0);

    const v2 = neuerVerwalter();
    await v2.wiederaufnahme();
    const instanz = v2.instanz(z.schluessel);
    assert.ok(instanz);
    assert.equal(instanz.dbName, `turnier_${z.instanzId}`);
    assert.ok(await instanz.db.get('geraet:marker'));
    assert.ok(await instanz.db.get(`kampfflaeche:${T.matteId}`));
});

test('planeAbgleich überträgt Änderungen der relationalen Daten in die Dokument-DB', async () => {
    const T = await baueTurnier('Abgleich');
    const v = neuerVerwalter();
    const z = await v.starte(T.turnierId);
    await knex('kampfflaechen').where({ id: T.matteId }).update({ bezeichnung: 'Umbenannt' });
    v.planeAbgleich();
    await v.leerlauf();
    assert.equal((await v.instanz(z.schluessel).db.get(`kampfflaeche:${T.matteId}`)).bezeichnung, 'Umbenannt');
});
