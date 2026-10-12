import test from 'node:test';
import assert from 'node:assert/strict';
import { erzeugeRatenbegrenzung, clientIp } from '../../src/liveCloud/ratenbegrenzung.js';

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
