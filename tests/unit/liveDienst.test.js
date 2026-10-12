import test from 'node:test';
import assert from 'node:assert/strict';
import { starteLiveDienst } from '../../src/live/dienst.js';

const stilles = { log() {}, warn() {}, error() {} };

test('tick lädt Snapshots und übergibt sie dem Uplink', async () => {
    const gesendet = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [{ turnierKey: '1' }],
        uplink: { sende: async (s) => { gesendet.push(s); return { gesendet: 1, zurueckgezogen: 0, fehler: 0 }; } },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.deepEqual(gesendet, [[{ turnierKey: '1' }]]);
    dienst.stoppe();
});

test('Datenbankfehler im Tick beenden die Schleife nicht', async () => {
    let n = 0;
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => { n += 1; if (n === 1) throw new Error('db weg'); return []; },
        uplink: { sende: async () => ({ gesendet: 0, zurueckgezogen: 0, fehler: 0 }) },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    await dienst.tick();
    assert.equal(n, 2);
    dienst.stoppe();
});

test('keine freigegebenen Turniere: leere Liste wird gesendet (löst Rücknahmen aus)', async () => {
    const gesehen = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [],
        uplink: { sende: async (s) => { gesehen.push(s.length); return {}; } },
        log: stilles, setzeTimer: () => 0, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.deepEqual(gesehen, [0]);
    dienst.stoppe();
});

test('Schleife plant den nächsten Tick nach dem Intervall', async () => {
    const geplant = [];
    const dienst = starteLiveDienst({
        ladeSnapshots: async () => [], uplink: { sende: async () => ({}) }, intervallMs: 5000,
        log: stilles, setzeTimer: (_fn, ms) => { geplant.push(ms); return 1; }, loescheTimer: () => {}
    });
    await dienst.tick();
    assert.ok(geplant.includes(5000));
    dienst.stoppe();
});
