import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { listeTurniere, ladeTurnier, suche, ladePool, ladeVerein, uebersicht, listePools, ladeDashboard, MAX_SCHLUESSEL } from '../../src/liveCloud/abfrage.js';

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

const poolDef = (id, extra = {}) => ({ id, bezeichnung: `Pool ${id}`, modus: 'Jeder-gegen-Jeden', status: 'matte_zugewiesen', matteId: 1, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', farbe2: 'blau', ...extra });
const kampfDef = (id, poolId, extra = {}) => ({ id, poolId, nr: `R${id}`, status: 'bereit', reihenfolge: id, k1: null, k2: null, sieger: null, p1: 0, p2: 0, ...extra });

test('Pools, Pool mit Kämpfen, Klassen und Dashboard', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket('D', '2026-10-12', [
        t('x1', 'Anna', 'Muster'), t('x2', 'Mia', 'Mustermann'), t('x3', 'Lea', 'Koch'), t('x4', 'Jule', 'Berg')
    ], {
        matten: [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }],
        pools: [
            poolDef(10, { bezeichnung: 'U15 w -44', gewichtsklasse: '-44' }),
            poolDef(11, { bezeichnung: 'U15 w +48', gewichtsklasse: '+48', matteId: 1 }),
            poolDef(12, { bezeichnung: 'U15 m -50', geschlecht: 'm', gewichtsklasse: '-50', matteId: 2, farbe2: 'rot' }),
            poolDef(13, { bezeichnung: 'U11 w -30', altersklasse: 'U11', gewichtsklasse: '-30', matteId: null })
        ],
        kaempfe: [
            kampfDef(1, 10, { status: 'beendet', k1: 'x1', k2: 'x2', sieger: 'x1', p1: 7 }),
            kampfDef(2, 10, { status: 'gestartet', k1: 'x3', k2: 'x4' }),
            kampfDef(3, 10, { status: 'bereit', k1: 'x1', k2: 'x3' }),
            kampfDef(4, 11, { status: 'bereit', k1: 'x2', k2: 'x4', reihenfolge: 4 }),
            kampfDef(5, 11, { status: 'bereit', k1: 'x1', k2: 'x4', reihenfolge: null }),
            kampfDef(6, 12, { status: 'bereit', k1: 'x1', k2: 'x2' }),
            kampfDef(7, 10, { status: 'freilos', k1: 'x4', k2: null, sieger: 'x4' })
        ]
    }));
    for (const x of ['x1', 'x2', 'x3', 'x4']) {
        await knex('live_teilnehmer').where({ turnier_key: 'D', key: x }).update({ pool_id: 10 });
    }

    const pools = await listePools(knex, 'D');
    assert.deepEqual(pools.map(p => p.poolId), [10, 11, 12, 13]);
    const p10 = pools.find(p => p.poolId === 10);
    assert.equal(p10.gesamt, 4);
    assert.equal(p10.beendet, 2);
    assert.equal(p10.laeuft, 1);
    assert.equal(p10.teilnehmer, 4);
    assert.equal(p10.matteBezeichnung, 'Matte 1');
    assert.equal(pools.find(p => p.poolId === 13).matteId, null);

    const turnier = await ladeTurnier(knex, 'D');
    const u15w = turnier.klassen.find(k => k.altersklasse === 'U15' && k.geschlecht === 'w');
    assert.deepEqual(u15w.pools.map(p => p.gewichtsklasse), ['-44', '+48']);
    assert.deepEqual(turnier.klassen.map(k => `${k.altersklasse}${k.geschlecht}`), ['U11w', 'U15m', 'U15w']);

    const pool = await ladePool(knex, 'D', 10);
    assert.equal(pool.pool.modus, 'Jeder-gegen-Jeden');
    assert.equal(pool.kaempfe.length, 4);
    const k2 = pool.kaempfe.find(k => k.id === 2);
    assert.deepEqual(k2.k1, { key: 'x3', name: 'Lea Koch', verein: 'JC Muster' });
    assert.equal(k2.abstand, 0);
    assert.equal(pool.kaempfe.find(k => k.id === 3).abstand, 1);
    assert.equal(pool.kaempfe.find(k => k.id === 1).abstand, null);
    assert.equal(pool.kaempfe.find(k => k.id === 7).k2, null);
    assert.equal(pool.kaempfe.find(k => k.id === 1).sieger, 'x1');

    const d = await ladeDashboard(knex, 'D');
    const m1 = d.matten.find(m => m.id === 1);
    assert.equal(m1.laufend.id, 2);
    assert.equal(m1.laufend.poolBezeichnung, 'U15 w -44');
    assert.equal(m1.laufend.k1.name, 'Lea Koch');
    assert.deepEqual(m1.naechste.map(k => k.id), [3, 4, 5]);
    assert.deepEqual(m1.pools.map(p => [p.poolId, p.gesamt, p.beendet]), [[10, 4, 2], [11, 2, 0]]);
    const m2 = d.matten.find(m => m.id === 2);
    assert.equal(m2.laufend, null);
    assert.equal(m2.farbe2, 'rot');
    assert.deepEqual(d.warteschlange, [{ poolId: 13, bezeichnung: 'U11 w -30' }]);
});

test('Ältere Halle ohne Pools und Kämpfe: leere Antworten statt Fehler', async () => {
    const { knex } = db;
    assert.deepEqual(await listePools(knex, 'A'), []);
    const d = await ladeDashboard(knex, 'A');
    assert.deepEqual(d.matten.map(m => m.laufend), [null]);
    assert.deepEqual(d.warteschlange, []);
    assert.deepEqual((await ladeTurnier(knex, 'A')).klassen, []);
    const pool = await ladePool(knex, 'A', 10);
    assert.deepEqual(pool.kaempfe, []);
    assert.equal(pool.pool.modus, '');
    assert.equal(await ladeDashboard(knex, 'gibtsnicht'), null);
});
