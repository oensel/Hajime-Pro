import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import express from 'express';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { getLiveRoutes } from '../../src/routes/liveRoutes.js';
import { loescheAlteLiveDaten } from '../../src/liveCloud/aufbewahrung.js';
import { erzeugeToken } from '../../src/liveCloud/token.js';
import { erzeugeRatenbegrenzung } from '../../src/liveCloud/ratenbegrenzung.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';

const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (turnierKey, extra = {}) => ({
    version: 1, turnierKey, name: `Turnier ${turnierKey}`, datum: '2026-10-12', stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer: [t('a1', 'Anna', 'Muster'), t('a2', 'Max', 'Müller')], warteschlangen: [], ...extra
});

let db, server, basis, token, gebundenerToken;
const sende = (pfad, { methode = 'GET', header = {}, body, gzip = false } = {}) => {
    const daten = body === undefined ? undefined : (gzip ? zlib.gzipSync(JSON.stringify(body)) : JSON.stringify(body));
    return fetch(`${basis}${pfad}`, {
        method: methode, body: daten,
        headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(gzip ? { 'Content-Encoding': 'gzip' } : {}), ...header }
    });
};
const mitToken = (extra = {}) => ({ header: { Authorization: `Bearer ${token}` }, ...extra });

before(async () => {
    db = await starteTestPostgres();
    ({ token } = await erzeugeToken(db.knex, { name: 'test' }));
    ({ token: gebundenerToken } = await erzeugeToken(db.knex, { name: 'gebunden', turnierKey: 'GEBUNDEN' }));
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    app.use('/api/live', getLiveRoutes(db.knex, {
        begrenzung: erzeugeRatenbegrenzung({ max: 40 }), fehlerBegrenzung: erzeugeRatenbegrenzung({ max: 3 }),
        jetzt: () => new Date('2026-10-12T10:01:00Z'), env: {}
    }));
    app.use((fehler, req, res, next) => res.status(fehler.status || 500).json({ error: fehler.message }));
    server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    basis = `http://127.0.0.1:${server.address().port}/api/live`;
});
after(async () => {
    if (server) await new Promise(r => server.close(r));
    if (db) await db.stoppe();
});

test('Ingest: ohne und mit falschem Token 401, mit Token 204 (auch gzip), Daten sind danach abrufbar', async () => {
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R1') })).status, 401);
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R1'), header: { Authorization: 'Bearer hjl_falsch' } })).status, 401);
    const r = await sende('/ingest', { methode: 'POST', body: paket('R1'), ...mitToken({ gzip: true }) });
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');
    const liste = await (await sende('/turniere')).json();
    assert.ok(liste.turniere.some(x => x.key === 'R1'));
    assert.equal(liste.serverzeit, '2026-10-12T10:01:00.000Z');
});

test('Ingest: ungültiges Paket 400, veraltetes Paket 409 ohne Änderung, gebundenes Token nur für sein Turnier', async () => {
    assert.equal((await sende('/ingest', { methode: 'POST', body: { version: 1 }, ...mitToken() })).status, 400);
    await sende('/ingest', { methode: 'POST', body: paket('R2', { sequenz: 500, name: 'Neu' }), ...mitToken() });
    const alt = await sende('/ingest', { methode: 'POST', body: paket('R2', { sequenz: 100, name: 'Alt' }), ...mitToken() });
    assert.equal(alt.status, 409);
    assert.equal((await (await sende('/turniere/R2')).json()).name, 'Neu');

    const fremd = await sende('/ingest', { methode: 'POST', body: paket('R3'), header: { Authorization: `Bearer ${gebundenerToken}` } });
    assert.equal(fremd.status, 403);
    const eigen = await sende('/ingest', { methode: 'POST', body: paket('GEBUNDEN'), header: { Authorization: `Bearer ${gebundenerToken}` } });
    assert.equal(eigen.status, 204);
});

test('Ingest: wiederholt falsche Token werden begrenzt (429), das gültige Token bleibt nutzbar', async () => {
    const falsch = { methode: 'POST', body: paket('R4'), header: { Authorization: 'Bearer hjl_nochfalsch' } };
    const stati = [];
    for (let i = 0; i < 5; i++) stati.push((await sende('/ingest', falsch)).status);
    assert.ok(stati.includes(429), `Stati ${stati}`);
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R4'), ...mitToken() })).status, 204);
});

test('Rücknahme über den Ingest: Turnier verschwindet aus der Liste', async () => {
    await sende('/ingest', { methode: 'POST', body: paket('R5', { sequenz: 10 }), ...mitToken() });
    const rueck = { version: 1, turnierKey: 'R5', zurueckgezogen: true, stand: '2026-10-12T10:00:00.000Z', sequenz: 20 };
    assert.equal((await sende('/ingest', { methode: 'POST', body: rueck, ...mitToken() })).status, 204);
    assert.equal((await sende('/turniere/R5')).status, 404);
    assert.ok(!(await (await sende('/turniere')).json()).turniere.some(x => x.key === 'R5'));
});

