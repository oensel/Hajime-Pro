import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anzeigeFensterOptionen, istAnzeigeSeite } from '../../desktop/anzeigeFenster.js';

const haupt = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const tv = { id: 2, bounds: { x: 1920, y: 0, width: 3840, height: 2160 } };

test('erkennt nur die Anzeige-Seite', () => {
    assert.equal(istAnzeigeSeite('http://127.0.0.1:3000/anzeige.html'), true);
    assert.equal(istAnzeigeSeite('http://127.0.0.1:3000/anzeige.html?x=1'), true);
    assert.equal(istAnzeigeSeite('http://127.0.0.1:3000/steuerung.html'), false);
    assert.equal(istAnzeigeSeite('kein url'), false);
});

test('zweiter Bildschirm: Vollbild genau dort', () => {
    const o = anzeigeFensterOptionen([haupt, tv], 1);
    assert.equal(o.fullscreen, true);
    assert.deepEqual([o.x, o.y, o.width, o.height], [1920, 0, 3840, 2160]);
});

test('liegt die Steuerung auf dem zweiten Bildschirm, geht die Anzeige auf den anderen', () => {
    const o = anzeigeFensterOptionen([haupt, tv], 2);
    assert.equal(o.fullscreen, true);
    assert.equal(o.x, 0);
});

test('ein einziger Bildschirm: normales Fenster ohne Vollbild', () => {
    const o = anzeigeFensterOptionen([haupt], 1);
    assert.equal(o.fullscreen, undefined);
    assert.equal(o.width, 1280);
});
