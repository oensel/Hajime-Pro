import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balken, ladeText, fortschrittsZeile, schrittZeile, erzeugeKonsolenAnzeige, MELDUNG } from '../../src/shared/updateAnzeige.js';

test('balken füllt anteilig und begrenzt', () => {
    assert.equal(balken(0, 10), '[░░░░░░░░░░]');
    assert.equal(balken(0.5, 10), '[█████░░░░░]');
    assert.equal(balken(1, 10), '[██████████]');
    assert.equal(balken(7, 10), '[██████████]');
    assert.equal(balken(NaN, 4), '[░░░░]');
});

test('fortschrittsZeile zeigt Balken, Prozent und Megabyte; ohne Gesamtgröße nur den Stand', () => {
    const z = fortschrittsZeile({ text: 'Lade', geladen: 31 * 1048576, gesamt: 62 * 1048576 });
    assert.match(z, /^Lade \[█{10}░{10}\] 50 % \(31 von 62 MB\)$/);
    assert.equal(fortschrittsZeile({ text: 'Lade', geladen: 5 * 1048576, gesamt: 0 }), 'Lade 5 MB');
    assert.equal(ladeText({ geladen: 1572864, gesamt: 3145728 }), '1,5 von 3 MB');
});

test('schrittZeile und Meldungstexte', () => {
    assert.match(schrittZeile(2, 4, 'Installiere Abhängigkeiten …'), /^\(2\/4\) Installiere Abhängigkeiten … \[█{2,3}░+\]$/);
    assert.equal(MELDUNG.suche, 'Suche nach Updates …');
    assert.match(MELDUNG.holeGit('1.0.11'), /aus git/);
    assert.match(MELDUNG.holeServer('1.0.11'), /vom Server/);
    assert.match(MELDUNG.neustart(3), /Neustart in 3 Sekunden/);
});

test('Konsolenanzeige ohne Terminal: nur 10-%-Schritte, jede Meldung eine Zeile', () => {
    const aus = [];
    const a = erzeugeKonsolenAnzeige({ schreibe: (s) => aus.push(s), tty: false, praefix: '' });
    a.meldung('Suche nach Updates …');
    for (let i = 0; i <= 100; i++) a.fortschritt({ text: 'Lade', geladen: i, gesamt: 100 });
    a.meldung('fertig');
    const zeilen = aus.join('').trim().split('\n');
    assert.equal(zeilen[0], 'Suche nach Updates …');
    assert.equal(zeilen.length, 1 + 11 + 1); // 0,10,…,100 %
    assert.equal(zeilen.at(-1), 'fertig');
});

test('Konsolenanzeige im Terminal überschreibt die Zeile und schließt sie bei der nächsten Meldung ab', () => {
    const aus = [];
    const a = erzeugeKonsolenAnzeige({ schreibe: (s) => aus.push(s), tty: true, praefix: '' });
    a.fortschritt({ text: 'Lade', geladen: 1, gesamt: 2 });
    a.fortschritt({ text: 'Lade', geladen: 2, gesamt: 2 });
    a.meldung('weiter');
    const text = aus.join('');
    assert.equal(text.split('\r').length - 1, 2);
    assert.ok(text.endsWith('\nweiter\n'));
});
