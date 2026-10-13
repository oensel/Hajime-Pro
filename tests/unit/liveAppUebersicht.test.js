import test from 'node:test';
import assert from 'node:assert/strict';
import { gruppiereUebersicht } from '../../teilnehmer-app/js/uebersicht.js';

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
    assert.deepEqual(gruppen.map(g => g.id), ['jetzt', 'bald', 'verein', 'fertig']);
    assert.deepEqual(gruppen[0].eintraege.map(x => x.key), ['mia']);
    assert.deepEqual(gruppen[1].eintraege.map(x => x.key), ['max', 'tom', 'anna']);
    assert.equal(gruppen[2].vereinKey, 'v1');
    assert.equal(gruppen[2].titel, 'Vereinsregel: JC Senden');
    assert.deepEqual(gruppen[2].eintraege.map(x => x.key), ['lena']);
    assert.deepEqual(gruppen[3].eintraege.map(x => x.key), ['ben', 'emma']);
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
