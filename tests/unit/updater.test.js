import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { generateKeyPairSync, sign } from 'crypto';
import {
    holeServerVersion, pruefeUndAktualisiere, macAustauschBefehl, linuxUmgebung, tauscheAppImage, starteLoesgeloest
} from '../../desktop/updater.js';
import { erzeugeEinstellungen } from '../../desktop/einstellungen.js';
import { sha256Hex, signaturNachricht } from '../../desktop/updateLogik.js';

function server(handler) {
    return new Promise((resolve) => {
        const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
    });
}

test('liefert version.json', async () => {
    const s = await server((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"version":"1.3.0","dateien":{}}'); });
    assert.deepEqual(await holeServerVersion(`http://127.0.0.1:${s.address().port}`), { version: '1.3.0', dateien: {} });
    s.close();
});

test('404 -> null', async () => {
    const s = await server((req, res) => { res.statusCode = 404; res.end('{}'); });
    assert.equal(await holeServerVersion(`http://127.0.0.1:${s.address().port}`), null);
    s.close();
});

test('hängender Server -> null nach Zeitlimit', async () => {
    const s = await server(() => { /* antwortet nie */ });
    const start = Date.now();
    assert.equal(await holeServerVersion(`http://127.0.0.1:${s.address().port}`, { timeoutMs: 300 }), null);
    assert.ok(Date.now() - start < 2000);
    s.closeAllConnections(); s.close();
});

test('kein JSON bzw. ohne Versionsfeld -> null', async () => {
    const s = await server((req, res) => { res.end(req.url.includes('x') ? 'kein json' : '{"dateien":{}}'); });
    assert.equal(await holeServerVersion(`http://127.0.0.1:${s.address().port}`), null);
    s.close();
});

// --- Ablauf von pruefeUndAktualisiere mit gefälschtem Electron-app und Austausch -----------------

const plattform = process.platform === 'darwin' ? 'darwin-universal' : process.platform === 'linux' ? 'linux-x64' : 'win32-x64';

function testUmgebung({ eigeneVersion = '1.0.0', serverVersion = '1.0.1', inhalt = Buffer.from('neue Version'), manipuliert = false, versuche = {} } = {}) {
    const ordner = mkdtempSync(path.join(tmpdir(), 'updater-'));
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const schluesselPfad = path.join(ordner, 'update-schluessel.pub');
    writeFileSync(schluesselPfad, publicKey.export({ type: 'spki', format: 'pem' }));
    const datei = 'Hajime-Pro-Test.bin';
    const sha256 = sha256Hex(inhalt);
    const signatur = sign(null, Buffer.from(signaturNachricht({ datei, version: serverVersion, sha256 })), privateKey).toString('base64');
    const vj = { version: serverVersion, dateien: { [plattform]: { aktualisieren: { datei, sha256, signatur } } } };
    const einstellungen = erzeugeEinstellungen(path.join(ordner, 'profil', 'einstellungen.json'));
    einstellungen.speichere({ updateVersuche: versuche });
    const app = { isPackaged: true, getVersion: () => eigeneVersion, getPath: () => path.join(ordner, 'profil'), quit() { app.beendet = true; } };
    const meldungen = [];
    const ausgetauscht = [];
    return {
        ordner, vj, einstellungen, app, meldungen, ausgetauscht, schluesselPfad,
        antwort: manipuliert ? Buffer.concat([inhalt, Buffer.from('!')]) : inhalt,
        optionen: (serverUrl) => ({
            serverUrl, einstellungen, status: t => meldungen.push(t), app, schluesselPfad,
            tauscheAus: async (a) => { ausgetauscht.push(a); }
        })
    };
}

function updateServer(u) {
    return server((req, res) => {
        if (req.url === '/api/client/version') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(u.vj)); }
        if (req.url === `/downloads/${u.vj.version}/Hajime-Pro-Test.bin`) return res.end(u.antwort);
        res.statusCode = 404; res.end();
    });
}

