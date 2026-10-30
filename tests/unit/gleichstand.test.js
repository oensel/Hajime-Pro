import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeGleichstand, entscheideNachSiegzeit, siegzeiten, stichkampfPaarungen, leseEntscheidung } from '../../src/shared/gleichstand.js';
import { berechneGruppenUeberkreuzHalbfinalPatches } from '../../src/shared/gruppenUeberkreuzProgression.js';
import { berechnePlatzierungen } from '../../src/shared/platzierungen.js';

// k(nr, k1, k2, sieger, Punkte des Siegers, Kampfzeit, Status)
const k = (nr, k1, k2, sieger, punkte = 10, zeit = 60, status = 'beendet') => ({
    id: nr, reihenfolge_nummer: nr, kaempfer1_id: k1, kaempfer2_id: k2, sieger_id: sieger, status, kampfzeit_in_sekunden: zeit,
    unterbewertung_kaempfer1: sieger === k1 ? punkte : 0, unterbewertung_kaempfer2: sieger === k2 ? punkte : 0
});
// Dreierkreis 1 schlägt 2, 2 schlägt 3, 3 schlägt 1 mit den Siegzeiten z1, z2, z3 (Sekunden)
const kreis = (z1 = 30, z2 = 50, z3 = 70) => [k('1', 1, 2, 1, 10, z1), k('2', 2, 3, 2, 10, z2), k('3', 3, 1, 3, 10, z3)];

test('pruefeGleichstand: Dreierkreis im Pool ist offen, mit Plätzen, Paarungen und Siegzeit-Vorschau', () => {
    const p = pruefeGleichstand([1, 2, 3], kreis(), { bis: 3 });
    assert.equal(p.bereit, true);
    assert.equal(p.offen, true);
    assert.equal(p.bloecke.length, 1);
    const b = p.bloecke[0];
    assert.deepEqual([b.vonPlatz, b.bisPlatz], [1, 3]);
    assert.deepEqual(b.paarungen, [[1, 2], [1, 3], [2, 3]]);
    assert.deepEqual(b.siegzeitReihenfolge, [1, 2, 3]);
    assert.equal(b.siegzeitEindeutig, true);
});

test('pruefeGleichstand: Gleichstand auf Platz 4 und 5 ist im Pool nicht relevant', () => {
    // 1: 5 Siege, 2: 4, 3: 3; 4, 5 und 6 bilden einen Kreis (je 1 Sieg gegen die anderen drei Kämpfer 4-6 ... und Niederlagen gegen 1-3)
    const ks = [
        k('a', 1, 2, 1), k('b', 1, 3, 1), k('c', 1, 4, 1), k('d', 1, 5, 1), k('e', 1, 6, 1),
        k('f', 2, 3, 2), k('g', 2, 4, 2), k('h', 2, 5, 2), k('i', 2, 6, 2),
        k('j', 3, 4, 3), k('l', 3, 5, 3), k('m', 3, 6, 3),
        k('n', 4, 5, 4), k('o', 5, 6, 5), k('p', 6, 4, 6)
    ];
    const p = pruefeGleichstand([1, 2, 3, 4, 5, 6], ks, { bis: 3 });
    assert.equal(p.offen, false);
});

test('pruefeGleichstand: Gleichstand auf Platz 3 bis 5 ist relevant', () => {
    // 1 und 2 klar vorn, 3, 4 und 5 im Kreis
    const ks = [k('a', 1, 2, 1), k('b', 1, 3, 1), k('c', 1, 4, 1), k('d', 1, 5, 1), k('e', 2, 3, 2), k('f', 2, 4, 2), k('g', 2, 5, 2),
        k('h', 3, 4, 3), k('i', 4, 5, 4), k('j', 5, 3, 5)];
    const p = pruefeGleichstand([1, 2, 3, 4, 5], ks, { bis: 3 });
    assert.equal(p.offen, true);
    assert.deepEqual([p.bloecke[0].vonPlatz, p.bloecke[0].bisPlatz], [3, 5]);
});

test('pruefeGleichstand: solange Kämpfe offen sind, ist nicht bereit und nichts offen', () => {
    const ks = [...kreis().slice(0, 2), k('3', 3, 1, null, 0, 0, 'bereit')];
    const p = pruefeGleichstand([1, 2, 3], ks, { bis: 3 });
    assert.equal(p.bereit, false);
    assert.equal(p.offen, false);
});

test('pruefeGleichstand: Siegzeit entscheidet nicht bei gleicher Zeit auf einem relevanten Platz', () => {
    const p = pruefeGleichstand([1, 2, 3], kreis(30, 30, 70), { bis: 3 });
    assert.equal(p.bloecke[0].siegzeitEindeutig, false);
    assert.equal(entscheideNachSiegzeit(p), null);
});

test('pruefeGleichstand: gleiche Siegzeit auf einem nicht relevanten Platz stört nicht', () => {
    // nur Platz 1 relevant (bis 1): 1 hat die kürzeste Zeit, 2 und 3 sind gleich
    const p = pruefeGleichstand([1, 2, 3], kreis(30, 70, 70), { bis: 1 });
    assert.equal(p.bloecke[0].siegzeitEindeutig, true);
    assert.equal(entscheideNachSiegzeit(p)[0][0], 1);
});

