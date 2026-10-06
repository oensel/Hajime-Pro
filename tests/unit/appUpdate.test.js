import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istNeuer, waehleAndroidUpdate } from '../../src/shared/appUpdate.js';

const sha = 'a'.repeat(64);
const versionJson = (version, android = { datei: `Hajime-Pro-${version}.apk`, sha256: sha, signatur: 'x' }) => ({
    version, dateien: android ? { android: { installieren: android } } : {}
});

test('istNeuer vergleicht numerisch und lehnt Unvergleichbares ab', () => {
    assert.equal(istNeuer('1.10.0', '1.9.9'), true);
    assert.equal(istNeuer('1.0.10', '1.0.9'), true);
    assert.equal(istNeuer('1.0.9', '1.0.10'), false);
    assert.equal(istNeuer('1.0.10', '1.0.10'), false);
    assert.equal(istNeuer('v2.0.0', '1.9.9'), true);
    assert.equal(istNeuer('2.0.0-beta', '1.0.0'), false);
    assert.equal(istNeuer(undefined, '1.0.0'), false);
});

test('waehleAndroidUpdate: nur bei neuerer Server-Version mit APK und gültiger Prüfsumme', () => {
    const u = waehleAndroidUpdate({ versionJson: versionJson('1.0.11'), appVersion: '1.0.10' });
    assert.deepEqual(u, { version: '1.0.11', datei: 'Hajime-Pro-1.0.11.apk', sha256: sha, pfad: '/downloads/1.0.11/Hajime-Pro-1.0.11.apk' });
    // gleiche oder ältere Server-Version: kein Update (Android erlaubt kein Downgrade)
    assert.equal(waehleAndroidUpdate({ versionJson: versionJson('1.0.10'), appVersion: '1.0.10' }), null);
    assert.equal(waehleAndroidUpdate({ versionJson: versionJson('1.0.9'), appVersion: '1.0.10' }), null);
    // keine APK im Release / kaputte Prüfsumme / kein version.json
    assert.equal(waehleAndroidUpdate({ versionJson: versionJson('1.0.11', null), appVersion: '1.0.10' }), null);
    assert.equal(waehleAndroidUpdate({ versionJson: versionJson('1.0.11', { datei: 'a.apk', sha256: 'zz' }), appVersion: '1.0.10' }), null);
    assert.equal(waehleAndroidUpdate({ versionJson: null, appVersion: '1.0.10' }), null);
});

test('waehleAndroidUpdate: Dateinamen werden für die URL kodiert', () => {
    const u = waehleAndroidUpdate({ versionJson: versionJson('1.0.11', { datei: 'Hajime Pro 1.0.11.apk', sha256: sha }), appVersion: '1.0.10' });
    assert.equal(u.pfad, '/downloads/1.0.11/Hajime%20Pro%201.0.11.apk');
});
