import test from 'node:test';
import assert from 'node:assert/strict';
import { verteilePoolsAufMatten } from '../../src/services/mattenVerteilung.js';

let nextId = 1;
const pool = (geschlecht, altersklasse, gewichtsklasse, dauer, extra = {}) =>
    ({ id: nextId++, geschlecht, altersklasse, gewichtsklasse, dauer_minuten: dauer, ...extra });
const matten = (n) => Array.from({ length: n }, (_, i) => ({ id: 100 + i }));
const ids = (eintrag) => eintrag.pools.map(p => p.id);

test('Erste Runde: jüngste weibliche Altersklasse liegt auf der ersten Matte', () => {
    const w11 = pool('weiblich', 'U11', '-30', 20);
    const m11 = pool('männlich', 'U11', '-30', 20);
    const m13 = pool('männlich', 'U13', '-40', 20);
    const erg = verteilePoolsAufMatten({ pools: [m13, m11, w11], matten: matten(2) });
    assert.ok(ids(erg[0]).includes(w11.id));
    assert.equal(erg[0].startReihenfolge, 0);
    assert.equal(erg.flatMap(ids).length, 3);
});

test('Sonderregel entfällt, sobald eine Matte belegt ist', () => {
    // Ohne Sonderregel gewinnt die Matte mit der geringeren Last — hier die zweite.
    const w15 = pool('weiblich', 'U15', '-40', 30);
    const erg = verteilePoolsAufMatten({
        pools: [w15],
        matten: matten(2),
        startLasten: { 100: { dauer: 120, anzahl: 3 }, 101: { dauer: 10, anzahl: 1 } }
    });
    assert.deepEqual(ids(erg[0]), []);
    assert.deepEqual(ids(erg[1]), [w15.id]);
});

test('Neue Pools werden hinter die bestehende Reihenfolge angehängt', () => {
    const a = pool('männlich', 'U15', '-50', 30);
    const b = pool('männlich', 'U15', '-60', 30);
    const erg = verteilePoolsAufMatten({
        pools: [a, b],
        matten: matten(2),
        startLasten: { 100: { dauer: 0, anzahl: 4 }, 101: { dauer: 0, anzahl: 2 } }
    });
    assert.equal(erg[0].startReihenfolge, 4);
    assert.equal(erg[1].startReihenfolge, 2);
    assert.equal(erg.flatMap(ids).length, 2);
});

test('Last der bestehenden Pools wird beim Ausgleich berücksichtigt', () => {
    const neu = [pool('männlich', 'U18', '-60', 40), pool('männlich', 'U18', '-66', 40)];
    const erg = verteilePoolsAufMatten({
        pools: neu,
        matten: matten(2),
        startLasten: { 100: { dauer: 200, anzahl: 5 }, 101: { dauer: 0, anzahl: 0 } }
    });
    assert.equal(ids(erg[0]).length, 0);
    assert.equal(ids(erg[1]).length, 2);
});

test('Sortierung auf der Matte: weiblich vor männlich, jünger vor älter, leicht vor schwer', () => {
    const m15schwer = pool('männlich', 'U15', '-60', 10);
    const m15leicht = pool('männlich', 'U15', '-40', 10);
    const w18 = pool('weiblich', 'U18', '-48', 10);
    const m11 = pool('männlich', 'U11', '-30', 10);
    const erg = verteilePoolsAufMatten({ pools: [m15schwer, m11, w18, m15leicht], matten: matten(1) });
    assert.deepEqual(ids(erg[0]), [w18.id, m11.id, m15leicht.id, m15schwer.id]);
});

test('Mannschafts-Pools werden je Matte ans Ende gehängt', () => {
    const einzel = pool('männlich', 'U15', '-50', 30);
    const team = pool('männlich', 'U15', '', 60, { typ: 'mannschaft' });
    const erg = verteilePoolsAufMatten({ pools: [team, einzel], matten: matten(1) });
    assert.deepEqual(ids(erg[0]), [einzel.id, team.id]);
});

test('Modus "alle" (ohne Startlasten) und "neue" bei leerer Belegung liefern dasselbe', () => {
    const pools = [
        pool('weiblich', 'U13', '-36', 25), pool('weiblich', 'U13', '-40', 25),
        pool('männlich', 'U13', '-36', 25), pool('männlich', 'U13', '-40', 35),
        pool('männlich', 'U15', '-50', 45), pool('weiblich', 'U15', '-44', 45)
    ];
    const alle = verteilePoolsAufMatten({ pools, matten: matten(3) });
    const neue = verteilePoolsAufMatten({
        pools,
        matten: matten(3),
        startLasten: { 100: { dauer: 0, anzahl: 0 }, 101: { dauer: 0, anzahl: 0 } }
    });
    assert.deepEqual(alle.map(ids), neue.map(ids));
    assert.equal(alle.flatMap(ids).length, pools.length);
});

test('Keine Pools: leere Zuordnung je Matte', () => {
    const erg = verteilePoolsAufMatten({ pools: [], matten: matten(2) });
    assert.equal(erg.length, 2);
    assert.ok(erg.every(m => m.pools.length === 0));
});
