// Anzeigelogik der Orga-Aufgaben in der Helfer-App (src/shared/orgaAnzeige.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { tageBis, faelligkeitText, gruppiereAufgaben, zaehleOffene, statusText, heuteBerlin } from '../../src/shared/orgaAnzeige.js';

const HEUTE = '2026-10-18';

test('tageBis: Differenz in Kalendertagen, auch über Monats- und Jahreswechsel', () => {
    assert.equal(tageBis('2026-10-18', HEUTE), 0);
    assert.equal(tageBis('2026-10-21', HEUTE), 3);
    assert.equal(tageBis('2026-10-16', HEUTE), -2);
    assert.equal(tageBis('2027-01-02', '2026-12-30'), 3);
    assert.equal(tageBis('2026-10-18T00:00:00.000Z', HEUTE), 0);
    assert.equal(tageBis(null, HEUTE), null);
    assert.equal(tageBis('kaputt', HEUTE), null);
});

test('faelligkeitText: heute, morgen, in n Tagen, überfällig, ohne Frist', () => {
    assert.equal(faelligkeitText('2026-10-18', HEUTE), 'heute fällig');
    assert.equal(faelligkeitText('2026-10-19', HEUTE), 'morgen fällig');
    assert.equal(faelligkeitText('2026-10-21', HEUTE), 'fällig in 3 Tagen');
    assert.equal(faelligkeitText('2026-10-17', HEUTE), 'seit 1 Tag überfällig');
    assert.equal(faelligkeitText('2026-10-16', HEUTE), 'seit 2 Tagen überfällig');
    assert.equal(faelligkeitText(null, HEUTE), 'ohne Frist');
});

test('statusText', () => {
    assert.equal(statusText({ status: 'offen' }), 'Offen');
    assert.equal(statusText({ status: 'angefangen', erledigt: 1, gesamt: 3 }), '1 von 3 erledigt');
    assert.equal(statusText({ status: 'erledigt' }), 'Erledigt');
    assert.equal(statusText(null), 'Offen');
});

const a = (id, faellig, status = 'offen') => ({ id, titel: `A${id}`, faellig_am: faellig, status: { status } });

test('gruppiereAufgaben: überfällig, diese Woche (heute bis +7), später, erledigt', () => {
    const g = gruppiereAufgaben([
        a(1, '2026-10-10'), a(2, '2026-10-17'), a(3, '2026-10-18'), a(4, '2026-10-25'),
        a(5, '2026-10-26'), a(6, null), a(7, '2026-10-01', 'erledigt'), a(8, '2026-10-20', 'angefangen')
    ], HEUTE);
    assert.deepEqual(g.ueberfaellig.map((x) => x.id), [1, 2]);
    assert.deepEqual(g.dieseWoche.map((x) => x.id), [3, 8, 4]);
    assert.deepEqual(g.spaeter.map((x) => x.id), [5, 6]);
    assert.deepEqual(g.erledigt.map((x) => x.id), [7]);
});

test('zaehleOffene: alles außer erledigt', () => {
    assert.equal(zaehleOffene([a(1, '2026-10-10'), a(2, null, 'erledigt'), a(3, '2027-01-01', 'angefangen')]), 2);
    assert.equal(zaehleOffene([]), 0);
    assert.equal(zaehleOffene(undefined), 0);
});

test('heuteBerlin: Datum in Europe/Berlin', () => {
    assert.equal(heuteBerlin(new Date('2026-10-17T22:30:00Z')), '2026-10-18');
    assert.equal(heuteBerlin(new Date('2026-10-18T10:00:00Z')), '2026-10-18');
});
