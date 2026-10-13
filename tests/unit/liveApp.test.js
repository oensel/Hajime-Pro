import test from 'node:test';
import assert from 'node:assert/strict';
import { klasseText, matteText, kachelZeilen, verbindung, klassenTitel, gewichtText, kaempferAnzeige, kampfLink, matteKurz } from '../../teilnehmer-app/js/anzeige.js';
import { erzeugeSpeicher, bereinigeAlte } from '../../teilnehmer-app/js/speicher.js';

const basis = { vorname: 'Anna', nachname: 'Muster', altersklasse: 'U15', geschlecht: 'w', gewichtsklasse: '-44', matteBezeichnung: 'Matte 2', abstand: null, platz: null };

test('klasseText und matteText', () => {
    assert.equal(klasseText(basis), 'U15 w −44 kg');
    assert.equal(klasseText({ ...basis, gewichtsklasse: '+63' }), 'U15 w +63 kg');
    assert.equal(klasseText({ ...basis, gewichtsklasse: '' }), 'U15 w');
    assert.equal(matteText('2'), 'Matte 2');
    assert.equal(matteText('Matte 2'), 'Matte 2');
    assert.equal(matteText(''), '');
});

test('Kachel: alle Zustände nach Spec Abschnitt 4', () => {
    const z = (zustand, extra = {}) => kachelZeilen({ ...basis, zustand, ...extra });
    assert.equal(z('in_n', { abstand: 3 }).zeile2, 'nächster Kampf: in 3 Kämpfen');
    assert.equal(z('in_n', { abstand: 1 }).zeile2, 'nächster Kampf: in 1 Kampf');
    assert.equal(z('als_naechstes').zeile2, 'nächster Kampf: als Nächstes');
    assert.equal(z('laeuft').zeile2, 'nächster Kampf: läuft jetzt');
    assert.equal(z('keine_weiteren').zeile2, 'nächster Kampf: keine weiteren Kämpfe');
    assert.equal(z('wartet_auf_gegner').zeile2, 'nächster Kampf: wartet auf Gegner');
    assert.equal(z('nicht_erschienen').zeile2, 'nicht erschienen');
    assert.equal(z('nicht_ausgelost').zeile2, 'noch nicht ausgelost');
    assert.equal(z('ohne_matte').zeile2, 'noch keine Matte zugeteilt');
    assert.equal(z('verspaetet').zeile2, 'nachgemeldet, Einteilung folgt');
    const fertig = z('abgeschlossen', { platz: 3 });
    assert.equal(fertig.zeile2, null);
    assert.equal(fertig.zeile3, 'Abgeschlossen · Platz 3');
    assert.equal(z('abgeschlossen', { platz: 5 }).zeile3, 'Abgeschlossen');
    assert.equal(z('abgeschlossen').zeile3, 'Abgeschlossen');
    assert.equal(z('unbekannt_neu').zeile2, null);
});

test('Kachel: Titelzeile mit Klasse und Matte, ohne Matte keine leere Angabe', () => {
    const k = kachelZeilen({ ...basis, zustand: 'in_n', abstand: 3 });
    assert.equal(k.titel, 'Anna Muster');
    assert.equal(k.zeile1, 'U15 w −44 kg · Matte 2');
    assert.equal(kachelZeilen({ ...basis, matteBezeichnung: '', zustand: 'nicht_ausgelost' }).zeile1, 'U15 w −44 kg');
});

test('Verbindungszustand aus Cloud-Zeiten, Schwelle 180 s', () => {
    const serverzeit = '2026-10-12T10:10:00.000Z';
    const frisch = verbindung({ empfangenAm: '2026-10-12T10:08:30.000Z', serverzeit, stand: '2026-10-12T10:08:30.000Z' });
    assert.equal(frisch.verbunden, true);
    assert.match(frisch.text, /^Stand von \d\d:\d\d$/);
    const alt = verbindung({ empfangenAm: '2026-10-12T10:05:00.000Z', serverzeit, stand: '2026-10-12T10:05:00.000Z' });
    assert.equal(alt.verbunden, false);
    assert.match(alt.text, /Halle nicht verbunden/);
    assert.equal(verbindung({}).verbunden, false);
});

