import { test } from 'node:test';
import assert from 'node:assert/strict';
import { berechneVorschlag } from '../../src/services/nachzuegler.js';

// vereinfachte Spanne: zulässig, wenn der Unterschied höchstens 3 kg beträgt
const pruefeSpanne = (liste) => {
    const g = liste.map(t => Number(t.gewicht));
    return { zulaessig: g.every(x => Number.isFinite(x) && x > 0) && Math.max(...g) - Math.min(...g) <= 3 };
};
const waehleSystem = (n) => {
    if (n < 2) return 'Nicht startbereit';
    if (n <= 5) return 'Jeder-gegen-Jeden';
    if (n === 6) return 'Gruppen-Überkreuz';
    if (n <= 8) return 'Doppel-KO-8';
    if (n <= 16) return 'Doppel-KO-16';
    if (n <= 32) return 'Doppel-KO-32';
    throw new Error('zu groß');
};
const optionen = { pruefeSpanne, waehleSystem };
const pool = (id, extra = {}) => ({
    id, bezeichnung: `Pool ${id}`, altersklasse: 'U11', geschlecht: 'männlich', gewichtsklasse: '-30',
    kampfflaeche_id: 2, teilnehmer: [{ gewicht: 28 }, { gewicht: 29 }, { gewicht: 30 }], ...extra
});
const nz = { id: 1, altersklasse: 'U11', geschlecht: 'männlich', gewicht: 29.5, gewichtsklasse: '-30' };

test('schlägt den passenden offenen Pool samt neuem System vor', () => {
    const v = berechneVorschlag(nz, [pool(10)], optionen);
    assert.deepEqual(v, { poolId: 10, bezeichnung: 'Pool 10', teilnehmerNachher: 4, systemNachher: 'Jeder-gegen-Jeden', matteId: 2 });
});

test('Pool mit zu großer Gewichtsspanne wird nicht vorgeschlagen', () => {
    const schwer = pool(11, { teilnehmer: [{ gewicht: 36 }, { gewicht: 37 }] });
    assert.equal(berechneVorschlag(nz, [schwer], optionen), null);
});

test('anderes Geschlecht passt nicht, ein Mixed-Pool schon', () => {
    const weiblich = pool(12, { geschlecht: 'weiblich' });
    const mixed = pool(13, { geschlecht: 'mixed' });
    assert.equal(berechneVorschlag(nz, [weiblich], optionen), null);
    assert.equal(berechneVorschlag(nz, [weiblich, mixed], optionen).poolId, 13);
});

test('andere Altersklasse passt nicht', () => {
    assert.equal(berechneVorschlag(nz, [pool(14, { altersklasse: 'U13' })], optionen), null);
});

test('Systemgrenze: ein 5er-Pool wird mit dem Nachzügler zum Gruppen-Überkreuz', () => {
    const fuenf = pool(15, { teilnehmer: [28, 28.5, 29, 29.5, 30].map(g => ({ gewicht: g })) });
    assert.equal(berechneVorschlag(nz, [fuenf], optionen).systemNachher, 'Gruppen-Überkreuz');
});

test('ein 32er-Pool wird nicht mehr angeboten (kein System für 33)', () => {
    const voll = pool(16, { teilnehmer: Array.from({ length: 32 }, () => ({ gewicht: 29 })) });
    assert.equal(berechneVorschlag(nz, [voll], optionen), null);
});

test('Teilnehmer ohne Gewicht: kein Vorschlag, kein Absturz', () => {
    assert.equal(berechneVorschlag({ ...nz, gewicht: null }, [pool(17)], optionen), null);
    assert.equal(berechneVorschlag({ ...nz, gewicht: 0 }, [pool(17)], optionen), null);
});

test('bevorzugt den Pool mit gleicher Gewichtsklasse, dann den mit geringerem Abstand', () => {
    const a = pool(20, { gewichtsklasse: '-34', teilnehmer: [{ gewicht: 29 }, { gewicht: 29.6 }] });
    const b = pool(21, { gewichtsklasse: '-30', teilnehmer: [{ gewicht: 27.5 }, { gewicht: 28.5 }] });
    assert.equal(berechneVorschlag(nz, [a, b], optionen).poolId, 21);
    const c = pool(22, { gewichtsklasse: '-30', teilnehmer: [{ gewicht: 27.4 }, { gewicht: 27.6 }] });
    assert.equal(berechneVorschlag(nz, [c, b], optionen).poolId, 21);
});
