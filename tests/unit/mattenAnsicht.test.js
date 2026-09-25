import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueMattenAnsicht } from '../../src/shared/mattenAnsicht.js';

const pools = [
    { id: 1, kampfflaeche_id: 10, bezeichnung: 'U18 -73', kampfzeit_sekunden: 240, altersklasse: 'U18', golden_score_aktiv: 1, golden_score_max_sekunden: null, typ: 'einzel', status: 'gestartet' },
    { id: 2, kampfflaeche_id: 10, bezeichnung: 'Team U15', kampfzeit_sekunden: 180, altersklasse: 'U15', golden_score_aktiv: 1, golden_score_max_sekunden: 180, typ: 'mannschaft', status: 'gestartet' },
    { id: 3, kampfflaeche_id: 11, bezeichnung: 'andere Matte', kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet' }
];
const teilnehmer = [
    { id: 100, vorname: 'Anna', nachname: 'Adler', verein: 'JC A' },
    { id: 101, vorname: 'Berta', nachname: 'Busch', verein: 'JC B' }
];
const kaempfe = [
    { id: 6, pool_id: 1, status: 'bereit', matten_reihenfolge: 2, kaempfer1_id: 100, kaempfer2_id: 101 },
    { id: 5, pool_id: 1, status: 'beendet', matten_reihenfolge: 1, kaempfer1_id: 100, kaempfer2_id: 101, updated_at: '2026-09-25T10:00:00.000Z' },
    { id: 7, pool_id: 2, status: 'angelegt', matten_reihenfolge: null, mannschaftskampf_id: 50, mannschaft_gewichtsklasse: '-50' },
    { id: 8, pool_id: 3, status: 'bereit', matten_reihenfolge: 1 }
];
const mannschaftskaempfe = [{ id: 50, mannschaft1_id: 70, mannschaft2_id: 71, siegpunkte_mannschaft1: 1, siegpunkte_mannschaft2: 0 }];
const mannschaften = [{ id: 70, bezeichnung: 'Team A', verein: 'JC A' }, { id: 71, bezeichnung: 'Team B', verein: 'JC B' }];
const daten = { kaempfe, pools, teilnehmer, mannschaftskaempfe, mannschaften };
const JETZT = Date.parse('2026-09-25T10:02:00Z');

test('liefert nur Kämpfe der Matte, sortiert nach matten_reihenfolge (NULL zuletzt), dann id', () => {
    const ansicht = baueMattenAnsicht(daten, 10, JETZT);
    assert.deepEqual(ansicht.map(k => k.id), [5, 6, 7]);
});

test('reichert Pool-, Kämpfer- und Mannschaftsfelder an', () => {
    const ansicht = baueMattenAnsicht(daten, 10, JETZT);
    const k6 = ansicht.find(k => k.id === 6);
    assert.equal(k6.pool_bezeichnung, 'U18 -73');
    assert.equal(k6.pool_kampfzeit, 240);
    assert.equal(k6.kaempfer1_nachname, 'Adler');
    assert.equal(k6.kaempfer2_verein, 'JC B');
    const k7 = ansicht.find(k => k.id === 7);
    assert.equal(k7.pool_bezeichnung, 'Team U15 -50 kg');
    assert.equal(k7.mannschaft1_bezeichnung, 'Team A');
    assert.equal(k7.siegpunkte_mannschaft1, 1);
    assert.equal(k7.wartet_auf_einzelpools, true);
});

test('Pausenwarnung für bereit-Kampf zwei Minuten nach dem letzten Kampfende (U18: 10 Min.)', () => {
    const ansicht = baueMattenAnsicht(daten, 10, JETZT);
    assert.notEqual(ansicht.find(k => k.id === 6).pausenwarnung, null);
    assert.equal(ansicht.find(k => k.id === 5).pausenwarnung, null);
});
