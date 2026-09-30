import test from 'node:test';
import assert from 'node:assert/strict';
import { linienMuster, istLinie } from '../../src/shared/urkundenLinien.js';

test('linienMuster je Stil', () => {
    assert.deepEqual(linienMuster('durchgezogen', 1), { muster: null, kappe: 'butt' });
    assert.deepEqual(linienMuster('gepunktet', 2), { muster: [0, 4], kappe: 'round' });
    assert.deepEqual(linienMuster('gestrichelt', 2), { muster: [6, 4], kappe: 'butt' });
    assert.deepEqual(linienMuster('gestrichelt', 0.5), { muster: [3, 2], kappe: 'butt' });
});

test('istLinie', () => {
    assert.equal(istLinie({ typ: 'linie' }), true);
    assert.equal(istLinie({ text: 'x' }), false);
});
