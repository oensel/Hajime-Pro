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

test('formatUhrzeit: HH:MM in lokaler Zeit', () => {
    assert.equal(formatUhrzeit(new Date(2026, 9, 17, 11, 5).getTime()), '11:05');
});

const spool = (id, altersklasse, geschlecht, kampfzeit = 120) => ({ id, bezeichnung: `P${id}`, altersklasse, geschlecht, kampfzeit_sekunden: kampfzeit });
const sk = (id, poolId, pos, status = 'bereit') => ({ id, pool_id: poolId, matten_reihenfolge: pos, status });
const BEGINN = Date.parse('2026-10-17T09:00:00Z');

test('simuliereZeitplan: die Kampfreihenfolge der Matte zählt, verschränkte Pools enden gemeinsam spät', () => {
    // Pool 1 und 2 sind verschränkt (1,2,1,2), Pool 3 folgt danach
    const matte = { id: 1, bezeichnung: 'M1', pools: [spool(1, 'U15', 'männlich'), spool(2, 'U15', 'männlich'), spool(3, 'U18', 'weiblich')],
        kaempfe: [sk(1, 1, 1), sk(2, 2, 2), sk(3, 1, 3), sk(4, 2, 4), sk(5, 3, 5), sk(6, 3, 6)] };
    const [m] = simuliereZeitplan({ matten: [matte], beginnMs: BEGINN, kampfzeitJeAltersklasse: {} });
    const kampf = (120 + PUFFER_SEKUNDEN) * 1000;
    const nach = Object.fromEntries(m.pools.map(p => [p.poolId, p]));
    assert.equal(nach[1].startMs, BEGINN);
    assert.equal(nach[1].endeMs, BEGINN + 3 * kampf);
    assert.equal(nach[2].startMs, BEGINN + kampf);
    assert.equal(nach[2].endeMs, BEGINN + 4 * kampf);
    assert.equal(nach[3].startMs, BEGINN + 4 * kampf);
    assert.equal(nach[3].endeMs, BEGINN + 6 * kampf);
    assert.equal(m.endeMs, BEGINN + 6 * kampf);
    assert.deepEqual(m.pools.map(p => p.poolId), [1, 2, 3]);
    assert.deepEqual(m.pools.map(p => p.kaempfe), [2, 2, 2]);
});

test('simuliereZeitplan: Kämpfe ohne Position kommen zuletzt, Freilose zählen nicht, Matte ohne Kämpfe endet am Beginn', () => {
    const matte = { id: 1, bezeichnung: 'M1', pools: [spool(1, 'U15', 'männlich')],
        kaempfe: [sk(1, 1, null, 'angelegt'), sk(2, 1, 1), sk(3, 1, 2, 'freilos')] };
    const leer = { id: 2, bezeichnung: 'M2', pools: [], kaempfe: [] };
    const [m, l] = simuliereZeitplan({ matten: [matte, leer], beginnMs: BEGINN });
    assert.equal(m.pools[0].kaempfe, 2);
    assert.equal(m.endeMs, BEGINN + 2 * (120 + PUFFER_SEKUNDEN) * 1000);
    assert.equal(l.endeMs, BEGINN);
});

test('simuliereZeitplan: Kampfzeit je Altersklasse überschreibt die Pool-Kampfzeit', () => {
    const matte = { id: 1, bezeichnung: 'M1', pools: [spool(1, 'U15', 'männlich', 240)], kaempfe: [sk(1, 1, 1), sk(2, 1, 2)] };
    const [eigen] = simuliereZeitplan({ matten: [matte], beginnMs: BEGINN, kampfzeitJeAltersklasse: { U15: 60 } });
    assert.equal(eigen.endeMs, BEGINN + 2 * (60 + PUFFER_SEKUNDEN) * 1000);
    const [pool] = simuliereZeitplan({ matten: [matte], beginnMs: BEGINN, kampfzeitJeAltersklasse: {} });
    assert.equal(pool.endeMs, BEGINN + 2 * (240 + PUFFER_SEKUNDEN) * 1000);
});

test('simuliereZeitplan: neueKlasse nur beim ersten Auftreten einer Alters-/Geschlechtsklasse auf der Matte', () => {
    const matte = { id: 1, bezeichnung: 'M1',
        pools: [spool(1, 'U15', 'männlich'), spool(2, 'U15', 'männlich'), spool(3, 'U15', 'weiblich'), spool(4, 'U18', 'weiblich')],
        kaempfe: [sk(1, 1, 1), sk(2, 2, 2), sk(3, 3, 3), sk(4, 4, 4)] };
    const [m] = simuliereZeitplan({ matten: [matte], beginnMs: BEGINN });
    assert.deepEqual(m.pools.map(p => p.neueKlasse), [true, false, true, true]);
});
