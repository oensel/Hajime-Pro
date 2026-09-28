import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'crypto';
import { plattformSchluessel, signaturNachricht, sha256Hex, pruefeDatei, entscheideUpdate, waehleServer } from '../../desktop/updateLogik.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pub = publicKey.export({ type: 'spki', format: 'pem' });
function signiert(puffer, datei = 'a.exe', version = '1.2.0') {
    const sha256 = sha256Hex(puffer);
    const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version, sha256 })), privateKey).toString('base64');
    return { datei, sha256, signatur };
}

test('plattformSchluessel', () => {
    assert.equal(plattformSchluessel('win32', 'x64'), 'win32-x64');
    assert.equal(plattformSchluessel('darwin', 'arm64'), 'darwin-universal');
    assert.equal(plattformSchluessel('darwin', 'x64'), 'darwin-universal');
    assert.equal(plattformSchluessel('linux', 'x64'), 'linux-x64');
    assert.equal(plattformSchluessel('linux', 'arm64'), null);
    assert.equal(plattformSchluessel('win32', 'arm64'), null);
});

test('korrekt signierte Datei wird akzeptiert', () => {
    const puffer = Buffer.from('INHALT');
    assert.deepEqual(pruefeDatei({ puffer, eintrag: signiert(puffer), version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: true });
});

test('abgeschnittene Datei (Download abgebrochen) scheitert an sha256', () => {
    const puffer = Buffer.from('INHALT-VOLLSTAENDIG');
    const eintrag = signiert(puffer);
    assert.deepEqual(pruefeDatei({ puffer: puffer.subarray(0, 5), eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: false, grund: 'sha256' });
});

test('manipulierte Datei mit passend neu berechnetem sha256 scheitert an der Signatur', () => {
    const echt = signiert(Buffer.from('ECHT'));
    const boese = Buffer.from('BOESE');
    const eintrag = { ...echt, sha256: sha256Hex(boese) };
    assert.deepEqual(pruefeDatei({ puffer: boese, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: false, grund: 'signatur' });
});

test('Signatur einer anderen Version wird nicht akzeptiert', () => {
    const puffer = Buffer.from('X');
    const eintrag = signiert(puffer, 'a.exe', '1.1.0');
    assert.equal(pruefeDatei({ puffer, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }).ok, false);
});

test('kaputte Signatur (kein base64) wirft nicht, sondern scheitert', () => {
    const puffer = Buffer.from('X');
    const eintrag = { ...signiert(puffer), signatur: '###' };
    assert.equal(pruefeDatei({ puffer, eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }).ok, false);
});

test('entscheideUpdate: gleich, abweichend (auch nach unten), Schleifenschutz', () => {
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.2.0', versuche: {} }), 'kein');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: {} }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.1.0', versuche: {} }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: { '1.3.0': 1 } }), 'aktualisieren');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: '1.3.0', versuche: { '1.3.0': 2 } }), 'aufgegeben');
    assert.equal(entscheideUpdate({ eigeneVersion: '1.2.0', serverVersion: null, versuche: {} }), 'kein');
});

test('waehleServer bevorzugt rolle=master, sonst den ersten, leer -> null', () => {
    assert.equal(waehleServer([]), null);
    assert.deepEqual(waehleServer([{ url: 'http://a' }, { url: 'http://b', rolle: 'master' }]), { url: 'http://b', rolle: 'master' });
    assert.deepEqual(waehleServer([{ url: 'http://a' }, { url: 'http://b' }]), { url: 'http://a' });
});
