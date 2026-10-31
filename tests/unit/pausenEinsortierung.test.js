import test from 'node:test';
import assert from 'node:assert/strict';
import { findeEinfuegeIndex } from '../../src/shared/pausenEinsortierung.js';

const kampf = (id, k1, k2, dauer = 120) => ({ id, kaempfer1_id: k1, kaempfer2_id: k2, dauer });
// sechs Kämpfe fremder Kämpfer, je 2 Minuten
const fremde = (n) => Array.from({ length: n }, (_, i) => kampf(`o${i + 1}`, 100 + 2 * i, 101 + 2 * i));
const PAUSE = 360; // U15 und jünger: 6 Minuten

test('leere Matte: der Kampf kommt als Nächstes', () => {
    const r = findeEinfuegeIndex({ neu: kampf('s', 1, 2), pausenSekunden: PAUSE });
    assert.deepEqual(r, { index: 0, defizit: 0 });
});

test('Kämpfer ohne Vorkampf auf der Matte: so früh wie möglich', () => {
    const r = findeEinfuegeIndex({ neu: kampf('s', 1, 2), vorher: [kampf('v', 3, 4)], warteschlange: fremde(4), pausenSekunden: PAUSE });
    assert.equal(r.index, 0);
});

test('Pause nach dem letzten Kampf: erst nach drei Kämpfen dazwischen (6 Min Pause, 2 Min je Kampf)', () => {
    // A kämpfte als Letzter (Ende bei 120 s), er darf frühestens bei 480 s wieder: drei Kämpfe à 120 s dazwischen
    const r = findeEinfuegeIndex({ neu: kampf('s', 1, 2), vorher: [kampf('v', 1, 3)], warteschlange: fremde(5), pausenSekunden: PAUSE });
    assert.equal(r.index, 3);
    assert.ok(r.defizit <= 0);
});

test('keine Kämpfe mehr dazwischen möglich: Stelle mit dem kleinsten Defizit, Defizit bleibt sichtbar', () => {
    const r = findeEinfuegeIndex({ neu: kampf('s', 1, 2), vorher: [kampf('v', 1, 3)], warteschlange: [], pausenSekunden: PAUSE });
    assert.equal(r.index, 0);
    assert.equal(r.defizit, PAUSE);
});

test('ein späterer Kampf desselben Kämpfers liegt nicht direkt hinter dem neuen', () => {
    // Warteschlange: X-Y, dann A-C. Neuer Kampf A-B: an Stelle 0 liegen 120 s Pause zu A-C (Defizit 240),
    // an den Stellen 1 und 2 grenzt er direkt an A-C (Defizit 360).
    const r = findeEinfuegeIndex({ neu: kampf('s', 1, 2), warteschlange: [kampf('x', 10, 11), kampf('ac', 1, 3)], pausenSekunden: PAUSE });
    assert.deepEqual(r, { index: 0, defizit: 240 });
});

test('Stichkämpfe eines Dreierkreises werden mit Kämpfen anderer dazwischen verteilt', () => {
    const paare = [[1, 2], [2, 3], [1, 3]];
    let warteschlange = fremde(8);
    const stellen = [];
    paare.forEach(([a, b], i) => {
        const neu = kampf(`s${i + 1}`, a, b);
        const { index } = findeEinfuegeIndex({ neu, warteschlange, pausenSekunden: PAUSE });
        warteschlange = [...warteschlange.slice(0, index), neu, ...warteschlange.slice(index)];
        stellen.push(index);
    });
    // s1 sofort, s2 (Kämpfer 2 war eben dran) nach s1 und drei Kämpfen, s3 nach s2 und drei weiteren Kämpfen
    assert.deepEqual(stellen, [0, 4, 8]);
    const reihenfolge = warteschlange.map(k => k.id);
    assert.deepEqual(reihenfolge.slice(0, 9), ['s1', 'o1', 'o2', 'o3', 's2', 'o4', 'o5', 'o6', 's3']);
});
