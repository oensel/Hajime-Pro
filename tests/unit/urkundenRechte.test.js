import test from 'node:test';
import assert from 'node:assert/strict';
import { darfVorlageNutzen, pruefeFelder } from '../../src/controllers/urkundenController.js';

test('Vorlage nur für Turniere desselben Vereins', () => {
    assert.equal(darfVorlageNutzen({ verein_id: 1 }, { verein_id: 2 }), false);
    assert.equal(darfVorlageNutzen({ verein_id: 1 }, { verein_id: 1 }), true);
    assert.equal(darfVorlageNutzen({ verein_id: null }, { verein_id: 1 }), false);
    assert.equal(darfVorlageNutzen({ verein_id: 1 }, undefined), false);
});

test('pruefeFelder', () => {
    const ok = { id: 'f', text: '{Name}', x: 10, y: 10, breite: 100, schrift: 'noto-sans', groesse: 20, farbe: '#000000', ausrichtung: 'links' };
    assert.equal(pruefeFelder([ok], 595, 842), null);
    assert.match(pruefeFelder([{ ...ok, x: 550 }], 595, 842), /Seite/);
    assert.match(pruefeFelder([{ ...ok, schrift: 'comic' }], 595, 842), /Schrift/);
    assert.match(pruefeFelder([{ ...ok, groesse: 2 }], 595, 842), /größe/i);
    assert.match(pruefeFelder([{ ...ok, farbe: 'red' }], 595, 842), /Farbe/);
    assert.match(pruefeFelder([{ ...ok, ausrichtung: 'mitte' }], 595, 842), /Ausrichtung/);
    assert.match(pruefeFelder([{ ...ok, text: 'x'.repeat(201) }], 595, 842), /200/);
    assert.match(pruefeFelder(Array(51).fill(ok), 595, 842), /50/);
    assert.match(pruefeFelder('kein array', 595, 842), /Feld/);
});
