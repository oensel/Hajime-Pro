import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { starteLiveAppDienst } from '../../src/liveApp/liveAppDienst.js';

let db;
before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });

const ENV = { CLOUD_URL: 'http://127.0.0.1:9', SYNC_DATENVERZEICHNIS: './data/test-live-app' };

const POOL = { altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50' };

async function neuesTurnier(extra = {}) {
    const [{ id }] = await db.knex('turniere').insert({
        bezeichnung: 'Live-App', ort: 'O', datum: '2026-10-12', ausrichter: 'A',
        urspruengliche_id: 77, live_token: 'hjl_tokentoken', live_geheimnis: 'geheim', ...extra
    }).returning('id');
    return id;
}

// Fake-Cloud, Fake-Uplink, Fake-Snapshots und ein Fake-Cluster; Timer sind aus, die Tests rufen pruefeCloud()/tick() selbst.
function umgebung({ erreichbar = true, cluster = null } = {}) {
    const zustand = { erreichbar, uplinks: [], gesendet: [], geheimnisse: [], jetzt: 1_000_000 };
    const cloud = { konfiguriert: () => true, pruefeErreichbar: async () => zustand.erreichbar };
    const erzeugeUplinkFn = ({ url, token }) => {
        const uplink = {
            url, token, letzterErfolg: null, letzterFehler: null,
            sende: async (snapshots, optionen = {}) => {
                zustand.gesendet.push({ url, token, snapshots, zurueckzunehmen: optionen.zurueckzunehmen || [] });
                if (zustand.fehlerFuerToken && zustand.fehlerFuerToken.has(token)) {
                    uplink.letzterFehler = 'Cloud antwortete mit Status 401';
                    return { gesendet: 0, zurueckgezogen: 0, fehler: 1 };
                }
                uplink.letzterErfolg = zustand.jetzt;
                return { gesendet: snapshots.length, zurueckgezogen: 0, fehler: 0 };
            },
            zustand: () => ({ letzterErfolg: uplink.letzterErfolg, letzterFehler: uplink.letzterFehler, naechsterVersuch: 0 })
        };
        zustand.uplinks.push(uplink);
        return uplink;
    };
    const ladeSnapshotsFn = async (knex, { geheimnis }) => { zustand.geheimnisse.push(geheimnis); return [{ turnierKey: '77', name: 'x' }]; };
    const dienst = starteLiveAppDienst({
        knex: db.knex, cloud, env: ENV, jetzt: () => zustand.jetzt, timer: false,
        holeCluster: () => cluster, erzeugeUplinkFn, ladeSnapshotsFn
    });
    return { dienst, zustand };
}

test('Einschalten setzt die Freigabe, Ausschalten merkt die Rücknahme; Voraussetzungen werden geprüft', async () => {
    const { dienst } = umgebung();
    const id = await neuesTurnier();
    await dienst.schalte({ turnierId: id, aktiv: true });
    let zeile = await db.knex('turniere').where({ id }).first();
    assert.equal(zeile.live_freigabe, true);
    assert.equal(zeile.live_ruecknahme, false);
    await dienst.schalte({ turnierId: id, aktiv: false });
    zeile = await db.knex('turniere').where({ id }).first();
    assert.equal(zeile.live_freigabe, false);
    assert.equal(zeile.live_ruecknahme, true);

    const ohneHerkunft = await neuesTurnier({ urspruengliche_id: null });
    await assert.rejects(() => dienst.schalte({ turnierId: ohneHerkunft, aktiv: true }), (e) => e.statusCode === 409 && e.code === 'kein_cloud_turnier');
    const ohneToken = await neuesTurnier({ live_token: null });
    await assert.rejects(() => dienst.schalte({ turnierId: ohneToken, aktiv: true }), (e) => e.code === 'kein_token');
    const fertig = await neuesTurnier({ status: 'abgeschlossen' });
    await assert.rejects(() => dienst.schalte({ turnierId: fertig, aktiv: true }), (e) => e.code === 'turnier_abgeschlossen');
    dienst.stoppe();
});

test('poolsVerteilt ist nur wahr, wenn ein normaler Pool eine Matte hat', async () => {
    const { dienst } = umgebung();
    const id = await neuesTurnier();
    assert.equal((await dienst.status({ turnierId: id })).poolsVerteilt, false);
    const [{ id: matte }] = await db.knex('kampfflaechen').insert({ turnier_id: id, bezeichnung: 'Matte 1' }).returning('id');
    const [{ id: sammel }] = await db.knex('pools').insert({ ...POOL, turnier_id: id, bezeichnung: 'Verspätet', verspaetet: true, kampfflaeche_id: matte }).returning('id');
    assert.equal((await dienst.status({ turnierId: id })).poolsVerteilt, false);
    await db.knex('pools').where({ id: sammel }).del();
    await db.knex('pools').insert({ ...POOL, turnier_id: id, bezeichnung: 'U15 m -50', kampfflaeche_id: matte });
    assert.equal((await dienst.status({ turnierId: id })).poolsVerteilt, true);
    dienst.stoppe();
});

test('Tick sendet mit Token und Geheimnis des Turniers an die Ingest-URL der Cloud, ein Neustart setzt es fort', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    const id = await neuesTurnier({ live_freigabe: true });
    const { dienst, zustand } = umgebung();
    await dienst.pruefeCloud();
    await dienst.tick();
    assert.equal(zustand.gesendet.length, 1);
    assert.equal(zustand.gesendet[0].url, 'http://127.0.0.1:9/api/live/ingest');
    assert.equal(zustand.gesendet[0].token, 'hjl_tokentoken');
    assert.deepEqual(zustand.geheimnisse, ['geheim']);
    const status = await dienst.status({ turnierId: id });
    assert.equal(status.aktiv, true);
    assert.equal(status.zustand, 'gruen');
    assert.equal(status.sender, 'eigener');
    assert.doesNotMatch(JSON.stringify(status), /hjl_tokentoken|geheim"/);
    dienst.stoppe();
});

test('Ohne Cloud ist der Zustand rot, mit Cloud aber ohne Erfolg gelb', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    const id = await neuesTurnier({ live_freigabe: true });
    const { dienst, zustand } = umgebung({ erreichbar: false });
    await dienst.pruefeCloud();
    await dienst.tick();
    assert.equal(zustand.gesendet.length, 0);
    assert.equal((await dienst.status({ turnierId: id })).zustand, 'rot');
    zustand.erreichbar = true;
    await dienst.pruefeCloud();
    assert.equal((await dienst.status({ turnierId: id })).zustand, 'gelb');
    dienst.stoppe();
});

