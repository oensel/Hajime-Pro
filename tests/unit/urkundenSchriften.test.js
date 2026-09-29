import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { URKUNDEN_SCHRIFTEN, findeSchrift, STANDARD_SCHRIFT_ID } from '../../src/shared/urkundenSchriften.js';

test('jede Schrift hat eine vorhandene Datei', () => {
    assert.equal(URKUNDEN_SCHRIFTEN.length, 6);
    for (const s of URKUNDEN_SCHRIFTEN) {
        assert.ok(fs.existsSync(path.join('public/fonts/urkunden', s.datei)), s.datei);
    }
});

test('findeSchrift', () => {
    assert.equal(findeSchrift(STANDARD_SCHRIFT_ID).datei, 'NotoSans-Regular.ttf');
    assert.equal(findeSchrift('gibtsnicht'), undefined);
});
