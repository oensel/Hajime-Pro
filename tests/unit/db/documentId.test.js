import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createId, getTypeFromId } from '../../../src/db/documentId.js';

test('createId erzeugt eine ID mit Typ-Präfix und UUID', () => {
    const id = createId('kampf');
    assert.match(id, /^kampf:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('createId erzeugt bei jedem Aufruf eine andere ID', () => {
    const a = createId('pool');
    const b = createId('pool');
    assert.notEqual(a, b);
});

test('getTypeFromId liest das Typ-Präfix aus einer ID', () => {
    assert.equal(getTypeFromId('kampf:abc-123'), 'kampf');
});
