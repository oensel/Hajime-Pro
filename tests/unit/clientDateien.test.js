// Automatische Bereitstellung der Client-Dateien am Server: mitgelieferte Dateien kopieren, GitHub-Release
// laden (mit/ohne Token, Wiederaufnahme, Wiederholung), Prüfung der Signatur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import { generateKeyPairSync } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { erzeugeVersionJson } from '../../scripts/signiere-client.mjs';
import { erzeugeClientDateien } from '../../src/sync/clientDateien.js';

const VERSION = '3.1.0';
const stumm = { log() {}, warn() {} };

function schluessel() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return { oeffentlich: publicKey.export({ type: 'spki', format: 'pem' }), privat: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

// Ein signiertes Release-Verzeichnis (Windows, macOS, Linux, Android) wie es release.yml erzeugt.
function baueRelease(privat, version = VERSION) {
    const dir = mkdtempSync(path.join(tmpdir(), 'release-'));
    const dateien = {
        [`Hajime-Pro-${version}-win-x64.exe`]: 'WINDOWS', [`Hajime-Pro-${version}-mac-universal.dmg`]: 'DMG',
        [`Hajime-Pro-${version}-mac-universal.zip`]: 'ZIP', [`Hajime-Pro-${version}-linux-x86_64.AppImage`]: 'LINUX',
        [`Hajime-Pro-${version}.apk`]: 'ANDROID'
    };
    for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(path.join(dir, name), inhalt);
    erzeugeVersionJson({ verzeichnis: dir, version, privaterSchluessel: privat });
    return dir;
}

const tempDir = (praefix) => mkdtempSync(path.join(tmpdir(), praefix));
const dateienIn = (dir) => readdirSync(dir).filter(n => !n.endsWith('.teil')).sort();

test('mitgelieferte Dateien werden kopiert, version.json kommt zuletzt und ein zweiter Lauf ändert nichts', async () => {
    const k = schluessel();
    const quelle = baueRelease(k.privat);
    const downloads = tempDir('downloads-');
    const cd = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, mitgeliefert: quelle, autoHolen: false, schluessel: k.oeffentlich, log: stumm });
    assert.equal(cd.status().phase, 'unbekannt');
    await cd.starte();
    assert.equal(cd.status().phase, 'bereit');
    const ziel = path.join(downloads, VERSION);
    assert.deepEqual(dateienIn(ziel), dateienIn(quelle));
    assert.equal(readFileSync(path.join(ziel, `Hajime-Pro-${VERSION}.apk`), 'utf8'), 'ANDROID');
    const vj = JSON.parse(readFileSync(path.join(ziel, 'version.json'), 'utf8'));
    for (const plattform of ['win32-x64', 'darwin-universal', 'linux-x64', 'android']) assert.ok(vj.dateien[plattform], plattform);

    const vorher = readFileSync(path.join(ziel, 'version.json'), 'utf8');
    await erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, mitgeliefert: quelle, autoHolen: false, schluessel: k.oeffentlich, log: stumm }).starte();
    assert.equal(readFileSync(path.join(ziel, 'version.json'), 'utf8'), vorher);
});

test('manipulierte mitgelieferte Datei wird abgelehnt: kein version.json, Status Fehler', async () => {
    const k = schluessel();
    const quelle = baueRelease(k.privat);
    writeFileSync(path.join(quelle, `Hajime-Pro-${VERSION}.apk`), 'MANIPULIERT');
    const downloads = tempDir('downloads-');
    const cd = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, mitgeliefert: quelle, autoHolen: false, schluessel: k.oeffentlich, log: stumm, wiederholungMs: 3600_000 });
    await cd.starte();
    cd.stoppe();
    assert.equal(cd.status().phase, 'fehler');
    assert.match(cd.status().fehler, /apk: Prüfung fehlgeschlagen \(sha256\)/);
    assert.equal(existsSync(path.join(downloads, VERSION, 'version.json')), false);
});

test('mitgelieferte Dateien einer anderen Version werden ignoriert', async () => {
    const k = schluessel();
    const quelle = baueRelease(k.privat, '2.0.0');
    const downloads = tempDir('downloads-');
    const cd = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, mitgeliefert: quelle, autoHolen: false, schluessel: k.oeffentlich, log: stumm });
    await cd.starte();
    assert.equal(cd.status().phase, 'inaktiv');
    assert.equal(existsSync(path.join(downloads, VERSION)), false);
});