test('App-API: Turnier, Suche, Pool, Verein', async () => {
    const turnier = await (await sende('/turniere/R1')).json();
    assert.equal(turnier.name, 'Turnier R1');
    assert.deepEqual(turnier.vereine, [{ key: 'v1', name: 'JC Muster', anzahl: 2 }]);
    assert.ok(turnier.serverzeit);

    assert.deepEqual((await (await sende('/turniere/R1/suche?q=mus')).json()).treffer.map(x => x.key), ['a1']);
    assert.deepEqual((await (await sende('/turniere/R1/suche?q=%25')).json()).treffer, []);
    assert.deepEqual((await (await sende('/turniere/R1/suche')).json()).treffer, []);

    const pool = await (await sende('/turniere/R1/pools/10')).json();
    assert.equal(pool.pool.bezeichnung, 'U15 w -44');
    assert.equal(pool.teilnehmer.length, 2);
    assert.equal((await sende('/turniere/R1/pools/abc')).status, 400);
    assert.equal((await sende('/turniere/R1/pools/999')).status, 404);

    assert.equal((await (await sende('/turniere/R1/vereine/v1')).json()).teilnehmer.length, 2);
    assert.equal((await sende('/turniere/gibtsnicht')).status, 404);
});

test('App-API: Übersicht mit Schlüsseln, unbekannt/leer/zurückgezogen', async () => {
    const r = await (await sende('/turniere/R1/uebersicht', { methode: 'POST', body: { teilnehmer: ['a1', 'x'], vereine: [] } })).json();
    assert.deepEqual(r.teilnehmer.map(x => x.key), ['a1']);
    assert.equal(r.stand, '2026-10-12T10:00:00.000Z');
    assert.ok(r.empfangenAm);

    const leer = await sende('/turniere/R1/uebersicht', { methode: 'POST', body: {} });
    assert.equal(leer.status, 200);
    assert.deepEqual((await leer.json()).teilnehmer, []);
    assert.equal((await sende('/turniere/R5/uebersicht', { methode: 'POST', body: { teilnehmer: ['a1'] } })).status, 404);
    assert.equal((await sende('/turniere/R1/uebersicht', { methode: 'POST', body: 'kaputt' })).status, 400);
});

test('App-API: Pools und Dashboard', async () => {
    await sende('/ingest', { methode: 'POST', body: paket('R8', {
        pools: [{ id: 10, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau' }],
        kaempfe: [{ id: 1, poolId: 10, nr: 'R1', status: 'gestartet', reihenfolge: 1, k1: 'a1', k2: 'a2', sieger: null, p1: 0, p2: 0 }]
    }), ...mitToken() });
    const pools = await (await sende('/turniere/R8/pools')).json();
    assert.equal(pools.pools.length, 1);
    assert.equal(pools.pools[0].laeuft, 1);
    const dash = await (await sende('/turniere/R8/dashboard')).json();
    assert.equal(dash.matten[0].laufend.k1.name, 'Anna Muster');
    assert.ok(dash.serverzeit);
    assert.equal((await sende('/turniere/gibtsnicht/dashboard')).status, 404);
    assert.equal((await sende('/turniere/gibtsnicht/pools')).status, 404);
    const pool = await (await sende('/turniere/R8/pools/10')).json();
    assert.equal(pool.kaempfe.length, 1);
});

test('App-API ist ratenbegrenzt (429), der Ingest nicht', async () => {
    const stati = [];
    for (let i = 0; i < 60; i++) stati.push((await sende('/turniere')).status);
    assert.ok(stati.includes(429));
    assert.equal((await sende('/ingest', { methode: 'POST', body: paket('R6'), ...mitToken() })).status, 204);
});

test('Aufbewahrung: Turniere älter als 7 Tage und alte Grabsteine werden gelöscht', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket('ALT', { datum: '2026-10-01', sequenz: 1 }));
    await uebernimmPaket(knex, paket('FRISCH', { datum: '2026-10-10', sequenz: 1 }));
    await uebernimmPaket(knex, { version: 1, turnierKey: 'GRAB', zurueckgezogen: true, stand: '2026-10-01T00:00:00Z', sequenz: 1 },
        { jetzt: () => new Date('2026-10-01T00:00:00Z') });
    const geloescht = await loescheAlteLiveDaten(knex, { tage: 7, jetzt: () => new Date('2026-10-12T00:00:00Z') });
    assert.ok(geloescht >= 2);
    assert.equal(await knex('live_turniere').where({ turnier_key: 'ALT' }).first(), undefined);
    assert.equal(await knex('live_teilnehmer').where({ turnier_key: 'ALT' }).first(), undefined);
    assert.equal(await knex('live_turniere').where({ turnier_key: 'GRAB' }).first(), undefined);
    assert.ok(await knex('live_turniere').where({ turnier_key: 'FRISCH' }).first());
});

test('Ingest: eine veraltete Rücknahme wird nicht still geschluckt (409), das Turnier bleibt sichtbar', async () => {
    await sende('/ingest', { methode: 'POST', body: paket('R7', { sequenz: 900 }), ...mitToken() });
    const rueck = { version: 1, turnierKey: 'R7', zurueckgezogen: true, stand: '2026-10-12T10:00:00.000Z', sequenz: 100 };
    assert.equal((await sende('/ingest', { methode: 'POST', body: rueck, ...mitToken() })).status, 409);
    const zeile = await db.knex('live_turniere').where({ turnier_key: 'R7' }).first();
    assert.equal(zeile.zurueckgezogen, false);
    assert.equal(Number(zeile.sequenz), 900);
});
