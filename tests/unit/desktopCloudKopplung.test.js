import test from 'node:test';
import assert from 'node:assert/strict';
import { koppleCloud } from '../../desktop/cloudKopplung.js';

const schluessel = 'AbCdEfGhIjKlMnOpQrStUv';
const link = `https://hajime.example.de/turnierlive/${schluessel}#code=123456`;
const antwort = (status, daten = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => daten });

test('Cloud-Link koppelt: POST an die turnierbezogene Adresse mit dem Code, Geheimnis kommt zurück', async () => {
    const aufrufe = [];
    const fetchFn = async (url, optionen) => { aufrufe.push({ url, body: JSON.parse(optionen.body) }); return antwort(200, { secret: 'geheim' }); };
    const r = await koppleCloud(link, { clientId: 'c1', fetchFn });
    assert.deepEqual(r, { ok: true, serverUrl: `https://hajime.example.de/turnierlive/${schluessel}`, secret: 'geheim' });
    assert.deepEqual(aufrufe, [{ url: `https://hajime.example.de/turnierlive/${schluessel}/api/client/koppeln`, body: { code: '123456', clientId: 'c1' } }]);
});

test('Kein Cloud-Link (Hallen-Server-QR, Text, leer): verständliche Meldung, kein Netzzugriff', async () => {
    let gerufen = false;
    const fetchFn = async () => { gerufen = true; return antwort(200); };
    for (const eingabe of ['', 'hallo', 'http://192.168.1.5:3000/download#code=123456']) {
        const r = await koppleCloud(eingabe, { clientId: 'c1', fetchFn });
        assert.equal(r.ok, false);
        assert.match(r.fehler, /Cloud/);
    }
    assert.equal(gerufen, false);
});

test('Antworten der Cloud werden in Meldungen übersetzt', async () => {
    const mit = (status, daten) => koppleCloud(link, { clientId: 'c1', fetchFn: async () => antwort(status, daten) });
    assert.match((await mit(401)).fehler, /Code falsch/);
    assert.match((await mit(429, { restSekunden: 42 })).fehler, /42 s/);
    assert.match((await mit(403, { grund: 'gesperrt' })).fehler, /gesperrt/);
    assert.match((await mit(403, { grund: 'abgelaufen' })).fehler, /abgelaufen/);
    assert.match((await mit(410)).fehler, /beendet/);
    assert.match((await mit(404)).fehler, /kein Turnier/);
    assert.match((await mit(500)).fehler, /HTTP 500/);
    const unerreichbar = await koppleCloud(link, { clientId: 'c1', fetchFn: async () => { throw new Error('offline'); } });
    assert.equal(unerreichbar.ok, false);
    assert.match(unerreichbar.fehler, /nicht erreichbar/);
});
