import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripReservedFields } from '../../../src/db/reservedFields.js';

test('stripReservedFields entfernt alle mit _ beginnenden Schlüssel', () => {
    const bereinigt = stripReservedFields({
        bezeichnung: 'Matte 1',
        _deleted: true,
        _rev: '1-abc',
        _attachments: { foo: 'bar' }
    });

    assert.deepEqual(bereinigt, { bezeichnung: 'Matte 1' });
});

test('stripReservedFields lässt normale Felder unverändert, wenn keine reservierten vorhanden sind', () => {
    const bereinigt = stripReservedFields({ bezeichnung: 'Matte 1', status: 'frei' });

    assert.deepEqual(bereinigt, { bezeichnung: 'Matte 1', status: 'frei' });
});
