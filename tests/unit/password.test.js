import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword, brauchtNeuenHash, DURCHLAEUFE } from '../../src/utils/password.js';

test('Passwort: neues Format, Prüfung und Salz', () => {
    const h = hashPassword('Geheim-1234');
    assert.match(h, new RegExp(`^v2\\$${DURCHLAEUFE}\\$[0-9a-f]{32}\\$[0-9a-f]{128}$`));
    assert.equal(verifyPassword('Geheim-1234', h), true);
    assert.equal(verifyPassword('geheim-1234', h), false);
    assert.equal(verifyPassword('', h), false);
    assert.notEqual(hashPassword('Geheim-1234'), h, 'jedes Mal anderes Salz');
    assert.equal(brauchtNeuenHash(h), false);
    assert.ok(DURCHLAEUFE >= 210_000);
});

test('Passwort: alte Prüfwerte gelten weiter und werden zur Erneuerung vorgemerkt', () => {
    const salz = 'ab'.repeat(16);
    const alt = `${salz}:${crypto.pbkdf2Sync('Altes-Passwort', salz, 1000, 64, 'sha512').toString('hex')}`;
    assert.equal(verifyPassword('Altes-Passwort', alt), true);
    assert.equal(verifyPassword('falsch', alt), false);
    assert.equal(brauchtNeuenHash(alt), true);
    // ein schwächeres v2-Format (weniger Durchläufe) wird ebenfalls erneuert
    const schwach = `v2$5000$${salz}$${crypto.pbkdf2Sync('x', salz, 5000, 64, 'sha512').toString('hex')}`;
    assert.equal(verifyPassword('x', schwach), true);
    assert.equal(brauchtNeuenHash(schwach), true);
});

test('Passwort: ungültige und manipulierte Werte', () => {
    for (const kaputt of [null, undefined, '', 'kein-trenner', 'x:y', ':', 'v2$', 'v2$abc$salz$hash', 'v2$5$salz$hash', 'v2$99999999999$salz$hash', 'v2$210000$$']) {
        assert.equal(verifyPassword('egal', kaputt), false, String(kaputt));
    }
    assert.equal(brauchtNeuenHash(null), false);
    assert.equal(verifyPassword(null, hashPassword('a')), false);
    const h = hashPassword('Geheim-1234');
    assert.equal(verifyPassword('Geheim-1234', h.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), false, 'ein verändertes Hash-Zeichen');
});
