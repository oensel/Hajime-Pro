import test from 'node:test';
import assert from 'node:assert/strict';
import { standardAltersklassenFuerAlter, waehleStandardAltersklasse, jahrgaengeText } from '../../src/shared/altersklassenJahrgaenge.js';

const aktiv = (...ids) => (id) => ids.includes(id);

test('Übergangsjahrgänge 2026 (NWJV): 2016 in U11 und U13, 2014 in U13 und U15', () => {
    assert.deepEqual(standardAltersklassenFuerAlter(2026 - 2016, 'männlich'), ['U11', 'U13']);
    assert.deepEqual(standardAltersklassenFuerAlter(2026 - 2015, 'männlich'), ['U13']);
    assert.deepEqual(standardAltersklassenFuerAlter(2026 - 2014, 'weiblich'), ['U13', 'U15']);
    assert.deepEqual(standardAltersklassenFuerAlter(17, 'weiblich'), ['U18', 'U21', 'Frauen']);
    assert.deepEqual(standardAltersklassenFuerAlter(25, 'männlich'), ['Männer']);
    assert.deepEqual(standardAltersklassenFuerAlter(7, 'männlich'), ['U9']);
});

test('jüngere Klasse zuerst, die ältere nur, wenn die jüngere nicht ausgetragen wird', () => {
    assert.equal(waehleStandardAltersklasse(10, 'männlich', aktiv('U11', 'U13')), 'U11');
    assert.equal(waehleStandardAltersklasse(10, 'männlich', aktiv('U13', 'U15')), 'U13');
    assert.equal(waehleStandardAltersklasse(12, 'weiblich', aktiv('U15')), 'U15');
    assert.equal(waehleStandardAltersklasse(19, 'weiblich', aktiv('Frauen')), 'Frauen');
    assert.equal(waehleStandardAltersklasse(11, 'männlich', aktiv('U15')), '');
});

test('Jahrgänge werden aus dem Wettkampfjahr berechnet', () => {
    assert.equal(jahrgaengeText('U13', 2026), '2014–2016');
    assert.equal(jahrgaengeText('U11', 2027), '2017–2019');
    assert.equal(jahrgaengeText('Frauen', 2026), 'bis 2009');
    assert.equal(jahrgaengeText('U10', 2026), '');
});
