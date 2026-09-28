import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beantworteAnfrage, lokaleIpv4Adressen } from '../../src/sync/ankuendigung.js';

test('A-Anfrage für den eigenen Namen wird mit allen Adressen beantwortet', () => {
    const a = beantworteAnfrage([{ name: 'turnier.local', type: 'A' }], { hostname: 'turnier.local', adressen: ['192.168.1.5', '10.0.0.2'] });
    assert.deepEqual(a, [
        { name: 'turnier.local', type: 'A', ttl: 120, data: '192.168.1.5' },
        { name: 'turnier.local', type: 'A', ttl: 120, data: '10.0.0.2' }
    ]);
});

test('ANY-Anfrage, Groß-/Kleinschreibung egal; fremde Namen und AAAA werden ignoriert', () => {
    assert.equal(beantworteAnfrage([{ name: 'Turnier.Local', type: 'ANY' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 1);
    assert.equal(beantworteAnfrage([{ name: 'anderer.local', type: 'A' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 0);
    assert.equal(beantworteAnfrage([{ name: 'turnier.local', type: 'AAAA' }], { hostname: 'turnier.local', adressen: ['1.2.3.4'] }).length, 0);
});

test('lokaleIpv4Adressen ohne interne und ohne IPv6', () => {
    const netz = {
        lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
        eth0: [{ family: 'IPv4', address: '192.168.1.5', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
        wlan: [{ family: 4, address: '10.0.0.2', internal: false }]
    };
    assert.deepEqual(lokaleIpv4Adressen(netz), ['192.168.1.5', '10.0.0.2']);
});
