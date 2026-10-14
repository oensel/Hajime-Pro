import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeminfo, erfasseSystemInfo } from '../../src/cluster/systemInfo.js';

const MEMINFO = `MemTotal:       16384000 kB
MemFree:          500000 kB
MemAvailable:    8192000 kB
SwapTotal:       2048000 kB
SwapFree:        1024000 kB
`;

test('meminfo: Werte in Byte, fehlende Felder ergeben null', () => {
    const m = parseMeminfo(MEMINFO);
    assert.equal(m.gesamt, 16384000 * 1024);
    assert.equal(m.verfuegbar, 8192000 * 1024);
    assert.equal(m.swapGesamt, 2048000 * 1024);
    assert.equal(m.swapFrei, 1024000 * 1024);
    assert.deepEqual(parseMeminfo('Unsinn'), { gesamt: null, verfuegbar: null, swapGesamt: null, swapFrei: null });
});

const osFake = {
    hostname: () => 'server2', platform: () => 'linux', release: () => '6.12.0', arch: () => 'x64',
    cpus: () => [{ model: 'Test CPU' }, { model: 'Test CPU' }], loadavg: () => [0.5, 0.25, 0.1],
    uptime: () => 3600, totalmem: () => 1000, freemem: () => 400,
    networkInterfaces: () => ({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        eth0: [{ address: '192.168.10.131', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }]
    })
};

test('Systeminfo: RAM aus meminfo, Platten je Gerät nur einmal, Netz ohne Loopback und IPv6', async () => {
    const info = await erfasseSystemInfo({
        os: osFake, plattform: 'linux', nodeVersion: 'v22.1.0',
        leseDatei: async () => MEMINFO,
        statfs: async (p) => ({ bsize: 1024, blocks: 1000, bavail: p === '/daten' ? 250 : 500 }),
        geraet: async (p) => (p === '/pg' ? 1 : 1),   // beide Pfade auf demselben Gerät
        pfade: [{ bezeichnung: 'Daten', pfad: '/daten' }, { bezeichnung: 'PostgreSQL', pfad: '/pg' }],
        dbGroesse: async () => 123456
    });
    assert.equal(info.host, 'server2');
    assert.equal(info.cpu.kerne, 2);
    assert.equal(info.cpu.modell, 'Test CPU');
    assert.deepEqual(info.last, [0.5, 0.25, 0.1]);
    assert.equal(info.ram.gesamt, 16384000 * 1024);
    assert.equal(info.ram.verfuegbar, 8192000 * 1024);
    assert.equal(info.swap.gesamt, 2048000 * 1024);
    assert.equal(info.platten.length, 1);
    assert.deepEqual(info.platten[0].enthaelt, ['Daten', 'PostgreSQL']);
    assert.deepEqual({ gesamt: info.platten[0].gesamt, frei: info.platten[0].frei }, { gesamt: 1000 * 1024, frei: 250 * 1024 });
    assert.deepEqual(info.netz, [{ schnittstelle: 'eth0', adresse: '192.168.10.131' }]);
    assert.equal(info.db_groesse, 123456);
    assert.equal(info.node, '22.1.0');
});

test('Systeminfo: fehlende Quellen ergeben null statt eines Fehlers (Windows, kein Zugriff)', async () => {
    const info = await erfasseSystemInfo({
        os: osFake, plattform: 'win32', nodeVersion: 'v22.1.0',
        leseDatei: async () => { throw new Error('ENOENT'); },
        statfs: async () => { throw new Error('EACCES'); },
        geraet: async () => 1,
        pfade: [{ bezeichnung: 'Daten', pfad: '/x' }],
        dbGroesse: async () => { throw new Error('keine Rechte'); }
    });
    assert.equal(info.ram.gesamt, 1000);        // Rückfall auf os.totalmem()
    assert.equal(info.ram.verfuegbar, 400);     // Rückfall auf os.freemem()
    assert.equal(info.swap, null);
    assert.deepEqual(info.platten, []);
    assert.equal(info.db_groesse, null);
});
