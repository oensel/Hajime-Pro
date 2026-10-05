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

// Release-Double mit Streaming-Antworten (Body als Web-Stream) und Range-Unterstützung.
function baueStromRelease({ inhalt = Buffer.alloc(300_000, 7), tag = 'v1.2.0', geliefert = inhalt, mitRange = true, abbruchNach = Infinity } = {}) {
    const { fetchFn: basisFetch } = baueRelease({ tag, inhalt });
    const anfragen = [];
    const fetchFn = async (url, opt = {}) => {
        if (url !== 'u://installer') return basisFetch(url, opt);
        const range = opt.headers && opt.headers.Range;
        anfragen.push(range || null);
        const von = range && mitRange ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
        const teil = geliefert.subarray(von);
        let gesendet = 0;
        const body = new ReadableStream({
            pull(ctrl) {
                if (gesendet >= teil.length) return ctrl.close();
                const stueck = teil.subarray(gesendet, gesendet + 50_000);
                gesendet += stueck.length;
                if (gesendet + von > abbruchNach) { ctrl.error(new TypeError('terminated')); return; }
                ctrl.enqueue(stueck);
            }
        });
        return { ok: true, status: range && mitRange ? 206 : 200, headers: new Headers({ 'content-length': String(teil.length) }), body };
    };
    return { fetchFn, anfragen, inhalt };
}

test('Download läuft als Stream mit Fortschritt und legt den geprüften Installer ab', async () => {
    const { fetchFn, inhalt } = baueStromRelease();
    const env = umgebung();
    const stand = [];
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn, beiFortschritt: s => stand.push(s) });
    assert.equal(erg.status, 'bereit');
    assert.deepEqual(readFileSync(erg.datei), inhalt);
    assert.ok(stand.length > 1, 'mehrere Fortschrittsmeldungen');
    const letzte = stand[stand.length - 1];
    assert.equal(letzte.geladen, inhalt.length);
    assert.equal(letzte.gesamt, inhalt.length);
    assert.equal(letzte.version, '1.2.0');
});

test('Abbruch im Download: Teildatei bleibt, der nächste Versuch setzt per Range fort', async () => {
    const env = umgebung();
    const inhalt = Buffer.alloc(300_000, 7);
    const erster = baueStromRelease({ inhalt, abbruchNach: 120_000 });
    const erg1 = await pruefeUndLade({ ...basis, ...env, fetchFn: erster.fetchFn });
    assert.equal(erg1.status, 'keine-verbindung');
    assert.deepEqual(liesVersuche(env.versuchsDatei), {}, 'kein Fehlversuch');
    const zweiter = baueStromRelease({ inhalt });
    const erg2 = await pruefeUndLade({ ...basis, ...env, fetchFn: zweiter.fetchFn });
    assert.equal(erg2.status, 'bereit');
    assert.match(zweiter.anfragen[0], /^bytes=\d+-$/);
    assert.deepEqual(readFileSync(erg2.datei), inhalt);
});

test('Server ignoriert Range (200): Download beginnt von vorn und ist trotzdem korrekt', async () => {
    const env = umgebung();
    const inhalt = Buffer.alloc(300_000, 9);
    await pruefeUndLade({ ...basis, ...env, fetchFn: baueStromRelease({ inhalt, abbruchNach: 100_000 }).fetchFn });
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn: baueStromRelease({ inhalt, mitRange: false }).fetchFn });
    assert.equal(erg.status, 'bereit');
    assert.deepEqual(readFileSync(erg.datei), inhalt);
});

test('falsche Prüfsumme der geladenen Datei: Datei wird verworfen', async () => {
    const env = umgebung();
    const inhalt = Buffer.alloc(100_000, 1);
    const { fetchFn } = baueStromRelease({ inhalt, geliefert: Buffer.alloc(100_000, 2) });
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn });
    assert.equal(erg.status, 'fehler');
    assert.match(erg.grund, /sha256/);
    assert.equal(existsSync(path.join(env.zielVerzeichnis, 'Hajime-Pro-Server-1.2.0-win-x64.exe.teil')), false);
    assert.equal(existsSync(path.join(env.zielVerzeichnis, 'Hajime-Pro-Server-1.2.0-win-x64.exe')), false);
});

test('schon geladener, geprüfter Installer wird nicht erneut heruntergeladen', async () => {
    const env = umgebung();
    const erster = baueStromRelease();
    await pruefeUndLade({ ...basis, ...env, fetchFn: erster.fetchFn });
    const zweiter = baueStromRelease();
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn: zweiter.fetchFn });
    assert.equal(erg.status, 'bereit');
    assert.equal(zweiter.anfragen.length, 0);
});

test('Leerlauf: keine Daten mehr -> Abbruch statt ewig warten', async () => {
    const env = umgebung();
    const { fetchFn: basisFetch } = baueStromRelease();
    const haengt = async (url, opt) => {
        if (url !== 'u://installer') return basisFetch(url, opt);
        // Wie ein echter fetch-Body: ein Abbruch über das Signal beendet das hängende Lesen mit einem Fehler.
        const body = new ReadableStream({ pull() { return new Promise((_, nein) => opt.signal.addEventListener('abort', () => nein(new DOMException('aborted', 'AbortError')))); } });
        return { ok: true, status: 200, headers: new Headers({ 'content-length': '1000' }), body };
    };
    const erg = await pruefeUndLade({ ...basis, ...env, fetchFn: haengt, leerlaufMs: 150 });
    assert.equal(erg.status, 'keine-verbindung');
});
