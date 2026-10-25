import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { erzeugeDokumentDb } from '../../src/sync/dokumentDb.js';
import { erzeugeAbgleich } from '../../src/sync/abgleich.js';
import { erzeugeBruecke } from '../../src/sync/bruecke.js';

// Cloud-Live: die Dokument-DB eines Turniers wird von Geräten beschrieben, die Brücke darf nur Zeilen dieses Turniers ändern.
let pg, knex, verzeichnis, dokumentDb;
let A, B; // { turnierId, matteId, poolId, kampfId }
let db, bruecke;

const id = (r) => (typeof r === 'object' ? r.id : r);

async function baueTurnier(name, poolName) {
    const turnierId = id((await knex('turniere').insert({ bezeichnung: name, ort: 'Ort', datum: '2099-03-01', ausrichter: 'X', status: 'veroeffentlicht' }).returning('id'))[0]);
    const matteId = id((await knex('kampfflaechen').insert({ turnier_id: turnierId, bezeichnung: 'Matte 1' }).returning('id'))[0]);
    const poolId = id((await knex('pools').insert({
        turnier_id: turnierId, kampfflaeche_id: matteId, bezeichnung: poolName, altersklasse: 'U15', geschlecht: 'm', gewichtsklasse: '-50'
    }).returning('id'))[0]);
    const kampfId = id((await knex('kaempfe').insert({ pool_id: poolId }).returning('id'))[0]);
    return { turnierId, matteId, poolId, kampfId };
}

const geraeteDokument = (rest) => ({ ...rest, bearbeitet_von: 'geraet-1' });

async function warteAufBruecke() {
    await bruecke.leerlauf();
    await bruecke.leerlauf();
}

before(async () => {
    pg = await starteTestPostgres();
    knex = pg.knex;
    verzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'hajime-bruecke-'));
    dokumentDb = erzeugeDokumentDb({ datenverzeichnis: verzeichnis });
    A = await baueTurnier('Turnier A', 'Pool-von-A');
    B = await baueTurnier('Turnier B', 'GEHEIM-Pool-von-B');
    db = await dokumentDb.oeffneSicher('turnier_abschottung_a');
    const zustand = { instanzId: 'abschottung-a', turnierId: A.turnierId, db, epoche: 0, abschottung: true };
    const abgleich = erzeugeAbgleich({ knex, zustand });
    bruecke = erzeugeBruecke({ knex, zustand, abgleich });
    await abgleich.fuehreAus();
    bruecke.starte();
});

