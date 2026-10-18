import test from 'node:test';
import assert from 'node:assert/strict';
import { berechneStatus } from '../../src/shared/orgaStatus.js';

const k = (erledigt, art = 'posten') => ({ art, erledigt_am: erledigt ? '2027-01-01' : null });

test('eltern mit allen Kindern erledigt ist erledigt', () => {
  const r = berechneStatus({ art: 'aufgabe' }, [k(true), k(true)], {});
  assert.equal(r.status, 'erledigt');
  assert.equal(r.quelle, 'unteraufgaben');
  assert.deepEqual([r.erledigt, r.gesamt], [2, 2]);
});

test('mitbringen-Kinder zählen nicht', () => {
  const r = berechneStatus({ art: 'aufgabe' }, [k(true), k(false, 'mitbringen')], {});
  assert.equal(r.status, 'erledigt');
  assert.equal(r.gesamt, 1);
});

test('Aufgabe ohne Kinder, Automatik und Haken bleibt offen', () => {
  const r = berechneStatus({ art: 'aufgabe' }, [], {});
  assert.equal(r.status, 'offen');
  assert.equal(r.quelle, 'offen');
});

test('helferplan_taetigkeit grün bei belegt>=bedarf und slots>0', () => {
  const a = { auto_art: 'helferplan_taetigkeit', auto_ref: 'ersthelfer' };
  const r = berechneStatus(a, [], { ersthelfer: { belegt: 6, bedarf: 6, slots: 3 } });
  assert.equal(r.status, 'erledigt');
  assert.equal(r.quelle, 'helferplan');
  const t = berechneStatus(a, [], { ersthelfer: { belegt: 4, bedarf: 6, slots: 3 } });
  assert.equal(t.status, 'angefangen');
  assert.deepEqual([t.erledigt, t.gesamt], [4, 6]);
});

test('helferplan_gesamt nutzt den Schlüssel gesamt', () => {
  const r = berechneStatus({ auto_art: 'helferplan_gesamt' }, [], { gesamt: { belegt: 5, bedarf: 5, slots: 2 } });
  assert.equal(r.status, 'erledigt');
});

test('slots===0 bleibt offen', () => {
  const a = { auto_art: 'helferplan_taetigkeit', auto_ref: 'aufbau' };
  const r = berechneStatus(a, [], { aufbau: { belegt: 0, bedarf: 0, slots: 0 } });
  assert.equal(r.status, 'offen');
  assert.equal(berechneStatus(a, [], {}).status, 'offen');
});

test('manueller Haken (erledigt_am) überstimmt Automatik', () => {
  const a = { erledigt_am: '2027-01-02', auto_art: 'helferplan_taetigkeit', auto_ref: 'aufbau' };
  const r = berechneStatus(a, [k(false)], { aufbau: { belegt: 0, bedarf: 4, slots: 1 } });
  assert.equal(r.status, 'erledigt');
  assert.equal(r.quelle, 'manuell');
});

test('teilweise erledigte Kinder -> angefangen mit 3/9', () => {
  const kinder = [...Array(3).fill(0).map(() => k(true)), ...Array(6).fill(0).map(() => k(false))];
  const r = berechneStatus({ art: 'aufgabe' }, kinder, {});
  assert.equal(r.status, 'angefangen');
  assert.deepEqual([r.erledigt, r.gesamt], [3, 9]);
});
