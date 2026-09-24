import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestCouchServer } from '../../helpers/couchTestServer.js';
import { connect } from '../../../../src/db/couch.js';
import { createTurnierDbRegistry } from '../../../../src/db/offline/turnierDbRegistry.js';
import { createKampfflaechenRepository } from '../../../../src/db/repositories/kampfflaechenRepository.js';
import { createTurnierTeilnehmerRepository } from '../../../../src/db/repositories/turnierTeilnehmerRepository.js';
import { createTurnierRepository } from '../../../../src/db/repositories/turnierRepository.js';
import { OFFLINE_VEREIN_ID } from '../../../../src/db/offline/offlineAccounts.js';
import {
    createTurnier, getTurnier, getTurniere, updateTurnier, deleteTurnier,
    veroeffentlicheTurnier, sageTurnierAb, beendeDurchfuehrung,
    importTurnier, exportTurnier
} from '../../../../src/controllers/offline/turnierController.js';

let server;
let nano;
let registry;

before(async () => {
    server = await startTestCouchServer();
    nano = connect(server.url);
    registry = createTurnierDbRegistry(nano);
});

after(async () => {
    await server.close();
});

function fakeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

test('createTurnier legt ein Turnier mit Kampfflächen an und getTurnier liest es zurück', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Testturnier', ort: 'Musterstadt', datum: '2026-05-10', ausrichter: 'TV Muster', anzahl_kampfflaechen: '2' }
    }, createRes);

    assert.equal(createRes.statusCode, 201);
    assert.ok(createRes.body.success);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 2);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Testturnier');
    assert.equal(getRes.body.status_effektiv, 'entwurf');
    assert.equal(getRes.body.teilnehmer_anzahl, 0);
});

test('createTurnier setzt verein_id auf die feste Offline-Vereins-ID', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Vereins-ID-Test', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' }
    }, createRes);
    const turnierId = createRes.body.turnierId;

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.verein_id, OFFLINE_VEREIN_ID);
});

test('createTurnier lehnt Startgeld ohne Zahlungsdaten ab', async () => {
    const res = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', startgeld: '10' }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
});

test('updateTurnier passt Felder an und synchronisiert die Kampfflächen-Anzahl', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Vorher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '1' }
    }, createRes);
    const turnierId = createRes.body.turnierId;

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'Nachher', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '3' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 3);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Nachher');
});

test('updateTurnier entfernt bei Verkleinerung immer die Matte mit der höchsten Nummer', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, {
        body: { bezeichnung: 'Matten-Schrumpfung', ort: 'X', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '3' }
    }, createRes);
    const turnierId = createRes.body.turnierId;

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'Matten-Schrumpfung', ort: 'X', datum: '2026-01-01', ausrichter: 'Z', anzahl_kampfflaechen: '1' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);

    const db = await registry.openTurnierDb(turnierId);
    const kampfflaechen = await createKampfflaechenRepository(db).findAll();
    assert.equal(kampfflaechen.length, 1);
    assert.equal(kampfflaechen[0].bezeichnung, 'Matte 1');
});

test('updateTurnier meldet 404 für eine unbekannte Turnier-ID', async () => {
    const res = fakeRes();
    await updateTurnier(registry, {
        params: { id: 'nicht-vorhanden-00000000-0000-0000-0000-000000000000' },
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z' }
    }, res);
    assert.equal(res.statusCode, 404);
});

test('getTurniere listet alle lokal angelegten Turniere', async () => {
    const registryEigen = createTurnierDbRegistry(nano);
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste A', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, fakeRes());
    await createTurnier(registryEigen, { body: { bezeichnung: 'Liste B', ort: 'X', datum: '2026-02-01', ausrichter: 'Z' } }, fakeRes());

    const res = fakeRes();
    await getTurniere(registryEigen, { query: {} }, res);
    const bezeichnungen = res.body.map((t) => t.bezeichnung);
    assert.ok(bezeichnungen.includes('Liste A'));
    assert.ok(bezeichnungen.includes('Liste B'));
});

test('deleteTurnier löscht ein leeres Entwurfs-Turnier vollständig', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Löschbar', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const deleteRes = fakeRes();
    await deleteTurnier(registry, { params: { id: turnierId } }, deleteRes);
    assert.equal(deleteRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.statusCode, 404);

    // Ein erneuter Lese-Zugriff auf die gelöschte ID darf keine leere Geister-Datenbank
    // erzeugen -- sonst würde sie hier in der Liste wieder auftauchen.
    const listeRes = fakeRes();
    await getTurniere(registry, { query: {} }, listeRes);
    const gelisteteIds = listeRes.body.map((t) => t.id);
    assert.ok(!gelisteteIds.includes(turnierId));
});

