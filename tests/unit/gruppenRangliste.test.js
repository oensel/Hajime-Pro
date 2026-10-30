import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneGruppenRangliste, berechneGruppenUeberkreuzHalbfinalPatches } from '../../src/shared/gruppenUeberkreuzProgression.js';
import { ordneEinzelRangfolge } from '../../src/shared/jgjRangfolge.js';

const k = (nr, k1, k2, sieger, u1 = 0, u2 = 0) =>
    ({ id: nr, reihenfolge_nummer: nr, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger, status: 'beendet',
       unterbewertung_kaempfer1: u1, unterbewertung_kaempfer2: u2 });
const ids = rl => rl.map(e => e.id);

// Gruppe A: Kämpfer 1, 2, 3 (Kämpfe V_A_1: 1-2, V_A_2: 1-3, V_A_3: 2-3)
test('Gruppenrangliste ohne Gleichstand: Siege entscheiden', () => {
    const rl = berechneGruppenRangliste([k('V_A_1', 1, 2, 1, 10), k('V_A_2', 1, 3, 1, 10), k('V_A_3', 2, 3, 2, 10)], 'V_A_');
    assert.deepEqual(ids(rl), [1, 2, 3]);
    assert.equal(rl.some(e => e.gleichstand), false);
    assert.deepEqual(rl.map(e => [e.siege, e.unterbewertung]), [[2, 20], [1, 10], [0, 0]]);
});

test('Gruppenrangliste: je 1 Sieg, die Wertungspunkte entscheiden vor dem direkten Vergleich', () => {
    // 1 schlägt 2 (5), 2 schlägt 3 (10), 3 schlägt 1 (7)
    const rl = berechneGruppenRangliste([k('V_A_1', 1, 2, 1, 5), k('V_A_2', 1, 3, 3, 0, 7), k('V_A_3', 2, 3, 2, 10)], 'V_A_');
    assert.deepEqual(ids(rl), [2, 3, 1]);
    assert.equal(rl.some(e => e.gleichstand), false);
});

test('Gruppenrangliste: Punktgleiche werden über den direkten Vergleich geordnet', () => {
    // 1 schlägt 2 (10), 2 schlägt 3 (10), 3 schlägt 1 (5): 1 und 2 je 1 Sieg/10, 3 hat 1 Sieg/5
    // Reihenfolge der Kampfanlage hätte 2 vor 1 gesetzt (2 erscheint zuerst) – hier gewinnt der direkte Vergleich
    const rl = berechneGruppenRangliste([k('V_A_1', 2, 1, 1, 0, 10), k('V_A_2', 1, 3, 3, 0, 5), k('V_A_3', 2, 3, 2, 10)], 'V_A_');
    assert.deepEqual(ids(rl), [1, 2, 3]);
    assert.equal(rl.some(e => e.gleichstand), false);
});

test('Gruppenrangliste: echter Dreierkreis bleibt Gleichstand in Reihenfolge der Kampfanlage', () => {
    const rl = berechneGruppenRangliste([k('V_A_1', 1, 2, 1, 10), k('V_A_2', 1, 3, 3, 0, 10), k('V_A_3', 2, 3, 2, 10)], 'V_A_');
    assert.deepEqual(ids(rl), [1, 2, 3]);
    assert.equal(rl.every(e => e.gleichstand), true);
});

test('Halbfinale: der direkte Vergleich bestimmt, wer aus Gruppe A weiterkommt', () => {
    // Gruppe A wie im Test davor (1 vor 2 vor 3), Gruppe B klar 4 > 5 > 6
    const vorrunde = [
        k('V_A_1', 2, 1, 1, 0, 10), k('V_A_2', 1, 3, 3, 0, 5), k('V_A_3', 2, 3, 2, 10),
        k('V_B_1', 4, 5, 4, 10), k('V_B_2', 4, 6, 4, 10), k('V_B_3', 5, 6, 5, 10)
    ];
    const hf1 = { id: 101, reihenfolge_nummer: 'HF1', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null };
    const hf2 = { id: 102, reihenfolge_nummer: 'HF2', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null };
    const patches = berechneGruppenUeberkreuzHalbfinalPatches([...vorrunde, hf1, hf2]);
    assert.deepEqual(patches.map(p => [p.kaempfer1_id, p.kaempfer2_id]), [[1, 5], [4, 2]]);
});

test('ordneEinzelRangfolge: leere und einzelne Kämpfer', () => {
    assert.deepEqual(ordneEinzelRangfolge([], []).reihenfolge, []);
    const r = ordneEinzelRangfolge([7], []);
    assert.deepEqual(r.reihenfolge, [7]);
    assert.equal(r.gleichstand.size, 0);
});
