import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { erzeugeEinstellungen } from '../../desktop/einstellungen.js';

test('erste Ladung erzeugt clientId und Standardwerte, speichere ergänzt und bleibt erhalten', () => {
    const datei = path.join(mkdtempSync(path.join(tmpdir(), 'einst-')), 'einstellungen.json');
    const e = erzeugeEinstellungen(datei);
    const erst = e.lade();
    assert.match(erst.clientId, /^[0-9a-f-]{36}$/);
    assert.deepEqual({ ...erst, clientId: 'x' }, { serverUrl: null, secret: null, clientId: 'x', updateVersuche: {} });
    e.speichere({ serverUrl: 'http://1.2.3.4:3000', updateVersuche: { '1.3.0': 1 } });
    const zweit = erzeugeEinstellungen(datei).lade();
    assert.equal(zweit.clientId, erst.clientId);
    assert.equal(zweit.serverUrl, 'http://1.2.3.4:3000');
    assert.deepEqual(zweit.updateVersuche, { '1.3.0': 1 });
});

test('kaputte Datei führt zu Standardwerten statt Absturz', () => {
    const datei = path.join(mkdtempSync(path.join(tmpdir(), 'einst-')), 'einstellungen.json');
    writeFileSync(datei, '{kaputt');
    assert.equal(erzeugeEinstellungen(datei).lade().serverUrl, null);
});
