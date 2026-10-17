import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueZeitprognoseAntwort } from '../../src/shared/zeitprognoseAntwort.js';

const JETZT = Date.parse('2026-10-17T10:00:00Z');
const kampfflaechen = [{ id: 1, bezeichnung: 'Matte 1' }, { id: 2, bezeichnung: 'Matte 2' }, { id: 3, bezeichnung: 'Matte 3' }];
const pools = [
    { id: 11, kampfflaeche_id: 1, kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet' },
    { id: 12, kampfflaeche_id: 2, kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet' },
    { id: 13, kampfflaeche_id: 3, kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet' },
    { id: 14, kampfflaeche_id: 1, kampfzeit_sekunden: 240, altersklasse: 'U18', typ: 'einzel', status: 'gestartet', verspaetet: true }
];
const viele = (poolId, n, start) => Array.from({ length: n }, (_, i) => ({ id: start + i, pool_id: poolId, status: 'bereit', matten_reihenfolge: i + 1 }));
const kaempfe = [...viele(11, 10, 100), ...viele(12, 30, 200), ...viele(14, 50, 300),
    { id: 900, pool_id: 13, status: 'beendet', matten_reihenfolge: 1, kampfzeit_in_sekunden: 100 }];

test('Matte 2 liegt hinter Matte 1, Matte ohne offene Kämpfe hat kein Ende, Sammelpool zählt nicht', () => {
    const antwort = baueZeitprognoseAntwort({ kampfflaechen, pools, kaempfe }, JETZT);
    assert.equal(antwort.jetzt, JETZT);
    const [m1, m2, m3] = antwort.matten;
    assert.equal(m1.offeneKaempfe, 10);
    assert.equal(m1.rueckstand, null);
    assert.equal(m2.offeneKaempfe, 30);
    assert.equal(m2.rueckstand.minuten, Math.round(20 * 330 / 60));
    assert.equal(m2.rueckstand.bezugMatteId, 1);
    assert.equal(m2.rueckstand.bezugBezeichnung, 'Matte 1');
    assert.equal(m3.endeMs, null);
});
