import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liesSyncKonfig } from '../../src/sync/konfig.js';
import { waehleKnexUmgebung } from '../../src/utils/dbUmgebung.js';

test('ohne SYNC_ROLLE ist Sync aus', () => {
    const k = liesSyncKonfig({});
    assert.equal(k.rolle, null);
    assert.equal(k.istServer, false);
    assert.equal(k.istClient, false);
    assert.equal(k.datenverzeichnis, './data/dokumente');
});

test('SYNC_ROLLE=server wird erkannt, unbekannte Werte nicht', () => {
    assert.equal(liesSyncKonfig({ SYNC_ROLLE: 'server' }).istServer, true);
    assert.equal(liesSyncKonfig({ SYNC_ROLLE: 'Server' }).rolle, null);
    assert.equal(liesSyncKonfig({ SYNC_DATENVERZEICHNIS: './x' }).datenverzeichnis, './x');
});

test('Client-Einstellungen: Server-URL wird normalisiert', () => {
    const k = liesSyncKonfig({ SYNC_ROLLE: 'client', SYNC_SERVER_URL: 'http://halle:3000/db/', SYNC_SECRET: 'geheim' });
    assert.equal(k.istClient, true);
    assert.equal(k.serverUrl, 'http://halle:3000');
    assert.equal(k.secret, 'geheim');
});

test('knex-Umgebung: Cloud, Halle mit SQLite, Halle mit PostgreSQL', () => {
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'false' }), 'online');
    assert.equal(waehleKnexUmgebung({}), 'online');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true' }), 'offline');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true', DB_CLIENT: 'sqlite' }), 'offline');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true', DB_CLIENT: 'pg' }), 'online');
});
