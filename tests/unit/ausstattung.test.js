import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNKTIONEN, normalisiereFunktionen, istFunktionAn } from '../../src/shared/turnierFunktionen.js';
import {
    AUSSTATTUNG, bereinigeAntworten, offeneFragen, zustandAusstattung, waehleFunktionen, berechneSchalter, ermittleAbgewaehlt
} from '../../src/shared/ausstattung.js';

// Funktionen je Turnier und Fragebogen „Ausstattung“ des Assistenten in turnier.html.

const zustaende = (antworten) => Object.fromEntries(AUSSTATTUNG.map(e => [e.id, zustandAusstattung(e, antworten)]));

test('normalisiereFunktionen: fehlende Schlüssel gelten als an, Unbekanntes entfällt', () => {
    assert.deepEqual(normalisiereFunktionen(undefined), Object.fromEntries(FUNKTIONEN.map(k => [k, true])));
    assert.deepEqual(normalisiereFunktionen('kaputt'), Object.fromEntries(FUNKTIONEN.map(k => [k, true])));
    const teil = normalisiereFunktionen({ urkunden: false, anzeige: 'false', video: 'true', fremd: true });
    assert.equal(teil.urkunden, false);
    assert.equal(teil.anzeige, false);
    assert.equal(teil.video, true);
    assert.equal(teil.wettkampfplaene, true);
    assert.equal('fremd' in teil, false);
});

test('normalisiereFunktionen: JSON-Text wird gelesen, Live-Streaming braucht die Videoaufnahme', () => {
    const aus = normalisiereFunktionen(JSON.stringify({ video: false, streaming: true }));
    assert.equal(aus.video, false);
    assert.equal(aus.streaming, false);
    assert.equal(normalisiereFunktionen({ video: true, streaming: true }).streaming, true);
});

test('istFunktionAn: Turnier ohne Angabe zeigt alles', () => {
    assert.equal(istFunktionAn({}, 'urkunden'), true);
    assert.equal(istFunktionAn(null, 'video'), true);
    assert.equal(istFunktionAn({ funktionen: { urkunden: false } }, 'urkunden'), false);
});

test('Ohne Antworten ist alles offen und nichts eingeschaltet', () => {
    assert.ok(Object.values(zustaende({})).every(z => z === 'offen'));
    const { planungs_tools, funktionen } = waehleFunktionen({});
    assert.equal(planungs_tools, false);
    assert.ok(Object.values(funktionen).every(an => an === false));
});

test('Ja schaltet frei, Nein sperrt', () => {
    const z = zustaende({ orga: 'ja', drucker: 'nein', anzeige: 'ja' });
    assert.equal(z.orga, 'frei');
    assert.equal(z.urkunden, 'gesperrt');
    assert.equal(z.wettkampfplaene, 'gesperrt');
    assert.equal(z.anzeige, 'frei');
    assert.equal(z.video, 'offen');
});

test('Der Drucker schaltet Urkunden und Wettkampfpläne frei', () => {
    const { funktionen } = waehleFunktionen({ drucker: 'ja' });
    assert.equal(funktionen.urkunden, true);
    assert.equal(funktionen.wettkampfplaene, true);
});

test('Ohne WLAN entfallen Internet, Teilnehmer-App und Live-Streaming', () => {
    const antworten = bereinigeAntworten({ pc: 'ja', kamera: 'ja', wlan: 'nein', internet: 'ja', app: 'ja', stream: 'ja' });
    assert.equal(antworten.wlan, 'nein');
    assert.equal('internet' in antworten, false);
    assert.equal('app' in antworten, false);
    assert.equal('stream' in antworten, false);
    const z = zustaende(antworten);
    assert.equal(z.teilnehmer_app, 'gesperrt');
    assert.equal(z.streaming, 'gesperrt');
    assert.equal(z.video, 'frei');
});

test('Ohne Internet gibt es keine Teilnehmer-App, das Live-Bild im Hallennetz bleibt möglich', () => {
    const { funktionen } = waehleFunktionen(bereinigeAntworten({ pc: 'ja', kamera: 'ja', wlan: 'ja', internet: 'nein', stream: 'ja' }));
    assert.equal(funktionen.teilnehmer_app, false);
    assert.equal(funktionen.video, true);
    assert.equal(funktionen.streaming, true);
});