function speicherAttrappe() {
    const daten = new Map();
    return {
        getItem: (k) => (daten.has(k) ? daten.get(k) : null),
        setItem: (k, v) => { daten.set(k, String(v)); },
        removeItem: (k) => { daten.delete(k); },
        key: (i) => [...daten.keys()][i] ?? null,
        get length() { return daten.size; }
    };
}

test('Speicher: Stern setzt die Glocke an, Glocke setzt den Stern, Stern aus entfernt beides', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    s.stern('a1', true);
    assert.equal(s.istGesternt('a1'), true);
    assert.equal(s.hatGlocke('a1'), true);
    s.glocke('a1', false);
    assert.equal(s.istGesternt('a1'), true);
    assert.equal(s.hatGlocke('a1'), false);
    s.glocke('a2', true);
    assert.equal(s.istGesternt('a2'), true);
    s.stern('a2', false);
    assert.equal(s.hatGlocke('a2'), false);
    assert.deepEqual(s.anfrage().teilnehmer, ['a1']);
});

test('Speicher: Vereinsstern, Glocke für alle und Ausnahmen je Teilnehmer', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    s.vereinStern('v1', true);
    assert.equal(s.vereinGesternt('v1'), true);
    assert.equal(s.hatGlocke('x1', 'v1'), false);
    s.vereinGlockeAlle('v1', true);
    assert.equal(s.hatGlocke('x1', 'v1'), true);
    s.vereinAusnahme('v1', 'x1', false);
    assert.equal(s.hatGlocke('x1', 'v1'), false);
    assert.equal(s.hatGlocke('x2', 'v1'), true);
    assert.deepEqual(s.anfrage().vereine, ['v1']);
    s.vereinStern('v1', false);
    assert.deepEqual(s.anfrage().vereine, []);
});

test('Speicher: je Turnier getrennt, übersteht Neuerzeugung, kaputte Daten und werfender Speicher', () => {
    const storage = speicherAttrappe();
    erzeugeSpeicher(storage, 'T1').stern('a1', true);
    assert.equal(erzeugeSpeicher(storage, 'T1').istGesternt('a1'), true);
    assert.equal(erzeugeSpeicher(storage, 'T2').istGesternt('a1'), false);

    storage.setItem('hajime-live:T3', '{kaputt');
    assert.deepEqual(erzeugeSpeicher(storage, 'T3').anfrage(), { teilnehmer: [], vereine: [] });

    const werfend = { getItem() { throw new Error('gesperrt'); }, setItem() { throw new Error('gesperrt'); }, key() { return null; }, length: 0 };
    const s = erzeugeSpeicher(werfend, 'T4');
    s.stern('a1', true);
    assert.equal(s.istGesternt('a1'), true);
});

test('bereinigeAlte entfernt Turniere, die es nicht mehr gibt', () => {
    const storage = speicherAttrappe();
    erzeugeSpeicher(storage, 'T1').stern('a1', true);
    erzeugeSpeicher(storage, 'ALT').stern('a1', true);
    storage.setItem('fremd', 'bleibt');
    storage.setItem('hajime-live:cache:T1', '{}');
    storage.setItem('hajime-live:cache:ALT', '{}');
    assert.equal(bereinigeAlte(storage, ['T1']), 2);
    assert.equal(storage.getItem('hajime-live:ALT'), null);
    assert.equal(storage.getItem('hajime-live:cache:ALT'), null);
    assert.notEqual(storage.getItem('hajime-live:T1'), null);
    assert.notEqual(storage.getItem('hajime-live:cache:T1'), null);
    assert.equal(storage.getItem('fremd'), 'bleibt');
});

test('gecachteTurniere: findet Turniere mit zwischengespeicherter Übersicht (Offline-Start)', async () => {
    const { gecachteTurniere } = await import('../../teilnehmer-app/js/speicher.js');
    const storage = speicherAttrappe();
    storage.setItem('hajime-live:cache:T1', '{}');
    storage.setItem('hajime-live:cache:T/2', '{}');
    storage.setItem('hajime-live:T3', '{}');
    storage.setItem('fremd', 'x');
    assert.deepEqual(gecachteTurniere(storage).sort(), ['T/2', 'T1']);
    const werfend = { key() { throw new Error('gesperrt'); }, length: 3 };
    assert.deepEqual(gecachteTurniere(werfend), []);
});