// Fake-GitHub: /repos/<repo>/releases/tags/v<version> und die Asset-Downloads; privates Repository =
// ohne gültiges Token 404 (wie bei GitHub).
function starteFakeGithub({ releaseDir, token = null, version = VERSION, verfuegbar = () => true }) {
    const anfragen = [];
    const server = http.createServer((req, res) => {
        anfragen.push(req.url);
        const bearer = (req.headers.authorization || '').replace('Bearer ', '');
        if (!verfuegbar() || (token && bearer !== token)) return res.writeHead(404).end('{}');
        const basis = `http://127.0.0.1:${server.address().port}`;
        if (req.url === `/repos/o/r/releases/tags/v${version}`) {
            const assets = readdirSync(releaseDir).map(name => ({ name, url: `${basis}/assets/${encodeURIComponent(name)}` }));
            return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ assets }));
        }
        const treffer = req.url.match(/^\/assets\/(.+)$/);
        if (treffer) return res.writeHead(200).end(readFileSync(path.join(releaseDir, decodeURIComponent(treffer[1]))));
        res.writeHead(404).end('{}');
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, anfragen, basis: `http://127.0.0.1:${server.address().port}` })));
}

test('GitHub-Release: privates Repository braucht das Token, mit Token wird alles geladen und geprüft', async () => {
    const k = schluessel();
    const releaseDir = baueRelease(k.privat);
    const fake = await starteFakeGithub({ releaseDir, token: 'geheim' });
    try {
        const downloads = tempDir('downloads-');
        const ohne = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, repo: 'o/r', apiBasis: fake.basis, schluessel: k.oeffentlich, log: stumm, wiederholungMs: 3600_000 });
        await ohne.starte();
        ohne.stoppe();
        assert.equal(ohne.status().phase, 'fehler');
        assert.match(ohne.status().fehler, /CLIENT_RELEASE_TOKEN/);

        const mit = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, repo: 'o/r', token: 'geheim', apiBasis: fake.basis, schluessel: k.oeffentlich, log: stumm });
        await mit.starte();
        assert.equal(mit.status().phase, 'bereit');
        assert.deepEqual(dateienIn(path.join(downloads, VERSION)), dateienIn(releaseDir));
    } finally {
        fake.server.close();
    }
});

test('GitHub-Release: bereits vorhandene, korrekte Dateien werden bei der Wiederaufnahme nicht erneut geladen', async () => {
    const k = schluessel();
    const releaseDir = baueRelease(k.privat);
    const fake = await starteFakeGithub({ releaseDir });
    try {
        const downloads = tempDir('downloads-');
        const ziel = path.join(downloads, VERSION);
        mkdirSync(ziel, { recursive: true });
        const apk = `Hajime-Pro-${VERSION}.apk`;
        writeFileSync(path.join(ziel, apk), readFileSync(path.join(releaseDir, apk)));
        await erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, repo: 'o/r', apiBasis: fake.basis, schluessel: k.oeffentlich, log: stumm }).starte();
        assert.ok(!fake.anfragen.some(u => u.includes(encodeURIComponent(apk))), 'APK wurde erneut geladen');
        assert.ok(fake.anfragen.some(u => u.includes('win-x64')));
        assert.equal(existsSync(path.join(ziel, 'version.json')), true);
    } finally {
        fake.server.close();
    }
});

test('GitHub-Release: nach einem Fehler (noch kein Release) versucht der Server es von selbst erneut', async () => {
    const k = schluessel();
    const releaseDir = baueRelease(k.privat);
    let da = false;
    const fake = await starteFakeGithub({ releaseDir, verfuegbar: () => da });
    try {
        const downloads = tempDir('downloads-');
        const cd = erzeugeClientDateien({ downloadsVerzeichnis: downloads, version: VERSION, repo: 'o/r', apiBasis: fake.basis, schluessel: k.oeffentlich, log: stumm, wiederholungMs: 50 });
        await cd.starte();
        assert.equal(cd.status().phase, 'fehler');
        da = true;
        for (let i = 0; i < 100 && cd.status().phase !== 'bereit'; i++) await new Promise(r => setTimeout(r, 50));
        cd.stoppe();
        assert.equal(cd.status().phase, 'bereit');
        assert.equal(existsSync(path.join(downloads, VERSION, 'version.json')), true);
    } finally {
        fake.server.close();
    }
});

test('ohne Quelle (nichts mitgeliefert, Abruf aus) bleibt der Server still und markiert "inaktiv"', async () => {
    const cd = erzeugeClientDateien({ downloadsVerzeichnis: tempDir('downloads-'), version: VERSION, autoHolen: false, schluessel: schluessel().oeffentlich, log: stumm });
    await cd.starte();
    assert.equal(cd.status().phase, 'inaktiv');
});
