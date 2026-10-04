import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueKopplungsUrl, leseKopplungsUrl, normalisiereServerAdresse } from '../../src/shared/kopplungsQr.js';

test('Kopplungs-URL: bauen und wieder lesen', () => {
    const url = baueKopplungsUrl('http://192.168.1.5:3000/', '123 456');
    assert.equal(url, 'http://192.168.1.5:3000/download#code=123456');
    assert.deepEqual(leseKopplungsUrl(url), { serverUrl: 'http://192.168.1.5:3000', code: '123456' });
});

test('Kopplungs-URL ohne Port (Port 80) bleibt ohne Port', () => {
    assert.deepEqual(leseKopplungsUrl('http://192.168.1.5/download#code=000001'), { serverUrl: 'http://192.168.1.5', code: '000001' });
});

test('Fremde oder unvollständige QR-Inhalte werden abgelehnt', () => {
    for (const text of ['', 'hallo', '{"vorname":"Anna"}', 'http://192.168.1.5:3000/', 'http://192.168.1.5:3000/download',
        'http://192.168.1.5:3000/download#code=12345', 'http://192.168.1.5:3000/download#code=abcdef',
        'ftp://192.168.1.5/download#code=123456', 'https://qr.dokume.net/?x=1&s=a.b.c']) {
        assert.equal(leseKopplungsUrl(text), null, text);
    }
});

test('Server-Adresse aus Anwendereingaben', () => {
    assert.equal(normalisiereServerAdresse('192.168.1.5:3000'), 'http://192.168.1.5:3000');
    assert.equal(normalisiereServerAdresse('  turnier.local '), 'http://turnier.local');
    assert.equal(normalisiereServerAdresse('http://10.0.0.2:3000/irgendwas'), 'http://10.0.0.2:3000');
    assert.equal(normalisiereServerAdresse(''), '');
});
