import test from 'node:test';
import assert from 'node:assert/strict';
import { teilnehmerSchluessel, normalisiereVerein, vereinSchluessel, waehleAnzeigename } from '../../src/live/schluessel.js';

test('teilnehmerSchluessel ist stabil, 24 Hex lang und hängt vom Geheimnis ab', () => {
    const a = teilnehmerSchluessel('geheim', 'abc123');
    assert.equal(a, teilnehmerSchluessel('geheim', 'abc123'));
    assert.match(a, /^[0-9a-f]{24}$/);
    assert.notEqual(a, teilnehmerSchluessel('anders', 'abc123'));
    assert.notEqual(a, teilnehmerSchluessel('geheim', 'abc124'));
});

test('normalisiereVerein vereinheitlicht Schreibvarianten', () => {
    const varianten = ['JC Musterstadt', 'Judoclub Musterstadt e.V.', 'Judo Club Musterstadt e. V.', 'jc  musterstadt eV'];
    const normal = varianten.map(normalisiereVerein);
    assert.equal(new Set(normal).size, 1, JSON.stringify(normal));
    assert.equal(normal[0], 'jc musterstadt');
});

test('normalisiereVerein: Umlaute, Bindestriche und Leerraum', () => {
    assert.equal(normalisiereVerein('  TSV  Köln-Süd e.V. '), 'tsv koeln sued');
    assert.equal(normalisiereVerein('SV Großhausen'), 'sv grosshausen');
});

test('normalisiereVerein: leere Eingabe ergibt leeren String', () => {
    assert.equal(normalisiereVerein(''), '');
    assert.equal(normalisiereVerein(null), '');
});

test('vereinSchluessel gleich für Varianten, verschieden für andere Vereine', () => {
    assert.equal(vereinSchluessel('JC Musterstadt'), vereinSchluessel('Judoclub Musterstadt e.V.'));
    assert.notEqual(vereinSchluessel('JC Musterstadt'), vereinSchluessel('JC Beispielhausen'));
    assert.match(vereinSchluessel('JC Musterstadt'), /^[0-9a-f]{12}$/);
});

test('waehleAnzeigename: häufigste Schreibweise, sonst alphabetisch', () => {
    assert.equal(waehleAnzeigename(['JC Muster', 'Judoclub Muster e.V.', 'JC Muster']), 'JC Muster');
    assert.equal(waehleAnzeigename(['B-Verein', 'A-Verein']), 'A-Verein');
});
