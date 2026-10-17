import test from 'node:test';
import assert from 'node:assert/strict';
import { baueSnapshot } from '../../src/live/snapshot.js';
import { startNachAbstand } from '../../src/shared/zeitPrognose.js';
import { prognoseUhrzeit, kachelZeilen } from '../../teilnehmer-app/js/anzeige.js';

const turnier = { id: 7, urspruengliche_id: 42, bezeichnung: 'Sommerturnier', datum: '2026-10-12', status: 'veroeffentlicht', live_freigabe: true };
const matten = [{ id: 1, turnier_id: 7, bezeichnung: 'Matte 1' }, { id: 2, turnier_id: 7, bezeichnung: 'Matte 2' }];
const pool = { id: 10, turnier_id: 7, kampfflaeche_id: 1, bezeichnung: 'U15 w -44', modus: 'Jeder-gegen-Jeden', typ: 'einzel', status: 'gestartet', verspaetet: false, altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', matte_reihenfolge: 1, kampfzeit_sekunden: 180 };
const kampf = (id, status, extra = {}) => ({ id, pool_id: 10, status, matten_reihenfolge: id, reihenfolge_nummer: `R${id}`, kaempfer1_id: null, kaempfer2_id: null, sieger_id: null, unterbewertung_kaempfer1: 0, unterbewertung_kaempfer2: 0, mannschaftskampf_id: null, ...extra });

test('startNachAbstand: Stand plus Abstand mal Dauer, ohne Angaben null', () => {
    assert.equal(startNachAbstand(1000, 2, 210), 1000 + 420000);
    assert.equal(startNachAbstand(1000, 0, 210), 1000);
    assert.equal(startNachAbstand(1000, null, 210), null);
    assert.equal(startNachAbstand(1000, 2, null), null);
});

test('Snapshot: dauerSekunden je Matte aus den beendeten Kämpfen plus Puffer, sonst Pool-Kampfzeit plus Puffer', () => {
    const beendet = [1, 2, 3].map(i => kampf(i, 'beendet', { kampfzeit_in_sekunden: 120, updated_at: new Date(2026, 9, 12, 9, i) }));
    const s = baueSnapshot({ turnier, kampfflaechen: matten, pools: [pool], teilnehmer: [], kaempfe: [...beendet, kampf(4, 'bereit')] }, { geheimnis: 'g' });
    assert.equal(s.matten.find(m => m.id === 1).dauerSekunden, 210);
    // Matte 2 ohne Kämpfe: Standardkampfzeit 240 s plus Puffer
    assert.equal(s.matten.find(m => m.id === 2).dauerSekunden, 330);
    const wenig = baueSnapshot({ turnier, kampfflaechen: matten, pools: [pool], teilnehmer: [], kaempfe: [kampf(4, 'bereit')] }, { geheimnis: 'g' });
    assert.equal(wenig.matten.find(m => m.id === 1).dauerSekunden, 270);
});

test('App: prognoseUhrzeit formatiert ca. HH:MM, ohne Wert leer', () => {
    assert.equal(prognoseUhrzeit(new Date(2026, 9, 12, 11, 20).getTime()), 'ca. 11:20');
    assert.equal(prognoseUhrzeit(null), '');
    assert.equal(prognoseUhrzeit(undefined), '');
});

test('App: Kachel nennt die Uhrzeit beim nächsten Kampf', () => {
    const z = kachelZeilen({ vorname: 'A', nachname: 'B', zustand: 'in_n', abstand: 3, voraussichtlichUm: new Date(2026, 9, 12, 11, 20).getTime() });
    assert.equal(z.zeile2, 'nächster Kampf: in 3 Kämpfen (ca. 11:20)');
    const ohne = kachelZeilen({ vorname: 'A', nachname: 'B', zustand: 'in_n', abstand: 3 });
    assert.equal(ohne.zeile2, 'nächster Kampf: in 3 Kämpfen');
});
