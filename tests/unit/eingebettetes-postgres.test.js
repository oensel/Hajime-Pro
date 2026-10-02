import test from 'node:test';
import assert from 'node:assert/strict';
import { plattformPaket, startHindernis } from '../../src/utils/eingebettetesPostgres.js';

test('plattformPaket wählt das Binary-Paket je Betriebssystem und Architektur', () => {
    assert.equal(plattformPaket('win32', 'x64'), '@embedded-postgres/windows-x64');
    assert.equal(plattformPaket('linux', 'x64'), '@embedded-postgres/linux-x64');
    assert.equal(plattformPaket('linux', 'arm64'), '@embedded-postgres/linux-arm64');
    assert.equal(plattformPaket('darwin', 'x64'), '@embedded-postgres/darwin-x64');
    assert.equal(plattformPaket('darwin', 'arm64'), '@embedded-postgres/darwin-arm64');
    assert.equal(plattformPaket('freebsd', 'x64'), null);
    assert.equal(plattformPaket('win32', 'arm64'), null);
});

test('startHindernis: root darf PostgreSQL nicht starten (Linux/macOS), normale Benutzer und Windows schon', () => {
    assert.match(startHindernis({ platform: 'linux', uid: 0 }), /root/);
    assert.match(startHindernis({ platform: 'darwin', uid: 0 }), /DB_HOST/);
    assert.equal(startHindernis({ platform: 'linux', uid: 1000 }), null);
    assert.equal(startHindernis({ platform: 'darwin', uid: 501 }), null);
    // Windows kennt keine uid; PostgreSQL gibt dort selbst die Administratorrechte ab.
    assert.equal(startHindernis({ platform: 'win32', uid: null }), null);
    assert.equal(startHindernis({ platform: 'win32', uid: 0 }), null);
});
