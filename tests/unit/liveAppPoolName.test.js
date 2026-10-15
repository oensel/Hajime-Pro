import test from 'node:test';
import assert from 'node:assert/strict';
import { poolName } from '../../teilnehmer-app/js/anzeige.js';

test('poolName hängt kg an die Gewichtsklasse', () => {
    assert.equal(poolName('U15 m -40'), 'U15 m −40 kg');
    assert.equal(poolName('U15m -40'), 'U15m −40 kg');
    assert.equal(poolName('U15 w −44'), 'U15 w −44 kg');
    assert.equal(poolName('U15 m +70'), 'U15 m +70 kg');
    assert.equal(poolName('U13 m -55 kg'), 'U13 m −55 kg');
    assert.equal(poolName('U15 m -40kg'), 'U15 m −40 kg');
});

test('poolName lässt Namen ohne Gewichtsklasse unverändert', () => {
    assert.equal(poolName('U15 w Team'), 'U15 w Team');
    assert.equal(poolName(''), '');
    assert.equal(poolName(null), '');
});
