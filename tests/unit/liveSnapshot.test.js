import test from 'node:test';
import assert from 'node:assert/strict';
import knexLib from 'knex';
import { starteTestPostgres } from '../helpers/testPostgres.js';
import { legeLiveRolleAn } from '../../src/live/rolle.js';
import { baueSnapshot, ladeSnapshots } from '../../src/live/snapshot.js';

const turnier = { id: 7, urspruengliche_id: 42, bezeichnung: 'Sommerturnier', datum: '2026-10-12', status: 'veroeffentlicht', live_freigabe: true };
const matten = [{ id: 1, turnier_id: 7, bezeichnung: 'Matte 1' }];
const pool = (extra = {}) => ({ id: 10, turnier_id: 7, kampfflaeche_id: 1, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', typ: 'einzel', status: 'matte_zugewiesen', verspaetet: false, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', matte_reihenfolge: 1, ...extra });
const teil = (id, extra = {}) => ({ id, turnier_id: 7, pool_id: 10, gewicht_rang: id, nur_mannschaft: false, vorname: `V${id}`, nachname: `N${id}`, verein: 'JC Muster', geschlecht: 'w', altersklasse: 'U15', gewichtsklasse: '-44', status: 'kampfbereit', passnummer_hash: `hash${id}`, ...extra });
const kampf = (id, k1, k2, extra = {}) => ({ id, pool_id: 10, status: 'bereit', matten_reihenfolge: id, reihenfolge_nummer: `R${id}`, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: null, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0, mannschaftskampf_id: null, ...extra });

test('baueSnapshot: Teilnehmer mit Matte, Abstand und stabilen Schlüsseln', () => {
    const roh = { turnier, kampfflaechen: matten, pools: [pool()], teilnehmer: [teil(1), teil(2), teil(3), teil(4)], kaempfe: [kampf(1, 1, 2), kampf(2, 3, 4)] };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.version, 1);
    assert.equal(s.turnierKey, '42');
    assert.equal(s.name, 'Sommerturnier');
    const t3 = s.teilnehmer.find(t => t.vorname === 'V3');
    assert.equal(t3.zustand, 'in_n');
    assert.equal(t3.abstand, 1);
    assert.equal(t3.matteBezeichnung, 'Matte 1');
    assert.equal(t3.poolBezeichnung, 'U15 w -44');
    assert.match(t3.key, /^[0-9a-f]{24}$/);
    assert.equal('judopass_id' in t3, false);
    assert.equal('passnummer_hash' in t3, false);
    assert.equal(s.warteschlangen[0].kaempfe.length, 2);
    assert.deepEqual(s.warteschlangen[0].kaempfe[1].teilnehmerKeys, [t3.key, s.teilnehmer.find(t => t.vorname === 'V4').key]);
    // gleicher Eingang, gleicher Snapshot
    assert.deepEqual(baueSnapshot(roh, { geheimnis: 'g' }), s);
});

test('baueSnapshot: zurückgezogene Teilnehmer fehlen, Vereine zusammengefasst', () => {
    const roh = {
        turnier, kampfflaechen: matten, pools: [pool()],
        teilnehmer: [teil(1, { verein: 'JC Musterstadt' }), teil(2, { verein: 'Judoclub Musterstadt e.V.' }), teil(3, { status: 'zurueckgezogen' })],
        kaempfe: []
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.teilnehmer.length, 2);
    assert.equal(s.vereine.length, 1);
    assert.equal(s.teilnehmer[0].vereinKey, s.teilnehmer[1].vereinKey);
});

