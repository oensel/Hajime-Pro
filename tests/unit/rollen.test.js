import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLLEN, rolleReicht, istGueltigeRolle } from '../../src/shared/rollen.js';

test('ROLLEN enthält genau die drei Vereinsrollen', () => {
    assert.deepEqual(ROLLEN, ['admin', 'benutzer', 'helfer']);
});

test('rolleReicht: Hierarchie admin > benutzer > helfer', () => {
    assert.equal(rolleReicht('admin', 'benutzer'), true);
    assert.equal(rolleReicht('admin', 'admin'), true);
    assert.equal(rolleReicht('benutzer', 'benutzer'), true);
    assert.equal(rolleReicht('benutzer', 'helfer'), true);
    assert.equal(rolleReicht('helfer', 'helfer'), true);
    assert.equal(rolleReicht('benutzer', 'admin'), false);
    assert.equal(rolleReicht('helfer', 'benutzer'), false);
});

test('rolleReicht: null und unbekannte Rollen reichen nie', () => {
    assert.equal(rolleReicht(null, 'helfer'), false);
    assert.equal(rolleReicht(undefined, 'helfer'), false);
    assert.equal(rolleReicht('quatsch', 'helfer'), false);
    assert.equal(rolleReicht('admin', 'quatsch'), false);
});

test('istGueltigeRolle', () => {
    for (const r of ['admin', 'benutzer', 'helfer']) assert.equal(istGueltigeRolle(r), true);
    for (const r of [null, undefined, '', 'Admin', 'quatsch', 1]) assert.equal(istGueltigeRolle(r), false);
});