test('Rücknahme: ein ausgeschaltetes Turnier wird über die Zuruf-Liste zurückgenommen', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    await neuesTurnier({ live_freigabe: false, live_ruecknahme: true });
    const { dienst, zustand } = umgebung();
    await dienst.pruefeCloud();
    await dienst.tick();
    assert.equal(zustand.gesendet.length, 1);
    assert.deepEqual(zustand.gesendet[0].snapshots, []);
    assert.deepEqual(zustand.gesendet[0].zurueckzunehmen, ['77']);
    dienst.stoppe();
});

const fakeCluster = (rolle, partnerStatus) => ({ rolle: () => rolle, knoten: 'server1', partnerLetzter: () => partnerStatus });

test('Cluster: der Master sendet nicht, wenn der Secondary die Cloud erreicht, und zeigt dessen Stand', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    const id = await neuesTurnier({ live_freigabe: true });
    const partner = {
        rolle: 'secondary', knoten: 'server2',
        live_app: { cloud_erreichbar: true, sendet: true, letzter_erfolg: new Date(1_000_000 - 3000).toISOString(), letzter_fehler: null }
    };
    const { dienst, zustand } = umgebung({ erreichbar: false, cluster: fakeCluster('master', partner) });
    await dienst.pruefeCloud();
    await dienst.tick();
    assert.equal(zustand.gesendet.length, 0);
    const status = await dienst.status({ turnierId: id });
    assert.equal(status.sender, 'partner');
    assert.equal(status.senderKnoten, 'server2');
    assert.equal(status.cloudErreichbar, true);
    assert.equal(status.zustand, 'gruen');
    dienst.stoppe();
});

