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

test('knex-Umgebung ist immer online (PostgreSQL)', () => {
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'false' }), 'online');
    assert.equal(waehleKnexUmgebung({}), 'online');
    assert.equal(waehleKnexUmgebung({ BETRIEBSMODUS: 'server' }), 'online');
    assert.equal(waehleKnexUmgebung({ IS_OFFLINE: 'true', DB_HOST: 'db' }), 'online');
});

test('Cluster ohne SYNC_SECRET: Startabbruch, sonst kein Fehler', async () => {
    const { liesClusterKonfig, clusterSecretFehler } = await import('../../src/cluster/konfig.js');
    const cluster = liesClusterKonfig({ CLUSTER_KNOTEN: 'server1' });
    assert.match(clusterSecretFehler(cluster, ''), /SYNC_SECRET fehlt/);
    assert.match(clusterSecretFehler(cluster, '   '), /SYNC_SECRET fehlt/);
    assert.equal(clusterSecretFehler(cluster, 'geheim'), null);
    assert.equal(clusterSecretFehler(liesClusterKonfig({}), ''), null);
    assert.equal(clusterSecretFehler({ aktiv: false }, ''), null);
});
