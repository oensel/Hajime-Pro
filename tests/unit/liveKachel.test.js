import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneKacheln } from '../../src/shared/liveKachel.js';

const pool = (id, extra = {}) => ({ id, kampfflaeche_id: 1, status: 'matte_zugewiesen', typ: 'einzel', verspaetet: false, ...extra });
const tn = (id, poolId, status = 'kampfbereit') => ({ id, pool_id: poolId, status });
const kampf = (id, poolId, k1, k2, extra = {}) =>
    ({ id, pool_id: poolId, status: 'bereit', matten_reihenfolge: id, kaempfer1_id: k1, kaempfer2_id: k2, ...extra });
const k = (daten) => berechneKacheln({ pools: [], teilnehmer: [], kaempfe: [], platzierungen: {}, ...daten });

test('ohne Pool: nicht_ausgelost', () => {
    const r = k({ teilnehmer: [tn(1, null, 'angemeldet')] });
    assert.equal(r.get(1).zustand, 'nicht_ausgelost');
});

test('Pool ohne Matte: ohne_matte', () => {
    const r = k({ pools: [pool(1, { kampfflaeche_id: null })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.get(1).zustand, 'ohne_matte');
});

test('Sammelpool Verspätet: verspaetet', () => {
    const r = k({ pools: [pool(1, { verspaetet: true, kampfflaeche_id: null })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.get(1).zustand, 'verspaetet');
});

test('nicht_erschienen hat Vorrang vor allem anderen', () => {
    const r = k({ pools: [pool(1)], teilnehmer: [tn(1, 1, 'nicht_erschienen')], kaempfe: [kampf(1, 1, 1, 2)] });
    assert.equal(r.get(1).zustand, 'nicht_erschienen');
});

test('Abstand zählt offene Kämpfe der ganzen Matte, auch aus anderen Pools', () => {
    const r = k({
        pools: [pool(1), pool(2)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 2), tn(4, 2), tn(5, 1), tn(6, 1)],
        kaempfe: [kampf(1, 1, 1, 2), kampf(2, 2, 3, 4), kampf(3, 1, 5, 6)]
    });
    assert.equal(r.get(1).zustand, 'als_naechstes');
    assert.equal(r.get(3).zustand, 'in_n');
    assert.equal(r.get(3).abstand, 1);
    assert.equal(r.get(5).abstand, 2);
    assert.equal(r.get(5).naechsterKampfId, 3);
});

test('laufender Kampf: laeuft; der folgende Kampf hat Abstand 1', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'gestartet' }), kampf(2, 1, 3, 4)]
    });
    assert.equal(r.get(1).zustand, 'laeuft');
    assert.equal(r.get(3).zustand, 'in_n');
    assert.equal(r.get(3).abstand, 1);
});

test('beendete und Freilos-Kämpfe zählen nicht', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'beendet' }), kampf(2, 1, 3, null, { status: 'freilos' }), kampf(3, 1, 3, 4)]
    });
    assert.equal(r.get(3).zustand, 'als_naechstes');
});

test('Kampf ohne Position wird ans Ende gestellt, ohne Absturz', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { matten_reihenfolge: null }), kampf(2, 1, 3, 4, { matten_reihenfolge: 5 })]
    });
    assert.equal(r.get(3).zustand, 'als_naechstes');
    assert.equal(r.get(1).zustand, 'in_n');
    assert.equal(r.get(1).abstand, 1);
});

test('Folgekampf mit offenem Gegner: wartet_auf_gegner', () => {
    const r = k({
        pools: [pool(1)],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 1, 1, null, { status: 'angelegt', matten_reihenfolge: null })]
    });
    assert.equal(r.get(1).zustand, 'wartet_auf_gegner');
    assert.equal(r.get(2).zustand, 'keine_weiteren');
});

test('keine offenen Kämpfe, Pool läuft: keine_weiteren', () => {
    const r = k({
        pools: [pool(1, { status: 'gestartet' })],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 1, 1, 2, { status: 'beendet' })]
    });
    assert.equal(r.get(1).zustand, 'keine_weiteren');
});

test('Pool abgeschlossen: abgeschlossen mit Platz nur bei 1 bis 3', () => {
    const r = k({
        pools: [pool(1, { status: 'abgeschlossen' })],
        teilnehmer: [tn(1, 1), tn(2, 1), tn(3, 1), tn(4, 1), tn(5, 1)],
        platzierungen: { 1: { 1: 1, 2: 2, 3: 3, 4: 5, 5: null } }
    });
    assert.deepEqual([1, 2, 3].map(i => r.get(i).platz), [1, 2, 3]);
    assert.equal(r.get(4).platz, null);
    assert.equal(r.get(5).platz, null);
    assert.equal(r.get(1).zustand, 'abgeschlossen');
});

test('Mannschafts-Pool: Teilnehmer erscheint nicht', () => {
    const r = k({ pools: [pool(1, { typ: 'mannschaft' })], teilnehmer: [tn(1, 1)] });
    assert.equal(r.has(1), false);
});

test('Mannschafts-Einzelkämpfe auf derselben Matte zählen in die Warteschlange', () => {
    const r = k({
        pools: [pool(1), pool(2, { typ: 'mannschaft' })],
        teilnehmer: [tn(1, 1), tn(2, 1)],
        kaempfe: [kampf(1, 2, 90, 91), kampf(2, 1, 1, 2)]
    });
    assert.equal(r.get(1).abstand, 1);
});