test('Cluster: der Secondary mit Internet sendet; nach Rollenwechsel sendet weiter genau ein Knoten', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    await neuesTurnier({ live_freigabe: true });
    const master = { rolle: 'master', knoten: 'server1', live_app: { cloud_erreichbar: true, sendet: false } };
    const a = umgebung({ cluster: fakeCluster('secondary', master) });
    await a.dienst.pruefeCloud();
    await a.dienst.tick();
    assert.equal(a.zustand.gesendet.length, 1);
    assert.equal(a.dienst.statusFuerPartner().sendet, true);

    // Der frühere Secondary ist jetzt Master; der frühere Master (mit Internet) ist Secondary und sendet nun selbst.
    const alterSecondary = { rolle: 'secondary', knoten: 'server1', live_app: { cloud_erreichbar: true, sendet: true } };
    const b = umgebung({ cluster: fakeCluster('master', alterSecondary) });
    await b.dienst.pruefeCloud();
    await b.dienst.tick();
    assert.equal(b.zustand.gesendet.length, 0);
    assert.equal(b.dienst.statusFuerPartner().sendet, false);
    a.dienst.stoppe();
    b.dienst.stoppe();
});

test('Abgeschlossenes Turnier: die Anzeige bleibt wahrheitsgemäß an und lässt sich ausschalten', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    const id = await neuesTurnier({ live_freigabe: true, status: 'abgeschlossen' });
    const { dienst } = umgebung();
    await dienst.pruefeCloud();
    await dienst.tick();
    let s = await dienst.status({ turnierId: id });
    assert.equal(s.verfuegbar, false);
    assert.equal(s.grund, 'turnier_abgeschlossen');
    assert.equal(s.aktiv, true);
    assert.equal(s.zustand, 'gruen');
    s = await dienst.schalte({ turnierId: id, aktiv: false });
    assert.equal(s.aktiv, false);
    assert.equal(s.zustand, 'grau');
    assert.equal((await db.knex('turniere').where({ id }).first()).live_ruecknahme, true);
    dienst.stoppe();
});

test('Mehrere Turniere: Erfolg und Fehler werden je Turnier geführt, ein anderes Turnier überschreibt sie nicht', async () => {
    await db.knex('turniere').update({ live_freigabe: false, live_ruecknahme: false });
    const a = await neuesTurnier({ urspruengliche_id: 101, live_token: 'hjl_tokenAAAA', live_freigabe: true });
    const b = await neuesTurnier({ urspruengliche_id: 102, live_token: 'hjl_tokenBBBB', live_freigabe: false, live_ruecknahme: true });
    const { dienst, zustand } = umgebung();
    zustand.fehlerFuerToken = new Set(['hjl_tokenAAAA']);
    await dienst.pruefeCloud();
    await dienst.tick();
    assert.equal((await dienst.status({ turnierId: a })).zustand, 'gelb');
    assert.equal((await dienst.status({ turnierId: b })).zustand, 'grau');
    // Auch die Rücknahme von B (Erfolg) macht A nicht grün: noch ein Durchlauf, A bleibt gelb.
    await dienst.tick();
    assert.equal((await dienst.status({ turnierId: a })).zustand, 'gelb');
    assert.deepEqual(Object.keys(dienst.statusFuerPartner().turniere).sort(), ['101', '102']);
    dienst.stoppe();
});
