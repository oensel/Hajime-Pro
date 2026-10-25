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

test('Cloud-Kopplungs-QR: Adresse mit Turnierschlüssel und Code im Fragment, hin und zurück', async () => {
    const { baueCloudKopplungsUrl } = await import('../../src/shared/kopplungsQr.js');
    const schluessel = 'AbCdEfGhIjKlMnOpQrStUv';
    const text = baueCloudKopplungsUrl('https://hajime.example.de/', schluessel, '123 456');
    assert.equal(text, `https://hajime.example.de/turnierlive/${schluessel}#code=123456`);
    assert.deepEqual(leseKopplungsUrl(text), { serverUrl: `https://hajime.example.de/turnierlive/${schluessel}`, code: '123456' });
    // auch mit der Hinweisseite /download dahinter (Kamera-App öffnet sie)
    assert.deepEqual(leseKopplungsUrl(`https://hajime.example.de/turnierlive/${schluessel}/download#code=654321`),
        { serverUrl: `https://hajime.example.de/turnierlive/${schluessel}`, code: '654321' });
    // Hallen-Server-Format bleibt unverändert
    assert.deepEqual(leseKopplungsUrl('http://192.168.1.5:3000/download#code=111222'), { serverUrl: 'http://192.168.1.5:3000', code: '111222' });
    // ungültiger Schlüssel oder fehlender Code
    assert.equal(leseKopplungsUrl('https://hajime.example.de/turnierlive/zu-kurz#code=123456'), null);
    assert.equal(leseKopplungsUrl(`https://hajime.example.de/turnierlive/${schluessel}`), null);
});
