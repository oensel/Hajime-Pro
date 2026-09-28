import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneKaskadenPatches } from '../../src/shared/kaskadeDokumente.js';

// Mini-Bracket: H1 (1 vs 2), H2 (3 vs 4) -> F (Sieger H1 vs Sieger H2) -> Platz3-Kampf P
// (Verlierer F vs ... hier: Verlierer H1 vs Verlierer H2, um zwei Stufen Kaskade zu prüfen).
function bracket() {
    return [
        { id: 1, status: 'beendet', kaempfer1_id: 11, kaempfer2_id: 12, sieger_id: 11 },
        { id: 2, status: 'bereit', kaempfer1_id: 13, kaempfer2_id: 14, sieger_id: null },
        { id: 3, status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null, kaempfer1_quelle_kampf_id: 1, kaempfer1_quelle_typ: 'sieger', kaempfer2_quelle_kampf_id: 2, kaempfer2_quelle_typ: 'sieger' },
        { id: 4, status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null, kaempfer1_quelle_kampf_id: 3, kaempfer1_quelle_typ: 'verlierer', kaempfer2_quelle_kampf_id: 1, kaempfer2_quelle_typ: 'verlierer' }
    ];
}

test('keine Patches, solange eine Quelle noch offen ist', () => {
    assert.equal(berechneKaskadenPatches(bracket()).size, 0);
});

test('Folgekampf wird befüllt und bereit, sobald beide Quellen feststehen', () => {
    const kaempfe = bracket();
    Object.assign(kaempfe[1], { status: 'beendet', sieger_id: 14 });
    const patches = berechneKaskadenPatches(kaempfe);
    assert.deepEqual(patches.get(3), { kaempfer1_id: 11, kaempfer2_id: 14, status: 'bereit' });
    assert.equal(patches.has(4), false);
});

test('iteriert bis zum Fixpunkt über mehrere Stufen', () => {
    const kaempfe = bracket();
    Object.assign(kaempfe[1], { status: 'beendet', sieger_id: 14 });
    Object.assign(kaempfe[2], { status: 'beendet', kaempfer1_id: 11, kaempfer2_id: 14, sieger_id: 11 });
    const patches = berechneKaskadenPatches(kaempfe);
    assert.deepEqual(patches.get(4), { kaempfer1_id: 14, kaempfer2_id: 12, status: 'bereit' });
});

test('verändert die Eingabe nicht', () => {
    const kaempfe = bracket();
    Object.assign(kaempfe[1], { status: 'beendet', sieger_id: 14 });
    const vorher = JSON.stringify(kaempfe);
    berechneKaskadenPatches(kaempfe);
    assert.equal(JSON.stringify(kaempfe), vorher);
});
