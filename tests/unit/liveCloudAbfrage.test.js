import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht, MAX_SCHLUESSEL } from '../../src/liveCloud/abfrage.js';

const t = (key, vorname, nachname, extra = {}) => ({
    key, vorname, nachname, vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});
const paket = (turnierKey, datum, teilnehmer, extra = {}) => ({
    version: 1, turnierKey, name: `Turnier ${turnierKey}`, datum, stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }, { key: 'v2', name: 'TV Beispiel' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer, warteschlangen: [], ...extra
});

let db;
before(async () => {
    db = await starteTestPostgres();
    await uebernimmPaket(db.knex, paket('A', '2026-10-12', [
        t('a1', 'Anna', 'Muster'),
        t('a2', 'Max', 'Müller', { poolId: 11, poolBezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', zustand: 'laeuft', abstand: null }),
        t('a3', 'Lena', 'Beispiel', { vereinKey: 'v2', verein: 'TV Beispiel', poolId: null, poolBezeichnung: '', matteId: null, matteBezeichnung: '', zustand: 'nicht_ausgelost', abstand: null }),
        t('a4', 'Tom', 'Abschluss', { poolId: 11, poolBezeichnung: 'U15 m -50', zustand: 'abgeschlossen', abstand: null, platz: 2 })
    ]));
    await uebernimmPaket(db.knex, paket('B', '2026-10-05', [t('b1', 'Alt', 'Turnier')]));
    await uebernimmPaket(db.knex, paket('C', '2026-10-12', [t('c1', 'Weg', 'Genommen')]));
    await uebernimmPaket(db.knex, { version: 1, turnierKey: 'C', zurueckgezogen: true, stand: '2026-10-12T12:00:00.000Z', sequenz: 2000 });
});
after(async () => { if (db) await db.stoppe(); });

test('listeTurniere: heutiges zuerst, zurückgezogene fehlen', async () => {
    const liste = await listeTurniere(db.knex, { jetzt: () => new Date('2026-10-12T09:00:00Z') });
    assert.deepEqual(liste.map(x => x.key), ['A', 'B']);
    const spaeter = await listeTurniere(db.knex, { jetzt: () => new Date('2026-10-05T09:00:00Z') });
    assert.deepEqual(spaeter.map(x => x.key), ['B', 'A']);
    assert.equal(liste[0].name, 'Turnier A');
});

test('ladeTurnier: Vereine mit Anzahl, unbekannte und zurückgezogene Turniere sind null', async () => {
    const turnier = await ladeTurnier(db.knex, 'A');
    assert.equal(turnier.name, 'Turnier A');
    assert.deepEqual(turnier.vereine, [{ key: 'v1', name: 'JC Muster', anzahl: 3 }, { key: 'v2', name: 'TV Beispiel', anzahl: 1 }]);
    assert.equal(await ladeTurnier(db.knex, 'gibtsnicht'), null);
    assert.equal(await ladeTurnier(db.knex, 'C'), null);
});

test('suche: Teiltreffer, Umlaute, mehrere Begriffe', async () => {
    assert.deepEqual((await suche(db.knex, 'A', 'mus')).map(x => x.key), ['a1']);
    assert.deepEqual((await suche(db.knex, 'A', 'mueller')).map(x => x.key), ['a2']);
    assert.deepEqual((await suche(db.knex, 'A', 'muller')).map(x => x.key), ['a2']);
    assert.deepEqual((await suche(db.knex, 'A', 'anna mus')).map(x => x.key), ['a1']);
    assert.deepEqual((await suche(db.knex, 'A', 'max anna')).map(x => x.key), []);
});

test('suche: Platzhalter, ein Zeichen und leerer Text liefern nie die Liste', async () => {
    for (const eingabe of ['%', '_', '%%', 'a', '', '   ', "' OR 1=1 --"]) {
        assert.deepEqual(await suche(db.knex, 'A', eingabe), [], `Eingabe ${JSON.stringify(eingabe)}`);
    }
});

test('suche: DTO enthält Pool, Matte, Zustand, aber keine Interna', async () => {
    const [treffer] = await suche(db.knex, 'A', 'anna');
    assert.deepEqual(treffer, {
        key: 'a1', vorname: 'Anna', nachname: 'Muster', verein: 'JC Muster', vereinKey: 'v1', altersklasse: 'U15',
        gewichtsklasse: '-44', geschlecht: 'w', poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1',
        zustand: 'in_n', abstand: 3, platz: null
    });
});

test('ladePool und ladeVerein', async () => {
    const pool = await ladePool(db.knex, 'A', 11);
    assert.equal(pool.pool.bezeichnung, 'U15 m -50');
    assert.deepEqual(pool.teilnehmer.map(x => x.key), ['a4', 'a2']);
    assert.equal(await ladePool(db.knex, 'A', 999), null);
    assert.deepEqual((await ladeVerein(db.knex, 'A', 'v2')).map(x => x.key), ['a3']);
    assert.deepEqual(await ladeVerein(db.knex, 'A', 'gibtsnicht'), []);
});

test('uebersicht: Teilnehmer und Vereinsregel, Dubletten, unbekannte Schlüssel, leer', async () => {
    const r = await uebersicht(db.knex, 'A', { teilnehmer: ['a2', 'a2', 'unbekannt'], vereine: ['v2'] });
    assert.deepEqual(r.map(x => x.key).sort(), ['a2', 'a3']);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: [], vereine: [] }), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', {}), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: 'a1', vereine: 7 }), []);
    assert.deepEqual(await uebersicht(db.knex, 'A', { teilnehmer: [1, null, {}] }), []);
    assert.deepEqual(await uebersicht(db.knex, 'C', { teilnehmer: ['c1'] }), []);
});

test('uebersicht: mehr als MAX_SCHLUESSEL Schlüssel werden abgeschnitten, nicht abgelehnt', async () => {
    const viele = Array.from({ length: MAX_SCHLUESSEL + 50 }, (_, i) => `k${i}`);
    viele[0] = 'a1';
    const r = await uebersicht(db.knex, 'A', { teilnehmer: viele });
    assert.deepEqual(r.map(x => x.key), ['a1']);
});