test('Lebenszyklus: veroeffentlichen -> absagen', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Lebenszyklus', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const veroeffentlichenRes = fakeRes();
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, veroeffentlichenRes);
    assert.equal(veroeffentlichenRes.statusCode, 200);

    const absagenRes = fakeRes();
    await sageTurnierAb(registry, { params: { id: turnierId } }, absagenRes);
    assert.equal(absagenRes.statusCode, 200);

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: turnierId } }, getRes);
    assert.equal(getRes.body.status, 'abgesagt');
});

test('beendeDurchfuehrung lehnt ein Turnier ab, das nicht in Durchführung ist', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Nicht in Durchführung', ort: 'X', datum: '2099-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const res = fakeRes();
    await beendeDurchfuehrung(registry, { params: { id: turnierId } }, res);
    assert.equal(res.statusCode, 403);
});

test('deleteTurnier lehnt ein veröffentlichtes Turnier ab, dessen Wettkampftag bereits erreicht ist (effektiv in_durchfuehrung)', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Läuft schon', ort: 'X', datum: '2020-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, fakeRes());

    const deleteRes = fakeRes();
    await deleteTurnier(registry, { params: { id: turnierId } }, deleteRes);
    assert.equal(deleteRes.statusCode, 403);
});

test('deleteTurnier lehnt ein Turnier mit angemeldeten Teilnehmern ab', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Hat Teilnehmer', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    await createTurnierTeilnehmerRepository(db).create({ name: 'Max Mustermann' });

    const deleteRes = fakeRes();
    await deleteTurnier(registry, { params: { id: turnierId } }, deleteRes);
    assert.equal(deleteRes.statusCode, 409);
});

test('updateTurnier lehnt ein bereits abgeschlossenes Turnier ab', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Archiv', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    const turnierRepository = createTurnierRepository(db);
    const bestehend = await turnierRepository.get();
    await turnierRepository.save({ ...bestehend, status: 'abgeschlossen' });

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'Geänderter Name', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 403);
});

test('updateTurnier lehnt Startgeld ohne Zahlungsdaten ab', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Update ohne Zahlungsdaten', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const updateRes = fakeRes();
    await updateTurnier(registry, {
        params: { id: turnierId },
        body: { bezeichnung: 'X', ort: 'Y', datum: '2026-01-01', ausrichter: 'Z', startgeld: '10' }
    }, updateRes);
    assert.equal(updateRes.statusCode, 400);
    assert.equal(updateRes.body.success, false);
});

test('veroeffentlicheTurnier lehnt ein bereits veröffentlichtes Turnier ab', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Doppelt veröffentlicht', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const ersteVeroeffentlichung = fakeRes();
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, ersteVeroeffentlichung);
    assert.equal(ersteVeroeffentlichung.statusCode, 200);

    const zweiteVeroeffentlichung = fakeRes();
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, zweiteVeroeffentlichung);
    assert.equal(zweiteVeroeffentlichung.statusCode, 400);
});

test('sageTurnierAb lehnt ein bereits abgeschlossenes Turnier ab', async () => {
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Schon abgeschlossen', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;

    const db = await registry.openTurnierDb(turnierId);
    const turnierRepository = createTurnierRepository(db);
    const bestehend = await turnierRepository.get();
    await turnierRepository.save({ ...bestehend, status: 'abgeschlossen' });

    const absagenRes = fakeRes();
    await sageTurnierAb(registry, { params: { id: turnierId } }, absagenRes);
    assert.equal(absagenRes.statusCode, 403);
});

function bufferZuBase64(objekt) {
    return Buffer.from(JSON.stringify(objekt), 'utf-8').toString('base64');
}

