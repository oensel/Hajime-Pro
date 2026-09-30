import test from 'node:test';
import assert from 'node:assert/strict';
import { berechnePlatzierungen, berechneMannschaftsPlatzierungen } from '../../src/shared/platzierungen.js';

const tn = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, nachname: `N${i + 1}`, gewicht: 30 + i }));
const k = (nr, k1, k2, sieger, status = 'beendet', u1 = 0, u2 = 0) =>
    ({ reihenfolge_nummer: nr, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger, status,
       unterbewertung_kaempfer1: u1, unterbewertung_kaempfer2: u2 });
const plaetze = r => Object.fromEntries(r.eintraege.map(e => [e.teilnehmer.id, e.platz]));

test('DK8 vollständig: 1,2,3,3,5,5,7,7', () => {
    const kaempfe = [k('T1', 5, 6, 5), k('T2', 7, 8, 7), k('T3', 3, 5, 3), k('T4', 4, 7, 4), k('F', 1, 2, 1)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(8));
    assert.equal(r.abgeschlossen, true);
    assert.deepEqual(plaetze(r), { 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 7, 7: 5, 8: 7 });
});

test('DK8 Freilos in T1 erzeugt keinen Platz 7', () => {
    const kaempfe = [k('T1', 5, null, 5, 'freilos'), k('T2', 7, 8, 7), k('T3', 3, 5, 3), k('T4', 4, 7, 4), k('F', 1, 2, 1)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(8));
    assert.equal(plaetze(r)[8], 7);
    assert.equal(r.eintraege.filter(e => e.platz === 7).length, 1);
});

test('DK8 unvollständig: nur fertige Plätze, abgeschlossen=false', () => {
    const kaempfe = [k('T1', 5, 6, 5), k('T3', 3, 5, null, 'angelegt'), k('F', 1, 2, null, 'angelegt')];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, kaempfe, tn(6));
    assert.equal(r.abgeschlossen, false);
    assert.equal(plaetze(r)[6], 7);
    assert.equal(plaetze(r)[1], null);
    assert.equal(r.eintraege.at(-1).platz, null);
});

test('DK16 nutzt F1/T11/T12/T9/T10', () => {
    const kaempfe = [k('T9', 5, 6, 5), k('T10', 7, 8, 7), k('T11', 3, 5, 3), k('T12', 4, 7, 4), k('F1', 1, 2, 2)];
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-16' }, kaempfe, tn(8));
    assert.deepEqual([1, 2, 5, 6].map(i => plaetze(r)[i]), [2, 1, 5, 7]);
});

test('DK32 nutzt F1/T27/T28/T25/T26', () => {
    const kaempfe = [k('T25', 5, 6, 5), k('T26', 7, 8, 7), k('T27', 3, 5, 3), k('T28', 4, 7, 4), k('F1', 1, 2, 1)];
    assert.equal(plaetze(berechnePlatzierungen({ modus: 'Doppel-KO-32' }, kaempfe, tn(8)))[8], 7);
});

test('JGJ: Siege, dann Wertung; unvollständig → alle null', () => {
    const t = tn(3);
    const kaempfe = [k('1', 1, 2, 2, 'beendet', 0, 10), k('2', 1, 3, 1, 'beendet', 7, 0), k('3', 2, 3, 3, 'beendet', 0, 1)];
    assert.deepEqual(plaetze(berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden' }, kaempfe, t)), { 2: 1, 1: 2, 3: 3 });
    kaempfe[2].status = 'angelegt';
    const r = berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden' }, kaempfe, t);
    assert.equal(r.abgeschlossen, false);
    assert.ok(r.eintraege.every(e => e.platz === null));
});

test('ein Teilnehmer → Platz 1', () => {
    const r = berechnePlatzierungen({ modus: 'Doppel-KO-8' }, [], tn(1));
    assert.deepEqual([r.abgeschlossen, r.eintraege[0].platz], [true, 1]);
});

test('Überkreuz: F1, beide Halbfinal-Verlierer → 3, Gruppenplatz 3 → 5', () => {
    const kaempfe = [
        k('V_A_1', 1, 3, 1), k('V_A_2', 1, 5, 1), k('V_A_3', 3, 5, 3),
        k('V_B_1', 2, 4, 2), k('V_B_2', 2, 6, 2), k('V_B_3', 4, 6, 4),
        k('HF1', 1, 4, 1), k('HF2', 2, 3, 2), k('F1', 1, 2, null, 'bereit')
    ];
    let r = berechnePlatzierungen({ modus: 'Gruppen-Überkreuz' }, kaempfe, tn(6));
    assert.equal(r.abgeschlossen, false);
    assert.deepEqual(plaetze(r), { 1: null, 2: null, 3: 3, 4: 3, 5: 5, 6: 5 });

    kaempfe[8] = k('F1', 1, 2, 1);
    r = berechnePlatzierungen({ modus: 'Gruppen-Überkreuz' }, kaempfe, tn(6));
    assert.equal(r.abgeschlossen, true);
    assert.deepEqual(plaetze(r), { 1: 1, 2: 2, 3: 3, 4: 3, 5: 5, 6: 5 });
});

test('Überkreuz alt (mit kleinem Finale F2): F2 → 3/4', () => {
    const kaempfe = [
        k('V_A_1', 1, 3, 1), k('V_A_2', 1, 5, 1), k('V_A_3', 3, 5, 3),
        k('V_B_1', 2, 4, 2), k('V_B_2', 2, 6, 2), k('V_B_3', 4, 6, 4),
        k('HF1', 1, 4, 1), k('HF2', 2, 3, 2), k('F1', 1, 2, 1), k('F2', 3, 4, 4)
    ];
    const r = berechnePlatzierungen({ modus: 'Gruppen-Überkreuz' }, kaempfe, tn(6));
    assert.deepEqual(plaetze(r), { 1: 1, 2: 2, 4: 3, 3: 4, 5: 5, 6: 5 });
});

test('Mannschaft DK8 und JGJ', () => {
    const m = [1, 2, 3, 4].map(id => ({ id, bezeichnung: `M${id}` }));
    const b = (nr, a, c, s, sp1 = 0, sp2 = 0, wp1 = 0, wp2 = 0) => ({ reihenfolge_nummer: nr, mannschaft1_id: a, mannschaft2_id: c,
        sieger_mannschaft_id: s, status: 'beendet', siegpunkte_mannschaft1: sp1, siegpunkte_mannschaft2: sp2,
        wertungspunkte_mannschaft1: wp1, wertungspunkte_mannschaft2: wp2 });
    const dk = berechneMannschaftsPlatzierungen({ modus: 'Doppel-KO-8' },
        [b('T3', 3, 4, 3), b('T4', 1, 2, 1), b('F', 1, 3, 3)], m);
    assert.equal(dk.eintraege.find(e => e.mannschaft.id === 3).platz, 1);
    const jgj = berechneMannschaftsPlatzierungen({ modus: 'Jeder-gegen-Jeden' },
        [b('1', 1, 2, 1, 3, 2), b('2', 1, 3, 3, 2, 3), b('3', 2, 3, 2, 4, 1)], m.slice(0, 3));
    assert.deepEqual(jgj.eintraege.map(e => e.mannschaft.id), [2, 1, 3]);
});
