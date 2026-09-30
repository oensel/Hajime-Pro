import test from 'node:test';
import assert from 'node:assert/strict';
import { darfVorlageNutzen, pruefeFelder, normalisiereReihenfolge } from '../../src/controllers/urkundenController.js';

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

test('pruefeFelder: Linien', () => {
    const linie = { id: 'l', typ: 'linie', x: 10, y: 100, breite: 200, staerke: 1, stil: 'gestrichelt', farbe: '#000000' };
    assert.equal(pruefeFelder([linie], 595, 842), null);
    assert.equal(pruefeFelder([{ ...linie, stil: 'gepunktet' }, { ...linie, stil: 'durchgezogen' }], 595, 842), null);
    assert.match(pruefeFelder([{ ...linie, stil: 'wellig' }], 595, 842), /Linienstil/);
    assert.match(pruefeFelder([{ ...linie, staerke: 0.1 }], 595, 842), /Linienstärke/);
    assert.match(pruefeFelder([{ ...linie, breite: 600 }], 595, 842), /Seite/);
    assert.match(pruefeFelder([{ ...linie, typ: 'kreis' }], 595, 842), /Feldtyp/);
});

test('Reihenfolge: siegerehrung ist der alte Name von absteigend', () => {
    assert.equal(normalisiereReihenfolge('aufsteigend'), 'aufsteigend');
    assert.equal(normalisiereReihenfolge('absteigend'), 'absteigend');
    assert.equal(normalisiereReihenfolge('siegerehrung'), 'absteigend');
});
