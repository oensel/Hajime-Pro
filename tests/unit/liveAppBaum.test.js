import test from 'node:test';
import assert from 'node:assert/strict';
import { baueBaumModell } from '../../teilnehmer-app/js/baum.js';
import { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE } from '../../src/shared/poolRunden.js';

const defs = { POOL_RUNDEN, UEBERKREUZ_GRUPPEN, UEBERKREUZ_FINALRUNDE };
const f = (key, name = key, verein = 'JC') => ({ key, name, verein });
const kampf = (id, nr, extra = {}) => ({ id, nr, status: 'bereit', k1: null, k2: null, sieger: null, p1: 0, p2: 0, abstand: null, ...extra });

test('Doppel-KO-8: Runden aus der Steuerung, fehlende Kämpfe sind null, Sieger und Punkte', () => {
    const m = baueBaumModell('Doppel-KO-8', [
        kampf(1, 'H1', { status: 'beendet', k1: f('a', 'Anna'), k2: f('b', 'Mia'), sieger: 'a', p1: 7 }),
        kampf(2, 'H2', { status: 'gestartet', k1: f('c', 'Lea'), k2: f('d', 'Jule') }),
        kampf(5, 'H5', { k1: f('a', 'Anna') })
    ], defs);
    assert.deepEqual(m.abschnitte.map(a => a.titel), ['Hauptrunde', 'Trostrunde']);
    const viertel = m.abschnitte[0].runden[0];
    assert.equal(viertel.titel, 'Viertelfinale');
    assert.equal(viertel.kaempfe.length, 4);
    assert.equal(viertel.kaempfe[2], null);
    const h1 = viertel.kaempfe[0];
    assert.equal(h1.zeilen[0].sieger, true);
    assert.equal(h1.zeilen[0].punkte, 7);
    assert.equal(h1.zeilen[1].sieger, false);
    assert.equal(viertel.kaempfe[1].laeuft, true);
    const halb = m.abschnitte[0].runden[1].kaempfe[0];
    assert.equal(halb.zeilen[1].name, 'offen');
    assert.equal(m.abschnitte[1].runden[0].titel, 'Trostrunde R1');
});

test('Freilos und unbekannte Kämpfer: "Freilos" bzw. "offen"', () => {
    const m = baueBaumModell('Doppel-KO-8', [
        kampf(1, 'H1', { status: 'freilos', k1: f('a', 'Anna'), k2: null, sieger: 'a' }),
        kampf(2, 'H2', { status: 'bereit', k1: null, k2: null })
    ], defs);
    const [frei, offen] = m.abschnitte[0].runden[0].kaempfe;
    assert.deepEqual(frei.zeilen.map(z => z.name), ['Anna', 'Freilos']);
    assert.deepEqual(offen.zeilen.map(z => z.name), ['offen', 'offen']);
});

test('Jeder gegen Jeden: Kampfbogen mit Siegen, Punkten und Zusatzkampf', () => {
    const m = baueBaumModell('Jeder-gegen-Jeden', [
        kampf(1, 'R1', { status: 'beendet', k1: f('a', 'Anna'), k2: f('b', 'Mia'), sieger: 'a', p1: 7, p2: 0 }),
        kampf(2, 'R2', { status: 'gestartet', k1: f('a', 'Anna'), k2: f('c', 'Lea') }),
        kampf(3, 'R3', { status: 'beendet', k1: f('b', 'Mia'), k2: f('c', 'Lea'), sieger: 'c', p1: 0, p2: 1 }),
        kampf(4, 'R4', { status: 'beendet', k1: f('b', 'Mia'), k2: f('c', 'Lea'), sieger: 'b', p1: 1, p2: 0 })
    ], defs);
    assert.equal(m.abschnitte.length, 1);
    const b = m.abschnitte[0];
    assert.equal(b.art, 'bogen');
    assert.deepEqual(b.teilnehmer.map(t => t.name), ['Anna', 'Mia', 'Lea']);
    assert.equal(b.zellen[0][1].art, 'gewonnen');
    assert.equal(b.zellen[0][1].text, '7:0');
    assert.equal(b.zellen[1][0].art, 'verloren');
    assert.equal(b.zellen[0][2].art, 'laeuft');
    assert.equal(b.zellen[0][0], null);
    assert.equal(b.zellen[1][2].zusatz.length, 1);
    assert.equal(b.zellen[1][2].zusatz[0].gewonnen, true);
    assert.deepEqual(b.siege, [1, 1, 1]);
});

test('Gruppen-Überkreuz: zwei Kampfbögen und die Finalrunde', () => {
    const m = baueBaumModell('Gruppen-Überkreuz', [
        kampf(1, 'V_A_1', { k1: f('a'), k2: f('b') }),
        kampf(2, 'V_B_1', { k1: f('c'), k2: f('d') }),
        kampf(3, 'HF1', { k1: f('a'), k2: f('d') })
    ], defs);
    assert.deepEqual(m.abschnitte.map(a => a.titel), ['Gruppe A', 'Gruppe B', 'Finalrunde']);
    assert.equal(m.abschnitte[2].runden[0].kaempfe[0].nr, 'HF1');
});

test('ohne Kämpfe ergibt sich ein leeres Modell', () => {
    const m = baueBaumModell('Doppel-KO-8', [], defs);
    assert.equal(m.abschnitte[0].runden[0].kaempfe.every(k => k === null), true);
    assert.equal(baueBaumModell('Jeder-gegen-Jeden', [], defs).abschnitte[0].teilnehmer.length, 0);
});
