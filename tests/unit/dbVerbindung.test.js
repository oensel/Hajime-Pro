import test from 'node:test';
import assert from 'node:assert/strict';
import dbVerbindung from '../../src/config/dbVerbindung.cjs';

const { baueVerbindung, poolGroesse } = dbVerbindung;

test('Einzelvariablen: Standardwerte, kein TLS', () => {
    assert.deepEqual(baueVerbindung({}), {
        host: '127.0.0.1', user: 'postgres', password: 'secret', database: 'judo_cloud', port: 5432, ssl: false
    });
});

test('Einzelvariablen mit DB_SSL=true prüfen das Zertifikat', () => {
    const c = baueVerbindung({ DB_HOST: 'db', DB_SSL: 'true' });
    assert.equal(c.host, 'db');
    assert.deepEqual(c.ssl, { rejectUnauthorized: true });
});

test('DB_URL gewinnt über Einzelvariablen und schaltet TLS ohne Prüfung ein', () => {
    const c = baueVerbindung({ DB_URL: 'postgresql://u:p@pooler.supabase.com:6543/postgres', DB_HOST: 'egal' });
    assert.equal(c.host, undefined);
    assert.match(c.connectionString, /^postgresql:\/\/u:p@pooler\.supabase\.com:6543\/postgres/);
    assert.deepEqual(c.ssl, { rejectUnauthorized: false });
});

test('DATABASE_URL wird als Alias akzeptiert', () => {
    assert.ok(baueVerbindung({ DATABASE_URL: 'postgres://a@h/d' }).connectionString);
});

test('sslmode in der URL wird entfernt, DB_SSL entscheidet', () => {
    const c = baueVerbindung({ DB_URL: 'postgres://a:b@h/d?sslmode=require&application_name=x', DB_SSL: 'false' });
    assert.ok(!c.connectionString.includes('sslmode'));
    assert.ok(c.connectionString.includes('application_name=x'));
    assert.equal(c.ssl, false);
});

test('DB_URL_MIGRATION gilt nur für Migrationen', () => {
    const env = { DB_URL: 'postgres://a@pool/d', DB_URL_MIGRATION: 'postgres://a@direkt/d' };
    assert.match(baueVerbindung(env).connectionString, /@pool\//);
    assert.match(baueVerbindung(env, { migration: true }).connectionString, /@direkt\//);
    assert.match(baueVerbindung({ DB_URL: 'postgres://a@pool/d' }, { migration: true }).connectionString, /@pool\//);
});

test('ungültiges DB_SSL wirft', () => {
    assert.throws(() => baueVerbindung({ DB_SSL: 'vielleicht' }), /DB_SSL/);
});

test('poolGroesse: Standard 10, DB_POOL_MAX überschreibt, Unsinn wird ignoriert', () => {
    assert.equal(poolGroesse({}), 10);
    assert.equal(poolGroesse({ DB_POOL_MAX: '4' }), 4);
    assert.equal(poolGroesse({ DB_POOL_MAX: 'x' }), 10);
});
