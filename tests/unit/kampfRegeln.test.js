import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ermittleGoldenScoreEinstellungen, ermittleKampfzeitUeKlasse, ermittleFreieBehandlungen } from '../../src/shared/kampfRegeln.js';
import { ermittlePausensekunden } from '../../src/shared/pausenRegel.js';

const ALTERSKLASSEN = JSON.parse(readFileSync(new URL('../../src/config/altersklassen.json', import.meta.url), 'utf8'));

test('Golden Score (DJB-WKO Art. 3.12.9): bis U13 keiner, U15 3 Minuten, ab U18 unbegrenzt', () => {
    for (const ak of ['U9', 'U11', 'U13', 'u 13']) {
        assert.deepEqual(ermittleGoldenScoreEinstellungen(ak), { aktiv: false, maxSekunden: null }, ak);
    }
    assert.deepEqual(ermittleGoldenScoreEinstellungen('U15'), { aktiv: true, maxSekunden: 180 });
    for (const ak of ['U18', 'U21', 'Frauen', 'Männer', 'Ü30', '', null]) {
        assert.deepEqual(ermittleGoldenScoreEinstellungen(ak), { aktiv: true, maxSekunden: null }, String(ak));
    }
});

test('Kampfzeiten (DJB-WKO Art. 3.3.1) in altersklassen.json: U11 2, U13/U15 3, ab U18 4 Minuten', () => {
    const soll = { U9: 120, U11: 120, U13: 180, U15: 180, U18: 240, U21: 240, Frauen: 240, Männer: 240 };
    for (const geschlecht of ['weiblich', 'männlich', 'mixed']) {
        for (const klasse of ALTERSKLASSEN[geschlecht]) {
            assert.equal(parseInt(klasse.kampfzeit, 10), soll[klasse.id], `${geschlecht} ${klasse.id}`);
        }
    }
});

test('Kampfzeit Ü30 (DJB-WKO Art. 3.3.1): 3 Minuten, über 59 Jahre 2,5 Minuten', () => {
    assert.equal(ermittleKampfzeitUeKlasse('Ü30'), 180);
    assert.equal(ermittleKampfzeitUeKlasse('Ü 45'), 180);
    assert.equal(ermittleKampfzeitUeKlasse('Veteranen'), 180);
    assert.equal(ermittleKampfzeitUeKlasse('Ü60'), 150);
    assert.equal(ermittleKampfzeitUeKlasse('Ü65 Männer'), 150);
    assert.equal(ermittleKampfzeitUeKlasse('U18'), null);
    assert.equal(ermittleKampfzeitUeKlasse('Frauen'), null);
});

test('Pausen (DJB-WKO Art. 3.3.2): U15 6 Minuten, ab U18 10 Minuten', () => {
    assert.equal(ermittlePausensekunden('U15'), 6 * 60);
    for (const ak of ['U18', 'U21', 'Frauen', 'Männer', 'Ü30']) assert.equal(ermittlePausensekunden(ak), 10 * 60, ak);
});

test('Medizinische Versorgung: zwei freie bis U15 (DJB-WKO Art. 3.12.10), ab U18 keine (IJF Art. 20)', () => {
    for (const ak of ['U9', 'U11', 'U13', 'U15']) assert.equal(ermittleFreieBehandlungen(ak), 2, ak);
    for (const ak of ['U18', 'U21', 'Frauen', 'Männer', 'Ü30']) assert.equal(ermittleFreieBehandlungen(ak), 0, ak);
    // Kampf ohne Pool-Kontext (manueller Link): wie bisher zwei freie Versorgungen
    assert.equal(ermittleFreieBehandlungen(null), 2);
    assert.equal(ermittleFreieBehandlungen(''), 2);
});
