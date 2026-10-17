import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { ladeVerein } from '../../src/liveCloud/abfrage.js';

const t = (key, vorname, extra = {}) => ({
    key, vorname, nachname: 'Test', vereinKey: 'v1', verein: 'JC Muster', altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w',
    poolId: 10, poolBezeichnung: 'U15 w -44', matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3,
    naechsterKampfId: 5, platz: null, ...extra
});

let db;
before(async () => {
    db = await starteTestPostgres();
    await uebernimmPaket(db.knex, {
        version: 1, turnierKey: 'P', name: 'Prognose', datum: '2026-10-12', stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
        vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1', dauerSekunden: 200 }, { id: 2, bezeichnung: 'Matte 2' }],
        teilnehmer: [
            t('p1', 'Drei'),
            t('p2', 'Naechster', { zustand: 'als_naechstes', abstand: 0 }),
            t('p3', 'Laeuft', { zustand: 'laeuft', abstand: null }),
            t('p4', 'OhneDauer', { matteId: 2, matteBezeichnung: 'Matte 2' })
        ],
        warteschlangen: []
    });
});
after(async () => { if (db) await db.stoppe(); });

test('voraussichtlichUm: Stand plus Abstand mal Dauer der Matte, nur für wartende Kämpfe mit bekannter Dauer', async () => {
    const stand = Date.parse('2026-10-12T10:00:00.000Z');
    const liste = await ladeVerein(db.knex, 'P', 'v1');
    const nach = Object.fromEntries(liste.map(x => [x.vorname, x.voraussichtlichUm]));
    assert.equal(nach.Drei, stand + 3 * 200 * 1000);
    assert.equal(nach.Naechster, stand);
    assert.equal(nach.Laeuft, null);
    assert.equal(nach.OhneDauer, null);
});
