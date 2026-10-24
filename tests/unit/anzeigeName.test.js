import test from 'node:test';
import assert from 'node:assert/strict';
import { kuerzeName, kurzeMeldung, angepasstSchrift } from '../../src/shared/anzeigeName.js';

test('kuerzeName: Nachname, Vorname wird zu "Nachname, V."', () => {
    assert.equal(kuerzeName('Lückmann, Patrick'), 'Lückmann, P.');
    assert.equal(kuerzeName('Diederichs-Späh, Fabien'), 'Diederichs-Späh, F.');
});

test('kuerzeName: mehrere Vornamen, Kleinschreibung, Umlaut und Leerraum', () => {
    assert.equal(kuerzeName('Weber, Anna Lena'), 'Weber, A.');
    assert.equal(kuerzeName('  Öztürk ,  ali '), 'Öztürk, A.');
    assert.equal(kuerzeName('Müller, Hans, Dr.'), 'Müller, H.');
});

test('kuerzeName: ohne Komma oder ohne Vornamen bleibt der Text', () => {
    assert.equal(kuerzeName('Kämpfer Weiß'), 'Kämpfer Weiß');
    assert.equal(kuerzeName('Schneider,'), 'Schneider,');
    assert.equal(kuerzeName(', Mia'), ', Mia');
    assert.equal(kuerzeName(''), '');
    assert.equal(kuerzeName(undefined), '');
});

test('kuerzeName: Vornamen mit Zeichen außerhalb der Grundebene werden nicht zerrissen', () => {
    assert.equal(kuerzeName('Test, \u{1D4D0}nna'), 'Test, \u{1D4D0}.');
});

test('kurzeMeldung: nur "Nicht angetreten" wird gekürzt', () => {
    assert.equal(kurzeMeldung('NICHT ANGETRETEN'), 'N. ANGETRETEN');
    assert.equal(kurzeMeldung('HANSOKU-MAKE'), 'HANSOKU-MAKE');
    assert.equal(kurzeMeldung('AUFGABE'), 'AUFGABE');
});

test('angepasstSchrift: verkleinert nur, wenn der Text nicht passt', () => {
    assert.equal(angepasstSchrift(100, 800, 900), null);
    assert.equal(angepasstSchrift(100, 900, 900), null);
    assert.equal(angepasstSchrift(100, 1000, 900), 90);
    assert.equal(angepasstSchrift(107.52, 1200, 900), 80);
});

test('angepasstSchrift: ungültige Werte ergeben keine Änderung', () => {
    assert.equal(angepasstSchrift(0, 1000, 900), null);
    assert.equal(angepasstSchrift(100, 1000, 0), null);
    assert.equal(angepasstSchrift(NaN, 1000, 900), null);
});
