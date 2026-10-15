import test from 'node:test';
import assert from 'node:assert/strict';
import { gruppiereUebersicht, sortiereVerein, teileInAbschnitte, abschnittVon } from '../../teilnehmer-app/js/uebersicht.js';

const t = (key, zustand, extra = {}) => ({ key, vorname: key, nachname: 'X', vereinKey: 'v1', verein: 'JC Senden', zustand, abstand: null, platz: null, ...extra });

test('Übersicht: Dringlichkeit, Vereinsregel und Fertig/Wartend', () => {
    const liste = [
        t('mia', 'laeuft'),
        t('anna', 'in_n', { abstand: 3 }),
        t('tom', 'in_n', { abstand: 1, vereinKey: 'v2', verein: 'TV Münster' }),
        t('lena', 'in_n', { abstand: 8 }),
        t('ben', 'abgeschlossen', { platz: 1, vereinKey: 'v2', verein: 'TV Münster' }),
        t('emma', 'nicht_ausgelost'),
        t('max', 'als_naechstes')
    ];
    const { gruppen } = gruppiereUebersicht(liste, { teilnehmer: ['mia', 'anna', 'tom', 'ben', 'emma', 'max'], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['jetzt', 'bald', 'verein', 'spaeter', 'fertig']);
    assert.deepEqual(gruppen[0].eintraege.map(x => x.key), ['mia']);
    assert.deepEqual(gruppen[1].eintraege.map(x => x.key), ['max', 'tom', 'anna']);
    assert.equal(gruppen[2].vereinKey, 'v1');
    assert.equal(gruppen[2].titel, 'JC Senden');
    assert.deepEqual(gruppen[2].eintraege.map(x => x.key), ['lena']);
    assert.deepEqual(gruppen[3].eintraege.map(x => x.key), ['emma']);
    assert.deepEqual(gruppen[4].eintraege.map(x => x.key), ['ben']);
});

test('Übersicht: leere Blöcke entfallen, ein einzeln gesternter Vereinsangehöriger steht nicht doppelt', () => {
    const { gruppen } = gruppiereUebersicht([t('a', 'in_n', { abstand: 2 })], { teilnehmer: ['a'], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['bald']);
    assert.deepEqual(gruppiereUebersicht([], { teilnehmer: [], vereine: [] }).gruppen, []);
});

test('Übersicht: Verein ohne einzeln gesternte Mitglieder, Reihenfolge nach Dringlichkeit', () => {
    const { gruppen } = gruppiereUebersicht([
        t('a', 'in_n', { abstand: 5 }), t('b', 'laeuft'), t('c', 'abgeschlossen', { platz: 2 })
    ], { teilnehmer: [], vereine: ['v1'] });
    assert.deepEqual(gruppen.map(g => g.id), ['verein']);
    assert.deepEqual(gruppen[0].eintraege.map(x => x.key), ['b', 'a', 'c']);
});

test('Vereinsansicht: Reihenfolge läuft, als Nächstes, in n Kämpfen, dann alles ohne Kampf in Sicht', () => {
    const liste = [
        t('a', 'keine_weiteren'), t('b', 'nicht_ausgelost'), t('c', 'in_n', { abstand: 4 }), t('d', 'laeuft'),
        t('e', 'abgeschlossen', { platz: 2 }), t('f', 'in_n', { abstand: 1 }), t('g', 'als_naechstes'),
        t('h', 'nicht_erschienen'), t('i', 'wartet_auf_gegner'), t('j', 'ohne_matte'), t('k', 'verspaetet')
    ];
    assert.deepEqual(sortiereVerein(liste).map(x => x.key), ['d', 'g', 'f', 'c', 'i', 'b', 'j', 'k', 'a', 'e', 'h']);
});

test('Abschnitte: bald dran, noch nicht dran (kein Pool oder Pool beginnt nicht in 3 Kämpfen), fertig', () => {
    const mit = (key, zustand, extra) => t(key, zustand, extra);
    const liste = [
        mit('a', 'laeuft'), mit('b', 'als_naechstes'),
        mit('c', 'in_n', { abstand: 6, poolBegonnen: true, poolStartetIn: null }),
        mit('d', 'in_n', { abstand: 5, poolBegonnen: false, poolStartetIn: 3 }),
        mit('e', 'in_n', { abstand: 9, poolBegonnen: false, poolStartetIn: 4 }),
        mit('f', 'nicht_ausgelost'), mit('g', 'ohne_matte'), mit('h', 'verspaetet'),
        mit('i', 'keine_weiteren'), mit('j', 'abgeschlossen', { platz: 1 }), mit('k', 'nicht_erschienen'),
        mit('l', 'in_n', { abstand: 2 })
    ];
    const a = teileInAbschnitte(liste);
    assert.deepEqual(a.map(x => x.id), ['bald', 'spaeter', 'fertig']);
    assert.deepEqual(a[0].eintraege.map(x => x.key), ['a', 'b', 'l', 'd', 'c']);
    assert.deepEqual(a[1].eintraege.map(x => x.key).sort(), ['e', 'f', 'g', 'h']);
    assert.deepEqual(a[2].eintraege.map(x => x.key), ['i', 'j', 'k']);
    assert.equal(abschnittVon(mit('z', 'wartet_auf_gegner', { poolBegonnen: false, poolStartetIn: null })), 'spaeter');
});

test('sortiereTeams: läuft zuerst, dann nach Abstand, fertige zuletzt', async () => {
    const { sortiereTeams } = await import('../../teilnehmer-app/js/uebersicht.js');
    const teams = [
        { bezeichnung: 'D', zustand: 'abgeschlossen' }, { bezeichnung: 'C', zustand: 'in_n', abstand: 3 },
        { bezeichnung: 'B', zustand: 'als_naechstes', abstand: 0 }, { bezeichnung: 'A', zustand: 'laeuft' }, { bezeichnung: 'E', zustand: 'in_n', abstand: 1 }
    ];
    assert.deepEqual(sortiereTeams(teams).map(t => t.bezeichnung), ['A', 'B', 'E', 'C', 'D']);
});