test('importTurnier legt ein neues Turnier mit umgeschriebenen IDs an und ersetzt alle bestehenden lokalen Turniere', async () => {
    const alteRegistry = createTurnierDbRegistry(nano);
    const altesTurnierRes = fakeRes();
    await createTurnier(alteRegistry, { body: { bezeichnung: 'Altes Turnier', ort: 'X', datum: '2025-01-01', ausrichter: 'Z' } }, altesTurnierRes);
    const alteTurnierId = altesTurnierRes.body.turnierId;

    const importDaten = {
        turnier: { bezeichnung: 'Importiertes Turnier', ort: 'Musterstadt', datum: '2026-06-01', ausrichter: 'TV Muster' },
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [{ id: 10, kampfflaeche_id: 1, bezeichnung: 'Pool A' }],
        teilnehmer: [{ id: 100, pool_id: 10, vorname: 'Max', nachname: 'Mustermann' }],
        kaempfe: [{ id: 1000, pool_id: 10, kaempfer1_id: 100, status: 'wartet' }],
        mannschaften: [],
        mannschaft_mitglieder: []
    };

    const importRes = fakeRes();
    await importTurnier(alteRegistry, { body: { contentBase64: bufferZuBase64(importDaten) } }, importRes);
    assert.equal(importRes.statusCode, 201);
    assert.ok(importRes.body.success);
    assert.deepEqual(importRes.body.imported, { kampfflaechen: 1, pools: 1, teilnehmer: 1, kaempfe: 1 });

    const neueTurnierId = importRes.body.turnierId;
    assert.notEqual(neueTurnierId, alteTurnierId);

    const alleIds = await alteRegistry.listTurnierIds();
    assert.ok(!alleIds.includes(alteTurnierId));
    assert.ok(alleIds.includes(neueTurnierId));

    const getRes = fakeRes();
    await getTurnier(alteRegistry, { params: { id: neueTurnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Importiertes Turnier');
    assert.equal(getRes.body.verein_id, OFFLINE_VEREIN_ID);
});

test('importTurnier rollt bei einem fehlerhaften Import zurück und lässt bestehende Turniere unangetastet', async () => {
    const registry = createTurnierDbRegistry(nano);
    const altesTurnierRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Bestehendes Turnier', ort: 'X', datum: '2025-01-01', ausrichter: 'Z' } }, altesTurnierRes);
    const altesTurnierId = altesTurnierRes.body.turnierId;

    // idsVorher statt eines hartcodierten [altesTurnierId]-Arrays: dieser Testlauf teilt sich
    // die CouchDB-Testinstanz mit den anderen Tests dieser Datei (siehe CLAUDE.md -- Tests
    // laufen bewusst seriell gegen eine gemeinsame DB, keine Isolation zwischen Tests), und
    // frühere Tests räumen ihre erzeugten Turnier-Datenbanken nicht immer weg. Die eigentliche
    // Zusicherung dieses Tests ist ohnehin "die Menge der VOR dem fehlerhaften Import
    // vorhandenen Turniere bleibt unverändert", nicht "es existiert exakt eines".
    const idsVorher = (await registry.listTurnierIds()).sort();

    const fehlerhafteDaten = {
        turnier: { bezeichnung: 'Fehlerhafter Import', ort: 'X', datum: '2026-01-01', ausrichter: 'Z' },
        kampfflaechen: [], pools: [], teilnehmer: [null], kaempfe: [], mannschaften: [], mannschaft_mitglieder: []
    };
    const res = fakeRes();
    await importTurnier(registry, { body: { contentBase64: bufferZuBase64(fehlerhafteDaten) } }, res);
    assert.equal(res.statusCode, 500);

    const idsNachher = (await registry.listTurnierIds()).sort();
    assert.deepEqual(idsNachher, idsVorher);
    assert.ok(idsNachher.includes(altesTurnierId));

    const getRes = fakeRes();
    await getTurnier(registry, { params: { id: altesTurnierId } }, getRes);
    assert.equal(getRes.body.bezeichnung, 'Bestehendes Turnier');
});

test('importTurnier lehnt eine Datei ohne Turnier-Pflichtfelder ab', async () => {
    const registry = createTurnierDbRegistry(nano);
    const daten = { turnier: { bezeichnung: 'Unvollständig' } };
    const res = fakeRes();
    await importTurnier(registry, { body: { contentBase64: bufferZuBase64(daten) } }, res);
    assert.equal(res.statusCode, 400);
});

test('exportTurnier liefert 403, solange die Anmeldefrist eines veröffentlichten Turniers noch nicht abgelaufen ist', async () => {
    const registry = createTurnierDbRegistry(nano);
    const createRes = fakeRes();
    await createTurnier(registry, { body: { bezeichnung: 'Export-Test', ort: 'X', datum: '2099-01-01', ausrichter: 'Z' } }, createRes);
    const turnierId = createRes.body.turnierId;
    await veroeffentlicheTurnier(registry, { params: { id: turnierId } }, fakeRes());

    const res = fakeRes();
    await exportTurnier(registry, { params: { id: turnierId } }, res);
    assert.equal(res.statusCode, 403);
});

test('exportTurnier liefert die vollständigen Wettkampfdaten eines abgeschlossenen Turniers', async () => {
    const registry = createTurnierDbRegistry(nano);
    const importDaten = {
        turnier: { bezeichnung: 'Export-Voll', ort: 'X', datum: '2020-01-01', ausrichter: 'Z', status: 'abgeschlossen' },
        kampfflaechen: [{ id: 1, bezeichnung: 'Matte 1' }],
        pools: [],
        teilnehmer: [],
        kaempfe: [],
        mannschaften: [],
        mannschaft_mitglieder: []
    };
    const importRes = fakeRes();
    await importTurnier(registry, { body: { contentBase64: bufferZuBase64(importDaten) } }, importRes);
    const turnierId = importRes.body.turnierId;

    const res = fakeRes();
    res.setHeader = () => {};
    res.send = function (body) { this.sentBody = body; return this; };
    await exportTurnier(registry, { params: { id: turnierId } }, res);

    const exportiert = JSON.parse(res.sentBody);
    assert.equal(exportiert.turnier.bezeichnung, 'Export-Voll');
    assert.equal(exportiert.kampfflaechen.length, 1);
});
