import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'crypto';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { istNeuer, liesVersuche, merkeVersuch, pruefeUndLade } from '../../desktop/server/selbstUpdate.js';
import { sha256Hex, signaturNachricht } from '../../desktop/updateLogik.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const schluessel = publicKey.export({ type: 'spki', format: 'pem' });

// Baut ein Release-Double: Tag, Installer-Inhalt, optional manipulierte Signatur.
function baueRelease({ tag = 'v1.2.0', inhalt = Buffer.from('INSTALLER'), signaturVon = inhalt, ohneVersionJson = false } = {}) {
    const version = tag.replace(/^v/, '');
    const datei = `Hajime-Pro-Server-${version}-win-x64.exe`;
    const sha256 = sha256Hex(inhalt);
    const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version, sha256: sha256Hex(signaturVon) })), privateKey).toString('base64');
    const vj = { version, dateien: { 'win32-x64': { installieren: { datei, sha256, signatur } } } };
    const assets = [{ name: datei, url: 'u://installer' }];
    if (!ohneVersionJson) assets.push({ name: 'server-version.json', url: 'u://vj' });
    const antwortFuer = {
        'u://installer': inhalt,
        'u://vj': Buffer.from(JSON.stringify(vj))
    };
    const fetchFn = async (url) => {
        if (url.endsWith('/releases/latest')) return { ok: true, status: 200, json: async () => ({ tag_name: tag, assets }) };
        const koerper = antwortFuer[url];
        return { ok: !!koerper, status: koerper ? 200 : 404, arrayBuffer: async () => koerper };
    };
    return { fetchFn, datei };
}

function umgebung() {
    const verz = mkdtempSync(path.join(tmpdir(), 'selbstupdate-'));
    return { zielVerzeichnis: path.join(verz, 'updates'), versuchsDatei: path.join(verz, 'selbstupdate.json') };
}

const basis = { repo: 'x/y', aktuelleVersion: '1.0.4', schluessel, platform: 'win32', arch: 'x64', log: { log() {}, warn() {} } };

test('istNeuer vergleicht numerisch und lehnt Gleiches, Älteres und Unbrauchbares ab', () => {
    assert.equal(istNeuer('1.10.0', '1.9.9'), true);
    assert.equal(istNeuer('v2.0.0', '1.99.99'), true);
    assert.equal(istNeuer('1.0.4', '1.0.4'), false);
    assert.equal(istNeuer('1.0.3', '1.0.4'), false);
    assert.equal(istNeuer('1.1.0-beta.1', '1.0.4'), false);
    assert.equal(istNeuer('', '1.0.4'), false);
});

test('neuere Version: Installer wird geladen, geprüft und abgelegt', async () => {
    const { fetchFn, datei } = baueRelease();
    const env = umgebung();
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn });
    assert.equal(erg.status, 'bereit');
    assert.equal(erg.version, '1.2.0');
    assert.equal(path.basename(erg.datei), datei);
    assert.equal(readFileSync(erg.datei, 'utf8'), 'INSTALLER');
});

test('gleiche oder ältere Version: nichts wird geladen', async () => {
    const env = umgebung();
    for (const tag of ['v1.0.4', 'v1.0.0']) {
        const erg = await pruefeUndLade({ ...basis, ...env, fetchFn: baueRelease({ tag }).fetchFn });
        assert.equal(erg.status, 'aktuell');
    }
    assert.equal(existsSync(env.zielVerzeichnis), false);
});

test('kein Internet: Status keine-verbindung, kein Fehler', async () => {
    const fetchFn = async () => { throw new TypeError('fetch failed'); };
    const erg = await pruefeUndLade({ ...basis, ...umgebung(), fetchFn });
    assert.equal(erg.status, 'keine-verbindung');
});

test('Abbruch mitten im Download zählt nicht als Update-Versuch', async () => {
    const { fetchFn } = baueRelease();
    const kaputt = async (url, opt) => {
        if (url === 'u://installer') throw new TypeError('terminated');
        return fetchFn(url, opt);
    };
    const erg = await pruefeUndLade({ ...basis, ...umgebung(), fetchFn: kaputt });
    assert.equal(erg.status, 'keine-verbindung');
});

test('kein Release (404) und fehlende server-version.json laufen ohne Update durch', async () => {
    const f404 = async () => ({ ok: false, status: 404 });
    assert.equal((await pruefeUndLade({ ...basis, ...umgebung(), fetchFn: f404 })).status, 'kein-release');
    const erg = await pruefeUndLade({ ...basis, ...umgebung(), fetchFn: baueRelease({ ohneVersionJson: true }).fetchFn });
    assert.equal(erg.status, 'fehler');
    assert.match(erg.grund, /server-version\.json/);
});

test('manipulierter Installer (Signatur passt nicht) wird nicht abgelegt', async () => {
    const env = umgebung();
    const { fetchFn } = baueRelease({ inhalt: Buffer.from('BOESE'), signaturVon: Buffer.from('ECHT') });
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn });
    assert.equal(erg.status, 'fehler');
    assert.match(erg.grund, /signatur/);
    assert.equal(existsSync(env.zielVerzeichnis), false);
});

test('nach zwei Versuchen für dieselbe Version wird aufgegeben', async () => {
    const env = umgebung();
    merkeVersuch(env.versuchsDatei, '1.2.0');
    merkeVersuch(env.versuchsDatei, '1.2.0');
    assert.deepEqual(liesVersuche(env.versuchsDatei), { '1.2.0': 2 });
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn: baueRelease().fetchFn });
    assert.equal(erg.status, 'aufgegeben');
});

test('andere Plattformen als Windows werden nicht angefasst', async () => {
    const fetchFn = async () => { throw new Error('darf nicht aufgerufen werden'); };
    for (const [platform, arch] of [['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'arm64']]) {
        const erg = await pruefeUndLade({ ...basis, ...umgebung(), platform, arch, fetchFn });
        assert.equal(erg.status, 'nicht-unterstuetzt');
    }
});