test('Update: lädt, prüft, speichert Datei, zählt Versuch und meldet neustart', async () => {
    const u = testUmgebung();
    const s = await updateServer(u);
    const ergebnis = await pruefeUndAktualisiere(u.optionen(`http://127.0.0.1:${s.address().port}`));
    s.close();
    assert.equal(ergebnis, 'neustart');
    assert.equal(u.ausgetauscht.length, 1);
    assert.equal(u.ausgetauscht[0].plattform, plattform);
    assert.equal(readFileSync(u.ausgetauscht[0].datei, 'utf8'), 'neue Version');
    assert.deepEqual(u.einstellungen.lade().updateVersuche, { '1.0.1': 1 });
});

test('manipulierte Datei: verworfen, Versuch gezählt, alte Version startet', async () => {
    const u = testUmgebung({ manipuliert: true });
    const s = await updateServer(u);
    const ergebnis = await pruefeUndAktualisiere(u.optionen(`http://127.0.0.1:${s.address().port}`));
    s.close();
    assert.equal(ergebnis, 'weiter');
    assert.equal(u.ausgetauscht.length, 0);
    assert.ok(u.meldungen.some(m => m.includes('Update verworfen')));
    assert.deepEqual(u.einstellungen.lade().updateVersuche, { '1.0.1': 1 });
});

test('fehlgeschlagener Austausch: weiter, keine Beendigung', async () => {
    const u = testUmgebung();
    const s = await updateServer(u);
    const optionen = { ...u.optionen(`http://127.0.0.1:${s.address().port}`), tauscheAus: async () => { throw new Error('spawn EACCES'); } };
    const ergebnis = await pruefeUndAktualisiere(optionen);
    s.close();
    assert.equal(ergebnis, 'weiter');
    assert.ok(u.meldungen.some(m => m.includes('spawn EACCES')));
});

test('nach zwei Versuchen aufgegeben: weiter, Hinweis für die Statusleiste gesetzt', async () => {
    delete process.env.HAJIME_UPDATE_HINWEIS;
    const u = testUmgebung({ versuche: { '1.0.1': 2 } });
    const s = await updateServer(u);
    const ergebnis = await pruefeUndAktualisiere(u.optionen(`http://127.0.0.1:${s.address().port}`));
    s.close();
    assert.equal(ergebnis, 'weiter');
    assert.equal(u.ausgetauscht.length, 0);
    assert.match(process.env.HAJIME_UPDATE_HINWEIS, /Update auf 1\.0\.1 fehlgeschlagen/);
    delete process.env.HAJIME_UPDATE_HINWEIS;
});

test('gleiche Version: weiter ohne Versuch; Zähler der eigenen Version wird gelöscht', async () => {
    const u = testUmgebung({ eigeneVersion: '1.0.1', versuche: { '1.0.1': 1, '0.9.0': 2 } });
    const s = await updateServer(u);
    const ergebnis = await pruefeUndAktualisiere(u.optionen(`http://127.0.0.1:${s.address().port}`));
    s.close();
    assert.equal(ergebnis, 'weiter');
    assert.deepEqual(u.einstellungen.lade().updateVersuche, { '0.9.0': 2 });
});

test('Server nicht erreichbar: sofort weiter', async () => {
    const u = testUmgebung();
    const ergebnis = await pruefeUndAktualisiere(u.optionen('http://127.0.0.1:1'));
    assert.equal(ergebnis, 'weiter');
    assert.deepEqual(u.einstellungen.lade().updateVersuche, {});
});

test('fehlender öffentlicher Schlüssel: weiter, kein Versuch gezählt', async () => {
    const u = testUmgebung();
    const s = await updateServer(u);
    const optionen = { ...u.optionen(`http://127.0.0.1:${s.address().port}`), schluesselPfad: path.join(u.ordner, 'fehlt.pub') };
    const ergebnis = await pruefeUndAktualisiere(optionen);
    s.close();
    assert.equal(ergebnis, 'weiter');
    assert.deepEqual(u.einstellungen.lade().updateVersuche, {});
});

test('kaputte version.json (ohne dateien) wirft nicht', async () => {
    const u = testUmgebung();
    u.vj = { version: '1.0.1' };
    const s = await updateServer(u);
    const ergebnis = await pruefeUndAktualisiere(u.optionen(`http://127.0.0.1:${s.address().port}`));
    s.close();
    assert.equal(ergebnis, 'weiter');
});

