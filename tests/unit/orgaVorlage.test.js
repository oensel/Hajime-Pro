import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGA_VORLAGE, ORGA_PHASEN } from '../../src/shared/orgaVorlage.js';

test('alle vorlage_key eindeutig', () => {
  const keys = ORGA_VORLAGE.map((a) => a.vorlage_key);
  assert.equal(new Set(keys).size, keys.length);
});

test('jede der fünf Phasen vorhanden', () => {
  assert.deepEqual(ORGA_PHASEN, ['grundlage', 'vorbereitung', 'meldephase', 'turniertag', 'nachbereitung']);
  for (const p of ORGA_PHASEN) assert.ok(ORGA_VORLAGE.some((a) => a.phase === p), p);
});

test('grundlage beginnt mit Hallenzeiten reservieren (-240)', () => {
  const g = ORGA_VORLAGE.filter((a) => a.phase === 'grundlage');
  assert.equal(g[0].titel, 'Hallenzeiten reservieren');
  assert.equal(g[0].frist_tage, -240);
});

test('kein Titel enthält Mattenwagen', () => {
  const alle = ORGA_VORLAGE.flatMap((a) => [a.titel, ...(a.posten ?? []).map((p) => p.titel)]);
  assert.ok(!alle.some((t) => /Mattenwagen/i.test(t)));
});

test('Technik bereitstellen hat die Posten', () => {
  const t = ORGA_VORLAGE.find((a) => a.titel === 'Technik bereitstellen');
  const titel = t.posten.map((p) => p.titel);
  for (const n of ['Mikrofon', 'Lautsprecher', 'Notebooks Matte', 'Mehrfachsteckdosen', 'Verlängerungskabel', 'Urkundenpapier']) {
    assert.ok(titel.includes(n), n);
  }
});

test('Catering hat mitbringliste', () => {
  const c = ORGA_VORLAGE.find((a) => a.titel === 'Catering einkaufen');
  assert.equal(c.mitbringliste, true);
});

test('Automatik-Aufgaben haben auto_art und gültige Fristanker', () => {
  for (const a of ORGA_VORLAGE) {
    assert.ok(['turnier', 'anmeldeschluss'].includes(a.frist_anker), a.vorlage_key);
    if (a.auto_art === 'helferplan_taetigkeit') assert.ok(a.auto_ref, a.vorlage_key);
  }
});
