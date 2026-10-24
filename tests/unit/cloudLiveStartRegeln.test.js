import test from 'node:test';
import assert from 'node:assert/strict';
import { pruefeStartfenster } from '../../src/cloudLive/startRegeln.js';

// Turnier am 2099-05-04 (Mai: Sommerzeit, Ende des Turniertags = 2099-05-05 06:00 Uhr Berliner Zeit = 04:00 UTC)
test('Startfenster: ab dem Vortag bis zum Ende des Turniertags', () => {
    const am = (iso) => pruefeStartfenster('2099-05-04', () => new Date(iso));
    assert.deepEqual(am('2099-05-02T10:00:00Z'), { ok: false, grund: 'zu_frueh' });
    assert.deepEqual(am('2099-05-02T21:59:00Z'), { ok: false, grund: 'zu_frueh' }, 'noch der 2. Mai in Berlin');
    assert.deepEqual(am('2099-05-02T22:00:00Z'), { ok: true }, 'Mitternacht Berliner Zeit: der Vortag beginnt');
    assert.deepEqual(am('2099-05-03T10:00:00Z'), { ok: true });
    assert.deepEqual(am('2099-05-04T10:00:00Z'), { ok: true });
    assert.deepEqual(am('2099-05-05T03:59:00Z'), { ok: true });
    assert.deepEqual(am('2099-05-05T04:00:00Z'), { ok: false, grund: 'vorbei' });
});

test('Startfenster: ein Datum als Date-Objekt (pg ohne Typparser) wird wie der Text behandelt', () => {
    assert.deepEqual(pruefeStartfenster(new Date(2099, 4, 4), () => new Date('2099-05-04T10:00:00Z')), { ok: true });
    assert.deepEqual(pruefeStartfenster('kein-datum', () => new Date()), { ok: false, grund: 'vorbei' });
});