test('Ohne USB-Kameras und ohne Gerät an der Fläche entfallen Video und Live-Streaming', () => {
    const ohneKamera = waehleFunktionen(bereinigeAntworten({ pc: 'ja', kamera: 'nein', wlan: 'ja' })).funktionen;
    assert.equal(ohneKamera.video, false);
    assert.equal(ohneKamera.streaming, false);
    const ohnePc = bereinigeAntworten({ pc: 'nein', kamera: 'ja', wlan: 'ja', stream: 'ja' });
    assert.equal('kamera' in ohnePc, false);
    const z = zustaende(ohnePc);
    assert.equal(z.video, 'gesperrt');
    assert.equal(z.streaming, 'gesperrt');
});

test('Abgewählte Funktion bleibt aus, Live-Streaming folgt der Videoaufnahme', () => {
    const antworten = bereinigeAntworten({ pc: 'ja', kamera: 'ja', wlan: 'ja', stream: 'ja' });
    assert.equal(waehleFunktionen(antworten).funktionen.streaming, true);
    const ohneVideo = waehleFunktionen(antworten, { video: true }).funktionen;
    assert.equal(ohneVideo.video, false);
    assert.equal(ohneVideo.streaming, false);
});

test('Wer wenig Ausrüstung hat, beantwortet nur fünf Fragen', () => {
    const antworten = bereinigeAntworten({ orga: 'ja', drucker: 'nein', anzeige: 'nein', pc: 'nein', wlan: 'nein' });
    const { fragen, beantwortet } = offeneFragen(antworten);
    assert.equal(fragen.length, 5);
    assert.equal(beantwortet, 5);
});

test('bereinigeAntworten verwirft alles außer ja und nein', () => {
    assert.deepEqual(bereinigeAntworten({ orga: 'vielleicht', drucker: 'ja', unbekannt: 'ja' }), { drucker: 'ja' });
});

test('berechneSchalter beim Anlegen: offen ist aus und gesperrt, Nein gesperrt, Ja bedienbar', () => {
    const s = berechneSchalter({ orga: 'ja', drucker: 'nein' });
    assert.deepEqual(s.orga, { an: true, aktiv: true, zustand: 'frei' });
    assert.deepEqual(s.urkunden, { an: false, aktiv: false, zustand: 'gesperrt' });
    assert.deepEqual(s.anzeige, { an: false, aktiv: false, zustand: 'offen' });
});

test('berechneSchalter beim Bearbeiten: Funktionen ohne Antwort behalten ihren Stand und bleiben bedienbar', () => {
    const bisher = { orga: false, urkunden: true, wettkampfplaene: true, anzeige: true, teilnehmer_app: true, video: true, streaming: true };
    const s = berechneSchalter({ drucker: 'nein' }, { bisher });
    assert.deepEqual(s.anzeige, { an: true, aktiv: true, zustand: 'offen' });
    assert.deepEqual(s.urkunden, { an: false, aktiv: false, zustand: 'gesperrt' });
    assert.equal(s.video.an, true);
    assert.equal(s.streaming.an, true);
    // Video aus: Live-Streaming folgt
    const ohneVideo = berechneSchalter({}, { bisher: { ...bisher, video: false } });
    assert.deepEqual(ohneVideo.streaming, { an: false, aktiv: false, zustand: 'offen' });
});

test('berechneSchalter: abgewählte Funktion bleibt trotz Ja aus, ermittleAbgewaehlt erkennt sie aus dem gespeicherten Stand', () => {
    const antworten = { drucker: 'ja' };
    const gespeichert = { urkunden: true, wettkampfplaene: false };
    const abgewaehlt = ermittleAbgewaehlt(antworten, gespeichert);
    assert.deepEqual(abgewaehlt, { wettkampfplaene: true });
    const s = berechneSchalter(antworten, { abgewaehlt, bisher: gespeichert });
    assert.equal(s.urkunden.an, true);
    assert.deepEqual(s.wettkampfplaene, { an: false, aktiv: true, zustand: 'frei' });
});
