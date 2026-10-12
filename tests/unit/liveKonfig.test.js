import test from 'node:test';
import assert from 'node:assert/strict';
import { liesLiveKonfig } from '../../src/live/konfig.js';

const basis = {
    LIVE_DB_PASSWORD: 'pw', LIVE_UPLINK_URL: 'https://cloud.example/api/live/ingest',
    LIVE_UPLINK_TOKEN: 'tok', LIVE_SCHLUESSEL: 'geheim'
};

test('Standardwerte', () => {
    const k = liesLiveKonfig(basis);
    assert.deepEqual(k.db, { host: '127.0.0.1', port: 5432, user: 'live_ro', password: 'pw', database: 'hajime' });
    assert.equal(k.intervallMs, 5000);
    assert.equal(k.uplinkUrl, basis.LIVE_UPLINK_URL);
});

test('überschreibbare Werte', () => {
    const k = liesLiveKonfig({ ...basis, LIVE_DB_HOST: 'db', LIVE_DB_PORT: '5433', LIVE_DB_NAME: 'x', LIVE_DB_USER: 'u', LIVE_INTERVALL_MS: '2000' });
    assert.equal(k.db.host, 'db');
    assert.equal(k.db.port, 5433);
    assert.equal(k.db.database, 'x');
    assert.equal(k.db.user, 'u');
    assert.equal(k.intervallMs, 2000);
});

test('fehlende Pflichtwerte werden benannt', () => {
    for (const name of ['LIVE_DB_PASSWORD', 'LIVE_UPLINK_URL', 'LIVE_UPLINK_TOKEN', 'LIVE_SCHLUESSEL']) {
        const env = { ...basis };
        delete env[name];
        assert.throws(() => liesLiveKonfig(env), new RegExp(name));
    }
});

test('Uplink-URL muss https sein (außer localhost)', () => {
    assert.throws(() => liesLiveKonfig({ ...basis, LIVE_UPLINK_URL: 'http://cloud.example/x' }), /https/);
    assert.doesNotThrow(() => liesLiveKonfig({ ...basis, LIVE_UPLINK_URL: 'http://127.0.0.1:3000/x' }));
});

test('Intervall unter 1 s wird abgelehnt', () => {
    assert.throws(() => liesLiveKonfig({ ...basis, LIVE_INTERVALL_MS: '200' }), /LIVE_INTERVALL_MS/);
});

test('Zustandsdatei: Standard und Überschreibung', () => {
    assert.equal(liesLiveKonfig(basis).zustandDatei, '/var/lib/hajime-live/gesendet.json');
    assert.equal(liesLiveKonfig({ ...basis, LIVE_ZUSTAND_DATEI: '/tmp/x.json' }).zustandDatei, '/tmp/x.json');
});
