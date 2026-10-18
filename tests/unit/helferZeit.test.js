import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RASTER_MIN, MIN_LAENGE, STANDARD_SLOT,
  fristEndeBerlin, darfHelferAendern, ueberlappt, rasterRunde,
  erzeugeStandardSlots, zeitstrahlBereich, formatiereMinuten, parseUhrzeit,
} from '../../src/shared/helferZeit.js';

test('Konstanten', () => {
  assert.equal(RASTER_MIN, 15);
  assert.equal(MIN_LAENGE, 30);
  assert.equal(STANDARD_SLOT, 120);
});

test('fristEndeBerlin: 08:00 Berlin inkl. Zeitumstellung', () => {
  assert.equal(fristEndeBerlin('2026-10-25').toISOString(), '2026-10-25T07:00:00.000Z');
  assert.equal(fristEndeBerlin('2026-10-24').toISOString(), '2026-10-24T06:00:00.000Z');
  assert.equal(fristEndeBerlin('2027-03-28').toISOString(), '2027-03-28T06:00:00.000Z');
  assert.equal(fristEndeBerlin('2026-11-14').toISOString(), '2026-11-14T07:00:00.000Z');
});

test('darfHelferAendern: bis zur Frist', () => {
  assert.equal(darfHelferAendern('2026-11-14', new Date('2026-11-14T06:59:59Z')), true);
  assert.equal(darfHelferAendern('2026-11-14', new Date('2026-11-14T07:00:00Z')), false);
});

test('ueberlappt: Grenzen zählen nicht', () => {
  assert.equal(ueberlappt({ von_min: 540, bis_min: 660 }, { von_min: 660, bis_min: 780 }), false);
  assert.equal(ueberlappt({ von_min: 540, bis_min: 660 }, { von_min: 600, bis_min: 780 }), true);
  assert.equal(ueberlappt({ von_min: 600, bis_min: 780 }, { von_min: 540, bis_min: 660 }), true);
});

test('rasterRunde', () => {
  assert.equal(rasterRunde(547), 540);
  assert.equal(rasterRunde(540), 540);
  assert.equal(rasterRunde(8), 15);
});

test('erzeugeStandardSlots', () => {
  assert.deepEqual(erzeugeStandardSlots(540, 960), [
    { von_min: 540, bis_min: 660 }, { von_min: 660, bis_min: 780 },
    { von_min: 780, bis_min: 900 }, { von_min: 900, bis_min: 960 },
  ]);
  assert.deepEqual(erzeugeStandardSlots(540, 675), [{ von_min: 540, bis_min: 675 }]);
  assert.deepEqual(erzeugeStandardSlots(540, 660), [{ von_min: 540, bis_min: 660 }]);
});

test('zeitstrahlBereich', () => {
  assert.deepEqual(zeitstrahlBereich(540, 960), { von: 480, bis: 1020 });
  assert.deepEqual(zeitstrahlBereich(30, 1430), { von: 0, bis: 1440 });
});

test('formatiereMinuten', () => {
  assert.equal(formatiereMinuten(570), '09:30');
  assert.equal(formatiereMinuten(0), '00:00');
});

test('parseUhrzeit: gültige Uhrzeiten in Minuten', () => {
  assert.equal(parseUhrzeit('09:30'), 570);
  assert.equal(parseUhrzeit('9:30'), 570);
  assert.equal(parseUhrzeit('00:00'), 0);
  assert.equal(parseUhrzeit('23:59'), 1439);
});

test('parseUhrzeit: ungültige Eingaben ergeben null', () => {
  for (const s of ['24:00', '23:60', 'abc', '', '9', '09:3', '09:30:00', null, undefined]) {
    assert.equal(parseUhrzeit(s), null, String(s));
  }
});
