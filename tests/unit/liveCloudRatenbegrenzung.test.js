import test from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeRatenbegrenzung, clientIp, ratenGrenzeAusEnv } from '../../src/liveCloud/ratenbegrenzung.js';

test('Festfenster: bis max erlaubt, danach gesperrt, im neuen Fenster wieder erlaubt', () => {
    let jetzt = 0;
    const b = erzeugeRatenbegrenzung({ fensterMs: 1000, max: 3, jetzt: () => jetzt });
    assert.deepEqual([1, 2, 3, 4].map(() => b.erlaube('ip1')), [true, true, true, false]);
    assert.equal(b.erlaube('ip2'), true);
    jetzt = 1000;
    assert.equal(b.erlaube('ip1'), true);
});

test('clientIp: X-Forwarded-For nur mit LIVE_PROXY_VERTRAUEN=true, vom Ende der Kette gezählt', () => {
    const req = { headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' }, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(clientIp(req, {}), '10.0.0.1');
    // Ein Proxy hängt die echte Absenderadresse hinten an; das, was der Client selbst vorn mitschickt, zählt nicht.
    assert.equal(clientIp(req, { LIVE_PROXY_VERTRAUEN: 'true' }), '203.0.113.7');
    assert.equal(clientIp(req, { LIVE_PROXY_VERTRAUEN: 'true', LIVE_PROXY_HOPS: '2' }), '198.51.100.9');
    assert.equal(clientIp({ headers: {}, socket: {} }, {}), 'unbekannt');
});

test('clientIp: ungültige oder fehlende Einträge fallen auf die Socket-Adresse zurück', () => {
    const env = { LIVE_PROXY_VERTRAUEN: 'true' };
    const socket = { remoteAddress: '10.0.0.1' };
    assert.equal(clientIp({ headers: { 'x-forwarded-for': 'kein-ip-text' }, socket }, env), '10.0.0.1');
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '203.0.113.7' }, socket }, { ...env, LIVE_PROXY_HOPS: '3' }), '10.0.0.1');
    assert.equal(clientIp({ headers: {}, socket }, env), '10.0.0.1');
});

test('der Speicher wächst nicht unbegrenzt: abgelaufene Einträge werden entfernt', () => {
    let jetzt = 0;
    const b = erzeugeRatenbegrenzung({ fensterMs: 1000, max: 5, jetzt: () => jetzt, maxEintraege: 10 });
    for (let i = 0; i < 10; i++) b.erlaube(`ip${i}`);
    jetzt = 5000;
    b.erlaube('neu');
    assert.equal(b.groesse(), 1);
});

test('harte Obergrenze: auch ohne abgelaufene Einträge wird der älteste verdrängt', () => {
    const b = erzeugeRatenbegrenzung({ fensterMs: 60_000, max: 5, jetzt: () => 0, maxEintraege: 10 });
    for (let i = 0; i < 1000; i++) b.erlaube(`ip${i}`);
    assert.ok(b.groesse() <= 10, `Größe ${b.groesse()}`);
});

test('bei Vollstand "sperren": unbekannte Schlüssel werden abgewiesen, laufende Zähler bleiben erhalten', () => {
    const b = erzeugeRatenbegrenzung({ fensterMs: 60_000, max: 2, jetzt: () => 0, maxEintraege: 3, beiVollstand: 'sperren' });
    assert.equal(b.erlaube('a'), true);
    assert.equal(b.erlaube('b'), true);
    assert.equal(b.erlaube('c'), true);
    assert.equal(b.erlaube('neu'), false);
    assert.equal(b.groesse(), 3);
    // Der Zähler von "a" ist nicht verloren gegangen: der dritte Treffer überschreitet max.
    assert.equal(b.erlaube('a'), true);
    assert.equal(b.erlaube('a'), false);
});

test('clientIp: Port, Klammern und Zonen-ID werden vor der Prüfung entfernt', () => {
    const env = { LIVE_PROXY_VERTRAUEN: 'true' };
    const socket = { remoteAddress: '10.0.0.1' };
    const mit = (xff) => clientIp({ headers: { 'x-forwarded-for': xff }, socket }, env);
    assert.equal(mit('203.0.113.7:51234'), '203.0.113.7');
    assert.equal(mit('[2001:db8::1]:443'), '2001:db8::1');
    assert.equal(mit('[2001:db8::1]'), '2001:db8::1');
    assert.equal(mit('fe80::1%eth0'), 'fe80::1');
    assert.equal(mit('2001:db8::1'), '2001:db8::1');
});

test('ratenGrenzeAusEnv: Standard 1200, LIVE_RATE_MAX überschreibt, Unsinn fällt auf den Standard', () => {
    assert.equal(ratenGrenzeAusEnv({}), 1200);
    assert.equal(ratenGrenzeAusEnv({ LIVE_RATE_MAX: '5000' }), 5000);
    assert.equal(ratenGrenzeAusEnv({ LIVE_RATE_MAX: 'viel' }), 1200);
    assert.equal(ratenGrenzeAusEnv({ LIVE_RATE_MAX: '-3' }), 1200);
});

test('clientIp: X-Forwarded-For ohne LIVE_PROXY_VERTRAUEN warnt einmal (Fehlkonfiguration hinter Proxy)', () => {
    const meldungen = [];
    const log = { warn: (m) => meldungen.push(m) };
    const req = { headers: { 'x-forwarded-for': '203.0.113.7' }, socket: { remoteAddress: '10.0.0.1' } };
    assert.equal(clientIp(req, {}, log), '10.0.0.1');
    assert.equal(clientIp(req, {}, log), '10.0.0.1');
    assert.equal(meldungen.length, 1);
    assert.match(meldungen[0], /LIVE_PROXY_VERTRAUEN/);
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.1' } }, {}, { warn: (m) => meldungen.push(m) }), '10.0.0.1');
    assert.equal(meldungen.length, 1);
});
