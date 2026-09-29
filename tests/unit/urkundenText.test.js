import test from 'node:test';
import assert from 'node:assert/strict';
import { ersetzePlatzhalter, passeGroesseAn, berechneX, platzierungsText, geschlechtText } from '../../src/shared/urkundenText.js';

test('ersetzePlatzhalter', () => {
    const d = { Name: 'Łukasz Şahin', Verein: null, Altersklasse: 'U15' };
    assert.equal(ersetzePlatzhalter('{Name} – {Verein}|{Altersklasse} {Foo}', d), 'Łukasz Şahin – |U15 {Foo}');
    assert.equal(ersetzePlatzhalter('Kreismeisterschaft 2026', d), 'Kreismeisterschaft 2026');
});

test('passeGroesseAn', () => {
    const misst = (t, g) => t.length * g * 0.5;
    assert.deepEqual(passeGroesseAn('abcd', 20, 100, misst), { groesse: 20, passt: true });
    assert.deepEqual(passeGroesseAn('a'.repeat(20), 20, 100, misst), { groesse: 10, passt: true });
    assert.deepEqual(passeGroesseAn('a'.repeat(40), 20, 100, misst), { groesse: 10, passt: false });
    assert.deepEqual(passeGroesseAn('a'.repeat(21), 20, 100, misst), { groesse: 10, passt: false }); // nie unter 50 %
});

test('berechneX', () => {
    assert.equal(berechneX('links', 10, 100, 40), 10);
    assert.equal(berechneX('zentriert', 10, 100, 40), 40);
    assert.equal(berechneX('rechts', 10, 100, 40), 70);
});

test('Texte', () => {
    assert.equal(platzierungsText(5), '5. Platz');
    assert.equal(platzierungsText(null), 'Teilnahme');
    assert.equal(geschlechtText('w'), 'weiblich');
    assert.equal(geschlechtText('m'), 'männlich');
    assert.equal(geschlechtText(null), '');
});