test('baueSnapshot: abgeschlossener Pool liefert Platz 1 bis 3', () => {
    const roh = {
        turnier, kampfflaechen: matten, pools: [pool({ status: 'abgeschlossen' })],
        teilnehmer: [teil(1), teil(2), teil(3)],
        kaempfe: [
            kampf(1, 1, 2, { status: 'beendet', sieger_id: 1 }),
            kampf(2, 1, 3, { status: 'beendet', sieger_id: 1 }),
            kampf(3, 2, 3, { status: 'beendet', sieger_id: 2 })
        ]
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    const platzVon = vorname => s.teilnehmer.find(t => t.vorname === vorname).platz;
    assert.deepEqual([platzVon('V1'), platzVon('V2'), platzVon('V3')], [1, 2, 3]);
    assert.ok(s.teilnehmer.every(t => t.zustand === 'abgeschlossen'));
});

test('baueSnapshot: Mannschaftsteilnehmer und Mannschafts-Pools erscheinen nicht', () => {
    const roh = {
        turnier, kampfflaechen: matten,
        pools: [pool(), pool({ id: 11, typ: 'mannschaft', bezeichnung: 'Team' })],
        teilnehmer: [teil(1), teil(2, { pool_id: 11 })],
        kaempfe: []
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.equal(s.teilnehmer.length, 1);
});

test('ladeSnapshots: nur freigegebene Turniere mit urspruengliche_id, über die Rolle live_ro', async () => {
    const db = await starteTestPostgres();
    const { knex, verbindung } = db;
    let live;
    try {
        const neu = async (extra) => (await knex('turniere').insert({ bezeichnung: 'T', ort: 'O', datum: '2026-10-12', ausrichter: 'A', ...extra }).returning('id'))[0].id;
        const frei = await neu({ live_freigabe: true, urspruengliche_id: 100 });
        await neu({ live_freigabe: true, urspruengliche_id: null });
        await neu({ live_freigabe: false, urspruengliche_id: 101 });
        const [matte] = await knex('kampfflaechen').insert({ turnier_id: frei, bezeichnung: 'Matte 1' }).returning('id');
        const [p] = await knex('pools').insert({ turnier_id: frei, kampfflaeche_id: matte.id, bezeichnung: 'P', altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44' }).returning('id');
        await knex('turnier_teilnehmer').insert({
            turnier_id: frei, pool_id: p.id, judopass_id: 'P-1', vorname: 'Anna', nachname: 'Muster', geschlecht: 'w',
            verein: 'JC', gewicht: 40, altersklasse: 'U15', gewichtsklasse: '-44', lizenz_ablauf: '2027-01-01', geburtsjahr: 2012
        });

        await legeLiveRolleAn(knex, { passwort: 'pw', datenbank: verbindung.database });
        live = knexLib({ client: 'pg', connection: { ...verbindung, user: 'live_ro', password: 'pw' } });
        const snapshots = await ladeSnapshots(live, { geheimnis: 'g' });
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].turnierKey, '100');
        assert.equal(snapshots[0].datum, '2026-10-12');
        assert.equal(snapshots[0].teilnehmer.length, 1);
        assert.equal(snapshots[0].teilnehmer[0].vorname, 'Anna');
    } finally {
        if (live) await live.destroy();
        await db.stoppe();
    }
});

test('baueSnapshot: Datum als Date-Objekt (node-pg ohne Type-Parser) wird zu YYYY-MM-DD', () => {
    const roh = { turnier: { ...turnier, datum: new Date(2026, 9, 12) }, kampfflaechen: matten, pools: [pool()], teilnehmer: [teil(1)], kaempfe: [] };
    assert.equal(baueSnapshot(roh, { geheimnis: 'g' }).datum, '2026-10-12');
});

test('baueSnapshot: Gleichstand im Jeder-gegen-Jeden wird nach Gewichtsrang entschieden wie in der Siegerliste', () => {
    const roh = {
        turnier, kampfflaechen: matten, pools: [pool({ status: 'abgeschlossen' })],
        // V3 ist der Leichteste (Rang 1), alle haben einen Sieg bei gleicher Wertung
        teilnehmer: [teil(1, { gewicht_rang: 2 }), teil(2, { gewicht_rang: 3 }), teil(3, { gewicht_rang: 1 })],
        kaempfe: [
            kampf(1, 1, 2, { status: 'beendet', sieger_id: 1 }),
            kampf(2, 2, 3, { status: 'beendet', sieger_id: 2 }),
            kampf(3, 3, 1, { status: 'beendet', sieger_id: 3 })
        ]
    };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    const platzVon = vorname => s.teilnehmer.find(t => t.vorname === vorname).platz;
    assert.equal(platzVon('V3'), 1);
    assert.equal(platzVon('V1'), 2);
    assert.equal(platzVon('V2'), 3);
});

test('baueSnapshot: Judoka, die nur in der Mannschaft starten, erscheinen nicht als Einzelteilnehmer', () => {
    const roh = { turnier, kampfflaechen: matten, pools: [pool()], teilnehmer: [teil(1), teil(2, { nur_mannschaft: true, pool_id: null })], kaempfe: [] };
    const s = baueSnapshot(roh, { geheimnis: 'g' });
    assert.deepEqual(s.teilnehmer.map(t => t.vorname), ['V1']);
});
