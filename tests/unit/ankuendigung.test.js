import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beantworteAnfrage, lokaleIpv4Adressen, ordneServerAdressen } from '../../src/sync/ankuendigung.js';

test('ordneServerAdressen: VIP vor angefragter Adresse vor dem Rest, Link-Local entfällt', () => {
    const alle = ['192.168.10.129', '169.254.3.4', '192.168.10.200', '172.17.0.1'];
    assert.deepEqual(
        ordneServerAdressen(alle, { angefragt: '192.168.10.129', vip: '192.168.10.200' }),
        ['192.168.10.200', '192.168.10.129', '172.17.0.1']
    );
    // Ohne VIP (Einzelserver oder Secondary): die Adresse, über die die Seite erreicht wurde.
    assert.deepEqual(ordneServerAdressen(alle, { angefragt: '::ffff:172.17.0.1' }), ['172.17.0.1', '192.168.10.129', '192.168.10.200']);
    // Eine VIP, die dieser Knoten nicht hält, taucht nicht auf.
    assert.deepEqual(ordneServerAdressen(['10.0.0.2'], { vip: '10.0.0.9' }), ['10.0.0.2']);
});

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
