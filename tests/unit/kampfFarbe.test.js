import test from 'node:test';
import assert from 'node:assert/strict';
import { bestimmeFarbeKaempfer2 } from '../../src/shared/kampfFarbe.js';

test('Standard ist blau', () => {
    assert.equal(bestimmeFarbeKaempfer2({}), 'blau');
});
test('Turnier gilt, wenn Pool und Kampf nichts festlegen', () => {
    assert.equal(bestimmeFarbeKaempfer2({ kampf: {}, pool: { farbe_kaempfer2: null }, turnier: { farbe_kaempfer2: 'rot' } }), 'rot');
});
test('Pool überschreibt das Turnier', () => {
    assert.equal(bestimmeFarbeKaempfer2({ pool: { farbe_kaempfer2: 'blau' }, turnier: { farbe_kaempfer2: 'rot' } }), 'blau');
});
test('Scoreboard (live_farbe) überschreibt Pool und Turnier', () => {
    assert.equal(bestimmeFarbeKaempfer2({ kampf: { live_farbe: 'rot' }, pool: { farbe_kaempfer2: 'blau' }, turnier: { farbe_kaempfer2: 'blau' } }), 'rot');
});
test('ungültige Werte werden ignoriert', () => {
    assert.equal(bestimmeFarbeKaempfer2({ kampf: { live_farbe: 'gruen' }, pool: { farbe_kaempfer2: 'rot' } }), 'rot');
});