test('klassenTitel und gewichtText', () => {
    assert.equal(klassenTitel({ altersklasse: 'U15', geschlecht: 'w' }), 'U15 weiblich');
    assert.equal(klassenTitel({ altersklasse: 'U18', geschlecht: 'm' }), 'U18 männlich');
    assert.equal(klassenTitel({ altersklasse: 'U11', geschlecht: '' }), 'U11');
    assert.equal(gewichtText('-44'), '−44 kg');
    assert.equal(gewichtText('+48'), '+48 kg');
    assert.equal(gewichtText(''), '');
});

import { poolStatus, kampfStatus } from '../../teilnehmer-app/js/anzeige.js';

test('poolStatus und kampfStatus', () => {
    assert.deepEqual(poolStatus({ status: 'abgeschlossen', gesamt: 6, beendet: 6, laeuft: 0 }), { text: 'Abgeschlossen', art: 'fertig' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 2, laeuft: 1 }), { text: 'Läuft', art: 'laeuft' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 5, laeuft: 0 }), { text: 'Noch 1 Kampf', art: 'info' });
    assert.deepEqual(poolStatus({ status: 'matte_zugewiesen', gesamt: 6, beendet: 0, laeuft: 0 }), { text: 'Noch 6 Kämpfe', art: 'info' });
    assert.deepEqual(poolStatus({ status: 'angelegt', gesamt: 0, beendet: 0, laeuft: 0 }), { text: 'Noch nicht ausgelost', art: 'info' });
    assert.equal(kampfStatus({ status: 'beendet', p1: 7, p2: 0 }).text, '7:0 · beendet');
    assert.equal(kampfStatus({ status: 'gestartet' }).art, 'laeuft');
    assert.equal(kampfStatus({ status: 'bereit', abstand: 2 }).text, 'in 2 Kämpfen');
    assert.equal(kampfStatus({ status: 'bereit', abstand: 0 }).text, 'als Nächstes');
    assert.equal(kampfStatus({ status: 'bereit', abstand: null }).text, 'bereit');
    assert.equal(kampfStatus({ status: 'angelegt' }).text, 'wartet auf Gegner');
    assert.equal(kampfStatus({ status: 'freilos' }).text, 'Freilos');
});

test('kaempferAnzeige und kampfLink', () => {
    assert.deepEqual(kaempferAnzeige({ name: 'Anna Muster', verein: 'JC Senden' }), { name: 'Anna Muster', verein: 'JC Senden' });
    assert.deepEqual(kaempferAnzeige(null), { name: 'offen', verein: '' });
    assert.equal(kampfLink('T 1', { poolId: 10, id: 55 }), '#/t/T%201/pool/10/kaempfe/55');
});

test('Speicher: ein verfolgter Verein sternt alle Mitglieder, auch später hinzukommende; Abwählen ist eine Ausnahme', () => {
    const s = erzeugeSpeicher(speicherAttrappe(), 'T1');
    assert.equal(s.istGesternt('x1', 'v1'), false);
    s.vereinStern('v1', true);
    assert.equal(s.istGesternt('x1', 'v1'), true);
    assert.equal(s.istGesternt('spaeter', 'v1'), true);
    assert.equal(s.istGesternt('y1', 'v2'), false);
    assert.deepEqual(s.anfrage().teilnehmer, []);
    s.stern('x1', false, 'v1');
    assert.equal(s.istGesternt('x1', 'v1'), false);
    assert.equal(s.hatGlocke('x1', 'v1'), false);
    assert.deepEqual(s.abgewaehlt(), ['x1']);
    assert.equal(s.istGesternt('spaeter', 'v1'), true);
    s.stern('x1', true, 'v1');
    assert.equal(s.istGesternt('x1', 'v1'), true);
    assert.deepEqual(s.abgewaehlt(), []);
    s.vereinStern('v1', false);
    assert.equal(s.istGesternt('spaeter', 'v1'), false);
});

test('matteKurz: Nummer oder eigener Name für den Matten-Block', () => {
    assert.equal(matteKurz('Matte 2'), '2');
    assert.equal(matteKurz('2'), '2');
    assert.equal(matteKurz('matte A'), 'A');
    assert.equal(matteKurz('Halle Nord'), 'Halle Nord');
    assert.equal(matteKurz(''), '');
    assert.equal(matteKurz(null), '');
});
