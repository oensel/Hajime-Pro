import test from 'node:test';
import assert from 'node:assert/strict';
import { waehleServer } from '../../src/shared/serverAuswahl.js';
import { normalisiereServerAdresse } from '../../src/shared/kopplungsQr.js';

const cloud = { serverUrl: 'https://hajime.example.de/turnierlive/AbCdEfGhIjKlMnOpQrStUv', secret: 'x' };

test('Hallen-Server im WLAN gefunden: immer er, ohne Rückfrage, auch wenn die Cloud gekoppelt ist', async () => {
    let gefragt = false;
    const wahl = await waehleServer({ hallenServerErreichbar: true, cloud, frageCloud: async () => { gefragt = true; return true; } });
    assert.equal(wahl, 'hallenserver');
    assert.equal(gefragt, false);
});

test('Kein Hallen-Server, Cloud gekoppelt: Rückfrage; Ja → Cloud, Nein → keiner (Gerät arbeitet lokal weiter)', async () => {
    assert.equal(await waehleServer({ hallenServerErreichbar: false, cloud, frageCloud: async () => true }), 'cloud');
    assert.equal(await waehleServer({ hallenServerErreichbar: false, cloud, frageCloud: async () => false }), 'keiner');
});

test('Kein Hallen-Server und keine Cloud-Kopplung: keiner, ohne Rückfrage', async () => {
    let gefragt = false;
    assert.equal(await waehleServer({ hallenServerErreichbar: false, cloud: null, frageCloud: async () => { gefragt = true; return true; } }), 'keiner');
    assert.equal(gefragt, false);
});

test('Server-Adresse: der Turnierpfad der Cloud bleibt erhalten, sonst nur der Origin', () => {
    const pfad = '/turnierlive/AbCdEfGhIjKlMnOpQrStUv';
    assert.equal(normalisiereServerAdresse(`https://hajime.example.de${pfad}/`), `https://hajime.example.de${pfad}`);
    assert.equal(normalisiereServerAdresse(`hajime.example.de${pfad}`), `http://hajime.example.de${pfad}`);
    assert.equal(normalisiereServerAdresse('192.168.1.10/irgendwas'), 'http://192.168.1.10');
    assert.equal(normalisiereServerAdresse('turnier.local:3000'), 'http://turnier.local:3000');
});