after(async () => {
    await bruecke.stoppe();
    await db.close();
    await pg.stoppe();
    try { fs.rmSync(verzeichnis, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Windows hält LevelDB-Dateien kurz fest */ }
});

test('Geräte-Dokument des eigenen Turniers wird angewendet', async () => {
    const dok = await db.get(`kampfflaeche:${A.matteId}`);
    await db.put(geraeteDokument({ ...dok, status: 'pausiert' }));
    await warteAufBruecke();
    const nach = await db.get(`kampfflaeche:${A.matteId}`);
    assert.equal((await knex('kampfflaechen').where({ id: A.matteId }).first()).status, 'pausiert', JSON.stringify(nach));
});

test('Geräte-Dokument mit der sql_id einer Matte eines anderen Turniers wird abgelehnt', async () => {
    const vorher = await knex('kampfflaechen').where({ id: B.matteId }).first();
    await db.put(geraeteDokument({
        _id: `kampfflaeche:${B.matteId}`, dokumenttyp: 'kampfflaeche', sql_id: B.matteId, id: B.matteId, turnier_id: A.turnierId, status: 'pausiert'
    }));
    await warteAufBruecke();
    assert.equal((await knex('kampfflaechen').where({ id: B.matteId }).first()).status, vorher.status);
    // Der anschließende Abgleich entfernt das fremde Dokument wieder aus dieser Dokument-DB.
    assert.equal(await db.get(`kampfflaeche:${B.matteId}`).catch(() => null), null);
});

test('Kampf und Pool eines anderen Turniers werden abgelehnt, ohne Daten des fremden Turniers ins Dokument zu kopieren', async () => {
    const kampfVorher = await knex('kaempfe').where({ id: B.kampfId }).first();
    const poolVorher = await knex('pools').where({ id: B.poolId }).first();
    await db.put(geraeteDokument({
        _id: `kampf:${B.kampfId}`, dokumenttyp: 'kampf', sql_id: B.kampfId, id: B.kampfId, pool_id: B.poolId, status: 'beendet', sieger_id: 999
    }));
    await db.put(geraeteDokument({
        _id: `pool:${B.poolId}`, dokumenttyp: 'pool', sql_id: B.poolId, id: B.poolId, status: 'abgeschlossen'
    }));
    await warteAufBruecke();
    assert.equal((await knex('kaempfe').where({ id: B.kampfId }).first()).status, kampfVorher.status);
    assert.equal((await knex('pools').where({ id: B.poolId }).first()).status, poolVorher.status);
    // Der Server-Stand der fremden Zeile darf nicht in die Dokument-DB dieses Turniers geschrieben werden (Ablehnung ohne Zeilendaten).
    const alleDokumente = JSON.stringify((await db.allDocs({ include_docs: true })).rows.map(r => r.doc));
    assert.equal(alleDokumente.includes('GEHEIM-Pool-von-B'), false);
});

test('Nachmeldung mit turnier_id eines anderen Turniers legt keinen Teilnehmer an', async () => {
    const vorher = Number((await knex('turnier_teilnehmer').count({ n: '*' }).first()).n);
    await db.put(geraeteDokument({
        _id: 'teilnehmer:neu-fremd', dokumenttyp: 'teilnehmer', turnier_id: B.turnierId,
        vorname: 'Max', nachname: 'Fremd', judopass_id: 'X-1', verein: 'JC', geburtsjahr: 2010, geschlecht: 'm', gewicht: 40, gewogen: true
    }));
    await warteAufBruecke();
    assert.equal(Number((await knex('turnier_teilnehmer').count({ n: '*' }).first()).n), vorher);
    // Die abgelehnte Nachmeldung wird festgehalten (Konflikt für die Turnierleitung), nicht angewendet.
    const konflikte = (await db.allDocs({ include_docs: true, startkey: 'konflikt:', endkey: 'konflikt:￰' })).rows.map(r => r.doc);
    assert.ok(konflikte.some(k => k.bezug_id === 'teilnehmer:neu-fremd' && k.konflikt_typ === 'abgelehnt'));
});

test('Nachmeldung, deren dokument_id zu einem Teilnehmer eines anderen Turniers gehört, ändert diesen nicht', async () => {
    const fremdId = id((await knex('turnier_teilnehmer').insert({
        turnier_id: B.turnierId, pool_id: B.poolId, judopass_id: 'B-1', vorname: 'Bea', nachname: 'Fremd', geschlecht: 'w', verein: 'JC',
        gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2099-01-01', geburtsjahr: 2012,
        status: 'angemeldet', gewogen: true, dokument_id: 'teilnehmer:uebernahme-versuch'
    }).returning('id'))[0]);
    await db.put(geraeteDokument({
        _id: 'teilnehmer:uebernahme-versuch', dokumenttyp: 'teilnehmer', turnier_id: A.turnierId, status: 'kampfbereit',
        vorname: 'Hacker', nachname: 'Neu', judopass_id: 'A-1', verein: 'JC', geburtsjahr: 2012, geschlecht: 'w', gewicht: 40, gewogen: true
    }));
    await warteAufBruecke();
    const nachher = await knex('turnier_teilnehmer').where({ id: fremdId }).first();
    assert.equal(nachher.status, 'angemeldet');
    assert.equal(nachher.nachname, 'Fremd');
});

test('Nachmeldung: turnier_id wird streng als Ganzzahl geprüft (kein Number-Trick wie [1] oder true)', async () => {
    const vorher = Number((await knex('turnier_teilnehmer').count({ n: '*' }).first()).n);
    await db.put(geraeteDokument({
        _id: 'teilnehmer:trick-array', dokumenttyp: 'teilnehmer', turnier_id: [A.turnierId],
        vorname: 'Tri', nachname: 'Ck', judopass_id: 'T-1', verein: 'JC', geburtsjahr: 2010, geschlecht: 'm', gewicht: 40, gewogen: true
    }));
    await warteAufBruecke();
    assert.equal(Number((await knex('turnier_teilnehmer').count({ n: '*' }).first()).n), vorher);
    const konflikte = (await db.allDocs({ include_docs: true, startkey: 'konflikt:', endkey: 'konflikt:\ufff0' })).rows.map(r => r.doc);
    const k = konflikte.find(x => x.bezug_id === 'teilnehmer:trick-array');
    assert.ok(k, 'abgelehnte Nachmeldung wird als Konflikt festgehalten');
    assert.equal(k.konflikt_typ, 'abgelehnt');
    assert.match(k.grund, /nicht zu diesem Turnier/);
});

test('Ein gefälschtes Klärungs-Dokument eines Geräts kann einen Kampf eines anderen Turniers nicht verändern', async () => {
    await knex('kaempfe').where({ id: B.kampfId }).update({ status: 'klaerung' });
    await db.put({
        _id: 'konflikt:gefaelscht', dokumenttyp: 'konflikt', konflikt_typ: 'klaerung', prioritaet: 'hoch', bezug_id: `kampf:${B.kampfId}`,
        grund: 'gefälscht', version_lokal: { sql_id: B.kampfId, status: 'beendet' }, version_server: { status: 'bereit' },
        erstellt_am: new Date().toISOString(), erledigt: false, bearbeitet_von: 'geraet-1'
    });
    await assert.rejects(bruecke.entscheideKlaerung('konflikt:gefaelscht', 'server'), (e) => e.statusCode === 404 || e.statusCode === 403);
    assert.equal((await knex('kaempfe').where({ id: B.kampfId }).first()).status, 'klaerung');
});
