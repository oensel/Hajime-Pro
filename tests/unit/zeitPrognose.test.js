import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PUFFER_SEKUNDEN, dauerJeKampfSekunden, prognoseMatte, berechneRueckstand, simuliereZeitplan, formatUhrzeit
} from '../../src/shared/zeitPrognose.js';

const beendet = (id, sek, min) => ({
    id, status: 'beendet', kampfzeit_in_sekunden: sek, updated_at: `2026-10-17T09:${String(min).padStart(2, '0')}:00.000Z`
});
const offen = (id, extra = {}) => ({ id, status: 'bereit', pool_kampfzeit: 240, ...extra });
const T10 = Date.parse('2026-10-17T10:00:00Z');

test('Dauer je Kampf: Schnitt der gekämpften Zeit plus 90 s', () => {
    const k = [1, 2, 3, 4, 5].map(i => beendet(i, 120, i));
    assert.equal(PUFFER_SEKUNDEN, 90);
    assert.equal(dauerJeKampfSekunden(k, 240), 210);
});

test('Dauer je Kampf: unter 3 Kämpfen gilt die Vorgabe plus Puffer', () => {
    assert.equal(dauerJeKampfSekunden([beendet(1, 100, 1), beendet(2, 100, 2)], 240), 330);
});

test('Dauer je Kampf: Zeit 0 und Freilose zählen nicht', () => {
    const k = [beendet(1, 0, 1), { id: 2, status: 'freilos', kampfzeit_in_sekunden: 0 }, beendet(3, 120, 3), beendet(4, 120, 4)];
    assert.equal(dauerJeKampfSekunden(k, 240), 330);
});

test('Dauer je Kampf: nur die letzten 8 Kämpfe zählen', () => {
    const k = [];
    for (let i = 1; i <= 4; i++) k.push(beendet(i, 600, i));
    for (let i = 5; i <= 12; i++) k.push(beendet(i, 60, i));
    assert.equal(dauerJeKampfSekunden(k, 240), 150);
});

test('prognoseMatte: Beginne der offenen Kämpfe nacheinander', () => {
    const kaempfe = [1, 2, 3].map(i => beendet(i, 120, i)).concat([offen(10), offen(11), offen(12)]);
    const p = prognoseMatte(kaempfe, T10);
    assert.equal(p.zeiten.get(10), T10);
    assert.equal(p.zeiten.get(11), T10 + 210000);
    assert.equal(p.zeiten.get(12), T10 + 420000);
    assert.equal(p.endeMs, T10 + 630000);
    assert.equal(p.offeneKaempfe, 3);
    assert.equal(p.dauerSekunden, 210);
});

test('prognoseMatte: laufender Kampf verschiebt den Beginn um die halbe Dauer', () => {
    const kaempfe = [1, 2, 3].map(i => beendet(i, 120, i)).concat([{ id: 9, status: 'gestartet' }, offen(10)]);
    const p = prognoseMatte(kaempfe, T10);
    assert.equal(p.zeiten.get(10), T10 + 105000);
    assert.equal(p.zeiten.has(9), false);
});

test('prognoseMatte: ohne offene Kämpfe kein Ende', () => {
    const p = prognoseMatte([beendet(1, 120, 1)], T10);
    assert.equal(p.endeMs, null);
    assert.equal(p.zeiten.size, 0);
    assert.equal(p.offeneKaempfe, 0);
});

test('prognoseMatte: ohne beendete Kämpfe gilt die Pool-Kampfzeit', () => {
    const p = prognoseMatte([offen(10), offen(11, { pool_kampfzeit: 180 })], T10);
    assert.equal(p.zeiten.get(11), T10 + 330000);
    assert.equal(p.endeMs, T10 + 330000 + 270000);
});

test('berechneRueckstand: Abstand zur frühesten Matte', () => {
    const r = berechneRueckstand([{ id: 1, endeMs: T10 }, { id: 2, endeMs: T10 + 40 * 60000 }]);
    assert.deepEqual(r.get(2), { minuten: 40, bezugMatteId: 1 });
    assert.equal(r.has(1), false);
});

test('berechneRueckstand: unter 10 Minuten, einzelne Matte und null-Enden ergeben nichts', () => {
    assert.equal(berechneRueckstand([{ id: 1, endeMs: T10 }, { id: 2, endeMs: T10 + 9 * 60000 }]).size, 0);
    assert.equal(berechneRueckstand([{ id: 1, endeMs: T10 }]).size, 0);
    assert.equal(berechneRueckstand([{ id: 1, endeMs: T10 }, { id: 2, endeMs: null }]).size, 0);
});

test('simuliereZeitplan: Poolenden nacheinander je Matte', () => {
    const matten = [
        { id: 1, bezeichnung: 'Matte 1', pools: [
            { id: 1, bezeichnung: 'A', altersklasse: 'U13', gesamt_kaempfe: 10, kampfzeit_sekunden: 240 },
            { id: 2, bezeichnung: 'B', altersklasse: 'U13', gesamt_kaempfe: 10, kampfzeit_sekunden: 240 }] },
        { id: 2, bezeichnung: 'Matte 2', pools: [] }
    ];
    const beginn = Date.parse('2026-10-17T09:00:00Z');
    const r = simuliereZeitplan({ matten, beginnMs: beginn, kampfzeitJeAltersklasse: { U13: 120 } });
    assert.equal(r[0].pools[0].endeMs, beginn + 35 * 60000);
    assert.equal(r[0].pools[1].endeMs, beginn + 70 * 60000);
    assert.equal(r[0].endeMs, beginn + 70 * 60000);
    assert.equal(r[1].endeMs, beginn);
});

test('simuliereZeitplan: fehlende Altersklasse nutzt die Pool-Kampfzeit', () => {
    const matten = [{ id: 1, bezeichnung: 'M', pools: [{ id: 1, bezeichnung: 'A', altersklasse: 'U18', gesamt_kaempfe: 2, kampfzeit_sekunden: 240 }] }];
    const r = simuliereZeitplan({ matten, beginnMs: 0, kampfzeitJeAltersklasse: {} });
    assert.equal(r[0].endeMs, 2 * 330000);
});

test('formatUhrzeit: HH:MM in lokaler Zeit', () => {
    assert.equal(formatUhrzeit(new Date(2026, 9, 17, 11, 5).getTime()), '11:05');
});
