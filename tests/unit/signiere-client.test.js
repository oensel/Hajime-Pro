import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { erzeugeVersionJson } from '../../scripts/signiere-client.mjs';
import { pruefeDatei } from '../../desktop/updateLogik.js';

test('version.json ordnet Dateien den Plattformen zu und die Signaturen sind prüfbar', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const dir = mkdtempSync(path.join(tmpdir(), 'signieren-'));
    for (const [n, inhalt] of [['H-1.2.0-win-x64.exe', 'W'], ['H-1.2.0-mac-universal.dmg', 'D'], ['H-1.2.0-mac-universal.zip', 'Z'],
        ['H-1.2.0-linux-x86_64.AppImage', 'L'], ['H-1.2.0-win-x64.exe.blockmap', 'B']]) {
        writeFileSync(path.join(dir, n), inhalt);
    }
    const vj = erzeugeVersionJson({ verzeichnis: dir, version: '1.2.0', privaterSchluessel: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    assert.equal(vj.version, '1.2.0');
    assert.equal(vj.dateien['win32-x64'].installieren.datei, 'H-1.2.0-win-x64.exe');
    assert.equal(vj.dateien['win32-x64'].aktualisieren.datei, 'H-1.2.0-win-x64.exe');
    assert.equal(vj.dateien['darwin-universal'].installieren.datei, 'H-1.2.0-mac-universal.dmg');
    assert.equal(vj.dateien['darwin-universal'].aktualisieren.datei, 'H-1.2.0-mac-universal.zip');
    assert.equal(vj.dateien['linux-x64'].aktualisieren.datei, 'H-1.2.0-linux-x86_64.AppImage');
    const pub = publicKey.export({ type: 'spki', format: 'pem' });
    const eintrag = vj.dateien['darwin-universal'].aktualisieren;
    assert.deepEqual(pruefeDatei({ puffer: readFileSync(path.join(dir, eintrag.datei)), eintrag, version: '1.2.0', oeffentlicherSchluessel: pub }), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'version.json'), 'utf8')), vj);
});
