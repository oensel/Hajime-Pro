import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { pruefePaket, uebernimmPaket } from '../../src/liveCloud/ingest.js';
import { normalisiereSuche, suchtextFuer, suchbegriffe } from '../../src/liveCloud/suchtext.js';

const teilnehmer = (key, extra = {}) => ({
    key, vorname: 'Anna', nachname: 'Muster', vereinKey: 'v1', verein: 'JC Muster',
    altersklasse: 'U15', gewichtsklasse: '-44', geschlecht: 'w', poolId: 10, poolBezeichnung: 'U15 w -44',
    matteId: 1, matteBezeichnung: 'Matte 1', zustand: 'in_n', abstand: 3, naechsterKampfId: 5, platz: null, ...extra
});
const paket = (extra = {}) => ({
    version: 1, turnierKey: '77', name: 'Herbstturnier', datum: '2026-10-12', stand: '2026-10-12T10:00:00.000Z', sequenz: 1000,
    vereine: [{ key: 'v1', name: 'JC Muster' }], matten: [{ id: 1, bezeichnung: 'Matte 1' }],
    teilnehmer: [teilnehmer('a1')],
    warteschlangen: [{ matteId: 1, kaempfe: [{ id: 5, status: 'bereit', position: 0, teilnehmerKeys: ['a1', null] }] }],
    ...extra
});
const rueck = (turnierKey, sequenz) => ({ version: 1, turnierKey, zurueckgezogen: true, stand: '2026-10-12T11:00:00.000Z', sequenz });

let db;
before(async () => { db = await starteTestPostgres(); });
after(async () => { if (db) await db.stoppe(); });

test('Suchtext: Umlaute, Sonderzeichen und Mindestlänge', () => {
    assert.equal(normalisiereSuche('Müller-Lüdenscheidt'), 'mueller luedenscheidt');
    assert.match(suchtextFuer('Jörg', 'Müller'), /joerg mueller/);
    assert.match(suchtextFuer('Jörg', 'Müller'), /jorg muller/);
    assert.deepEqual(suchbegriffe('a'), []);
    assert.deepEqual(suchbegriffe('  '), []);
    assert.deepEqual(suchbegriffe('%_'), []);
    assert.deepEqual(suchbegriffe('Mus Ann'), ['mus', 'ann']);
    assert.equal(suchbegriffe('a b c d e f g').length <= 5, true);
});

test('pruefePaket: gültiges Paket und typische Fehler', () => {
    assert.equal(pruefePaket(paket()), null);
    assert.equal(pruefePaket(rueck('77', 5)), null);
    assert.match(pruefePaket(null), /Objekt/);
    assert.match(pruefePaket(paket({ version: 2 })), /Version/);
    assert.match(pruefePaket(paket({ turnierKey: '' })), /turnierKey/);
    assert.match(pruefePaket(paket({ sequenz: 'x' })), /sequenz/);
    assert.match(pruefePaket(paket({ datum: '12.10.2026' })), /datum/);
    assert.match(pruefePaket(paket({ teilnehmer: 'x' })), /teilnehmer/);
    assert.match(pruefePaket(paket({ teilnehmer: [{ key: '', zustand: 'x' }] })), /Teilnehmer/);
});

test('Snapshot wird übernommen, ein neueres ersetzt, ein älteres wird ignoriert', async () => {
    const { knex } = db;
    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T1' })), 'uebernommen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T1' })).length, 1);
    const kopf = await knex('live_turniere').where({ turnier_key: 'T1' }).first();
    assert.equal(kopf.name, 'Herbstturnier');
    assert.equal(kopf.datum, '2026-10-12');
    assert.equal((await knex('live_kampf_positionen').where({ turnier_key: 'T1' })).length, 1);

    const neuer = paket({ turnierKey: 'T1', sequenz: 2000, teilnehmer: [teilnehmer('b1', { vorname: 'Max' }), teilnehmer('b2')] });
    assert.equal(await uebernimmPaket(knex, neuer), 'uebernommen');
    assert.deepEqual((await knex('live_teilnehmer').where({ turnier_key: 'T1' }).orderBy('key')).map(z => z.key), ['b1', 'b2']);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T1', sequenz: 1500 })), 'veraltet');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T1' })).length, 2);
});

test('Rücknahme entfernt den Stand; ein verspätetes älteres Paket belebt ihn nicht, ein neueres schon', async () => {
    const { knex } = db;
    await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 100 }));
    assert.equal(await uebernimmPaket(knex, rueck('T2', 200)), 'zurueckgezogen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T2' })).length, 0);
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, true);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 150 })), 'veraltet');
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, true);

    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T2', sequenz: 300 })), 'uebernommen');
    assert.equal((await knex('live_turniere').where({ turnier_key: 'T2' }).first()).zurueckgezogen, false);
});

test('Rücknahme eines unbekannten Turniers legt einen Grabstein an', async () => {
    const { knex } = db;
    assert.equal(await uebernimmPaket(knex, rueck('T3', 50)), 'zurueckgezogen');
    assert.equal(await uebernimmPaket(knex, paket({ turnierKey: 'T3', sequenz: 40 })), 'veraltet');
});

test('doppelte Teilnehmer- und Kampfschlüssel brechen den Ingest nicht ab', async () => {
    const { knex } = db;
    const p = paket({
        turnierKey: 'T4',
        teilnehmer: [teilnehmer('d1'), teilnehmer('d1', { vorname: 'Zweite' })],
        warteschlangen: [{ matteId: 1, kaempfe: [
            { id: 9, status: 'bereit', position: 0, teilnehmerKeys: ['d1', null] },
            { id: 9, status: 'bereit', position: 1, teilnehmerKeys: ['d1', null] }
        ] }]
    });
    assert.equal(await uebernimmPaket(knex, p), 'uebernommen');
    assert.equal((await knex('live_teilnehmer').where({ turnier_key: 'T4' })).length, 1);
    assert.equal((await knex('live_kampf_positionen').where({ turnier_key: 'T4' })).length, 1);
});

test('ungültiges Paket wirft UNGUELTIG und ändert nichts', async () => {
    const { knex } = db;
    await assert.rejects(() => uebernimmPaket(knex, paket({ turnierKey: 'T5', datum: 'kaputt' })), { code: 'UNGUELTIG' });
    assert.equal(await knex('live_turniere').where({ turnier_key: 'T5' }).first(), undefined);
});