test('Entwicklungsstart (nicht gepackt): nie aktualisieren', async () => {
    const u = testUmgebung();
    u.app.isPackaged = false;
    const ergebnis = await pruefeUndAktualisiere(u.optionen('http://127.0.0.1:1'));
    assert.equal(ergebnis, 'weiter');
});

// --- Plattform-Bausteine -------------------------------------------------------------------------

test('starteLoesgeloest: nicht startbares Programm -> Fehler statt stiller Beendigung', async () => {
    await assert.rejects(starteLoesgeloest(path.join(tmpdir(), 'gibt-es-nicht-4711.exe'), []));
});

test('starteLoesgeloest: startbares Programm -> erfüllt', async () => {
    await starteLoesgeloest(process.execPath, ['-e', '']);
});

test('linuxUmgebung entfernt AppImage-Variablen', () => {
    assert.deepEqual(linuxUmgebung({ APPIMAGE: '/a', APPDIR: '/b', OWD: '/c', ARGV0: 'd', HOME: '/h' }), { HOME: '/h' });
});

test('tauscheAppImage ersetzt die Datei und hinterlässt keine .neu-Datei', () => {
    const ordner = mkdtempSync(path.join(tmpdir(), 'appimage-'));
    const ziel = path.join(ordner, 'Hajime-Pro.AppImage');
    const quelle = path.join(ordner, 'download.AppImage');
    writeFileSync(ziel, 'alt');
    writeFileSync(quelle, 'neu');
    tauscheAppImage({ quelle, ziel });
    assert.equal(readFileSync(ziel, 'utf8'), 'neu');
    assert.equal(existsSync(`${ziel}.neu`), false);
});

const shVerfuegbar = !spawnSync('sh', ['-c', 'exit 0']).error;

function macSkriptAusfuehren({ appPfad, neu }) {
    const [befehl, args] = macAustauschBefehl({ pid: 999999, appPfad, neu, oeffnen: 'true' });
    return spawnSync(befehl === '/bin/sh' ? 'sh' : befehl, args, { encoding: 'utf8' });
}

test('macAustauschBefehl: tauscht das Bundle aus (Pfade mit Leerzeichen/Sonderzeichen)', { skip: !shVerfuegbar && 'sh fehlt' }, () => {
    const ordner = mkdtempSync(path.join(tmpdir(), 'mac $x `y` ')).replaceAll('\\', '/');
    const appPfad = `${ordner}/Hajime Pro.app`;
    const neu = `${ordner}/entpackt/Hajime Pro.app`;
    mkdirSync(appPfad, { recursive: true }); writeFileSync(`${appPfad}/v`, 'alt');
    mkdirSync(neu, { recursive: true }); writeFileSync(`${neu}/v`, 'neu');
    const r = macSkriptAusfuehren({ appPfad, neu });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(`${appPfad}/v`, 'utf8'), 'neu');
});

test('macAustauschBefehl: fehlt das neue Bundle, bleibt das alte erhalten', { skip: !shVerfuegbar && 'sh fehlt' }, () => {
    const ordner = mkdtempSync(path.join(tmpdir(), 'mac-')).replaceAll('\\', '/');
    const appPfad = `${ordner}/Hajime Pro.app`;
    mkdirSync(appPfad, { recursive: true }); writeFileSync(`${appPfad}/v`, 'alt');
    macSkriptAusfuehren({ appPfad, neu: `${ordner}/gibt-es-nicht.app` });
    assert.equal(readFileSync(`${appPfad}/v`, 'utf8'), 'alt');
});

test('Reste früherer Downloads im Profil werden beim Start entfernt', async () => {
    const u = testUmgebung({ eigeneVersion: '1.0.1' });
    const alt = path.join(u.ordner, 'profil', 'updates', 'Hajime-Pro-1.0.1-win-x64.exe');
    mkdirSync(path.dirname(alt), { recursive: true });
    writeFileSync(alt, 'alt');
    assert.equal(await pruefeUndAktualisiere(u.optionen('http://127.0.0.1:1')), 'weiter');
    assert.equal(existsSync(alt), false);
});
