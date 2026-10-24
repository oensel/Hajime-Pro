import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { ladeSnapshots } from '../../src/live/snapshot.js';
import { starteFeed } from '../../src/cloudLive/teilnehmerAppFeed.js';
import { erzeugeVerwalter } from '../../src/cloudLive/verwalter.js';

// Teilnehmer-App bei einem Turnier, das die Cloud live führt: der Snapshot kommt direkt aus der Datenbank der Cloud
// (kein Uplink eines Hallen-Servers, keine Freigabe, keine urspruengliche_id).
let pg, knex, verzeichnis;
const id = (r) => (typeof r === 'object' ? r.id : r);

async function baueTurnier(name, extra = {}) {
    const turnierId = id((await knex('turniere').insert({ bezeichnung: name, ort: 'Ort', datum: '2099-03-01', ausrichter: 'X', status: 'veroeffentlicht', ...extra }).returning('id'))[0]);
    const matteId = id((await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id'))[0]);
    const poolId = id((await knex('pools').insert({ turnier_id: turnierId, kampfflaeche_id: matteId, bezeichnung: 'U15 w -44', altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44' }).returning('id'))[0]);
    await knex('turnier_teilnehmer').insert({
        turnier_id: turnierId, pool_id: poolId, judopass_id: `P-${turnierId}`, vorname: 'Anna', nachname: 'Muster', geschlecht: 'w',
        verein: 'JC', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-12-31', geburtsjahr: 2012
    });
    return { turnierId, matteId, poolId };
}

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-cl-app-'));
});
after(async () => {
    await pg.stoppe();
    try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows */ }
});

test('ladeSnapshots: mit turnierIds nur freigegebene Turniere, auch ohne urspruengliche_id; ohne turnierIds unverändert', async () => {
    const T = await baueTurnier('Cloud-Turnier');
    assert.deepEqual(await ladeSnapshots(knex, { geheimnis: 'g' }), [], 'ohne urspruengliche_id kein Snapshot eines Hallen-Servers');
    assert.deepEqual(await ladeSnapshots(knex, { geheimnis: 'g', turnierIds: [T.turnierId] }), [], 'ohne Freigabe des Veranstalters bleiben die Namen in der Cloud');
    await knex('turniere').where({ id: T.turnierId }).update({ live_freigabe: true });
    const snapshots = await ladeSnapshots(knex, { geheimnis: 'g', turnierIds: [T.turnierId] });
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].turnierKey, String(T.turnierId), 'der Schlüssel ist die Turnier-ID der Cloud');
    assert.equal(snapshots[0].teilnehmer.length, 1);
    assert.deepEqual(await ladeSnapshots(knex, { geheimnis: 'g', turnierIds: [] }), []);
});

test('Feed: übernimmt den Snapshot in das Lesemodell der App und nimmt ihn beim Beenden zurück', async () => {
    const T = await baueTurnier('Feed-Turnier', { live_freigabe: true });
    const feed = starteFeed({ knex, geheimnis: 'geheim-1', turnierId: T.turnierId, intervallMs: 60_000, sofort: false });
    await feed.tick();
    const zeile = await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first();
    assert.equal(zeile.name, 'Feed-Turnier');
    assert.equal(zeile.zurueckgezogen, false);
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: String(T.turnierId) })).length, 1);

    // Änderung im Turnier: der nächste Durchlauf übernimmt sie
    await knex('turnier_teilnehmer').insert({
        turnier_id: T.turnierId, pool_id: T.poolId, judopass_id: 'P-ZWEI', vorname: 'Berta', nachname: 'Beispiel', geschlecht: 'w',
        verein: 'JC', gewicht: 41, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-12-31', geburtsjahr: 2012
    });
    await feed.tick();
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: String(T.turnierId) })).length, 2);

    // Der Veranstalter nimmt die Freigabe zurück: das Turnier verschwindet aus der App, auch bei laufendem Live-Betrieb
    await knex('turniere').where({ id: T.turnierId }).update({ live_freigabe: false });
    await feed.tick();
    assert.equal((await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first()).zurueckgezogen, true);
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: String(T.turnierId) })).length, 0);
    await knex('turniere').where({ id: T.turnierId }).update({ live_freigabe: true });
    await feed.tick();
    assert.equal((await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first()).zurueckgezogen, false);

    await feed.stoppe({ zuruecknehmen: true });
    const nachher = await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first();
    assert.equal(nachher.zurueckgezogen, true);
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: String(T.turnierId) })).length, 0);
});

test('Der Verwalter speist die App mit dem Start und nimmt sie mit dem Beenden zurück', async () => {
    const T = await baueTurnier('Verwalter-Feed', { live_freigabe: true });
    const verwalter = erzeugeVerwalter({ knex, konfig: { datenverzeichnis: verzeichnis }, teilnehmerAppFeed: true, feedIntervallMs: 60_000 });
    try {
        await verwalter.starte(T.turnierId);
        await verwalter.leerlauf();
        const zeile = await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first();
        assert.ok(zeile, 'das Turnier ist für die App sichtbar');
        assert.equal(zeile.zurueckgezogen, false);
        await verwalter.beende(T.turnierId);
        assert.equal((await knex('live_turniere').where({ turnier_key: String(T.turnierId) }).first()).zurueckgezogen, true);
    } finally {
        await verwalter.schliesseAlle();
    }
});