test('Entscheidung nach Siegzeit wird gespeichert und angewendet: kein offener Gleichstand mehr', () => {
    const p = pruefeGleichstand([1, 2, 3], kreis(70, 30, 50), { bis: 3 });
    const entscheidung = entscheideNachSiegzeit(p);
    assert.deepEqual(entscheidung, [[2, 3, 1]]);
    const danach = pruefeGleichstand([1, 2, 3], kreis(70, 30, 50), { bis: 3, entscheidung });
    assert.equal(danach.offen, false);
});

test('siegzeiten summiert nur gewonnene, beendete Kämpfe; Paarungen und leseEntscheidung', () => {
    const z = siegzeiten([k('1', 1, 2, 1, 10, 40), k('2', 1, 3, 1, 10, 25), k('3', 2, 3, 2, 10, 99, 'bereit')], [1, 2, 3]);
    assert.deepEqual([...z], [[1, 65], [2, 0], [3, 0]]);
    assert.deepEqual(stichkampfPaarungen([7, 8]), [[7, 8]]);
    assert.equal(stichkampfPaarungen([1, 2, 3, 4]).length, 6);
    assert.deepEqual(leseEntscheidung('{"A":[[1,2]]}'), { A: [[1, 2]] });
    assert.deepEqual(leseEntscheidung('kaputt'), {});
    assert.deepEqual(leseEntscheidung(null), {});
});

// Überkreuz: Gruppe A = Kämpfer 1, 2, 3 (Kreis), Gruppe B = 4, 5, 6 klar 4 vor 5 vor 6
const vorrunde = (zeiten = [30, 50, 70]) => [
    k('V_A_1', 1, 2, 1, 10, zeiten[0]), k('V_A_2', 3, 1, 3, 10, zeiten[2]), k('V_A_3', 2, 3, 2, 10, zeiten[1]),
    k('V_B_1', 4, 5, 4), k('V_B_2', 4, 6, 4), k('V_B_3', 5, 6, 5)
];
const hfs = [{ id: 101, reihenfolge_nummer: 'HF1', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null },
    { id: 102, reihenfolge_nummer: 'HF2', status: 'angelegt', kaempfer1_id: null, kaempfer2_id: null }];
const hf = (kaempfe, optionen) => berechneGruppenUeberkreuzHalbfinalPatches([...kaempfe, ...hfs], optionen);

test('Halbfinale: Dreierkreis in Gruppe A sperrt HF1 und HF2', () => {
    assert.deepEqual(hf(vorrunde()), []);
});

test('Halbfinale: mit Entscheidung für Gruppe A wird besetzt (Objekt oder JSON-Text)', () => {
    const entscheidung = { A: [[1, 2, 3]] };
    const patches = hf(vorrunde(), { entscheidung });
    assert.deepEqual(patches.map(p => [p.kaempfer1_id, p.kaempfer2_id]), [[1, 5], [4, 2]]);
    assert.equal(hf(vorrunde(), { entscheidung: JSON.stringify(entscheidung) }).length, 2);
});

test('Halbfinale: ein offener Stichkampf der Gruppe sperrt, danach wird neu geprüft', () => {
    const offen = [...vorrunde(), k('V_A_S1', 1, 2, null, 0, 0, 'bereit')];
    assert.deepEqual(hf(offen), []);
    // Stichkämpfe 1-2, 2-3, 1-3: 1 gewinnt beide, 2 gewinnt gegen 3 -> 1 vor 2 vor 3 eindeutig
    const fertigeStich = [...vorrunde(), k('V_A_S1', 1, 2, 1), k('V_A_S2', 2, 3, 2), k('V_A_S3', 1, 3, 1)];
    const patches = hf(fertigeStich);
    assert.deepEqual(patches.map(p => [p.kaempfer1_id, p.kaempfer2_id]), [[1, 5], [4, 2]]);
});

test('Halbfinale: Stichkämpfe mit erneutem Kreis bleiben gesperrt', () => {
    const wieder = [...vorrunde(), k('V_A_S1', 1, 2, 1), k('V_A_S2', 2, 3, 2), k('V_A_S3', 3, 1, 3)];
    assert.deepEqual(hf(wieder), []);
});

test('Platzierungen: Entscheidung aus pools.gleichstand_entscheidung ordnet den Pool und beendet den Gleichstand', () => {
    const teilnehmer = [{ id: 1, gewicht: 30 }, { id: 2, gewicht: 31 }, { id: 3, gewicht: 32 }];
    const ohne = berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden' }, kreis(), teilnehmer);
    assert.equal(ohne.eintraege.every(e => e.gleichstand), true);
    const mit = berechnePlatzierungen({ modus: 'Jeder-gegen-Jeden', gleichstand_entscheidung: JSON.stringify({ pool: [[3, 1, 2]] }) }, kreis(), teilnehmer);
    assert.deepEqual(mit.eintraege.map(e => [e.platz, e.teilnehmer.id]), [[1, 3], [2, 1], [3, 2]]);
    assert.equal(mit.eintraege.some(e => e.gleichstand), false);
});
