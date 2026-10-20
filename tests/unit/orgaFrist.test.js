import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneFaelligkeit } from '../../src/shared/orgaFrist.js';

test('-56 Tage vor 2027-03-14 ist 2027-01-17', () => {
  const r = berechneFaelligkeit({ frist_anker: 'turnier', frist_tage: -56 }, { turnierdatum: '2027-03-14', anmeldeschluss: null });
  assert.equal(r, '2027-01-17');
});

test('Anker anmeldeschluss, fehlend -> Rückfall auf Turniertag', () => {
  const f = { frist_anker: 'anmeldeschluss', frist_tage: -7 };
  assert.equal(berechneFaelligkeit(f, { turnierdatum: '2027-03-14', anmeldeschluss: '2027-03-01' }), '2027-02-22');
  assert.equal(berechneFaelligkeit(f, { turnierdatum: '2027-03-14', anmeldeschluss: null }), '2027-03-07');
});

test('ohne Datum null', () => {
  assert.equal(berechneFaelligkeit({ frist_anker: 'turnier', frist_tage: 0 }, {}), null);
  assert.equal(berechneFaelligkeit({ frist_anker: null, frist_tage: null }, { turnierdatum: '2027-03-14' }), null);
});

test('Date-Objekte und Zeitumstellung (lokale Felder)', () => {
  const r = berechneFaelligkeit({ frist_anker: 'turnier', frist_tage: 3 }, { turnierdatum: new Date(2027, 2, 27) });
  assert.equal(r, '2027-03-30');
});
