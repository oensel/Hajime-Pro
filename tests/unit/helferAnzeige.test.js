// Anzeigelogik der Helfer-App (src/shared/helferAnzeige.js): Vereinssuche, Platztext, Gruppierung, Datum.
import test from 'node:test';
import assert from 'node:assert/strict';
import { filtereVereine, platzText, gruppiereNachBezeichnung, datumText, wartetAufFreischaltung } from '../../src/shared/helferAnzeige.js';

const VEREINE = ['Judo Club Senden', 'JC Musterstadt', 'SV Sendenhorst Judo', 'Budokan Münster'];

test('filtereVereine: Teilstring an beliebiger Stelle, ohne Anfangstreffer alphabetisch', () => {
    assert.deepEqual(filtereVereine(VEREINE, 'sen'), ['Judo Club Senden', 'SV Sendenhorst Judo']);
});

test('filtereVereine: unter 2 Zeichen keine Treffer', () => {
    assert.deepEqual(filtereVereine(VEREINE, 's'), []);
    assert.deepEqual(filtereVereine(VEREINE, ''), []);
    assert.deepEqual(filtereVereine(VEREINE, ' s '), []);
});

test('filtereVereine: ohne Beachtung von Groß-/Kleinschreibung', () => {
    assert.deepEqual(filtereVereine(VEREINE, 'SENDEN'), ['Judo Club Senden', 'SV Sendenhorst Judo']);
});

test('filtereVereine: Anfangstreffer zuerst', () => {
    assert.deepEqual(filtereVereine(VEREINE, 'sv '), ['SV Sendenhorst Judo']);
    assert.deepEqual(filtereVereine(['Budokan Svend', 'SV Sendenhorst Judo'], 'sv'), ['SV Sendenhorst Judo', 'Budokan Svend']);
    assert.deepEqual(filtereVereine(['Judo Club Senden', 'Sendener JC', 'Alt Senden'], 'sen'),
        ['Sendener JC', 'Alt Senden', 'Judo Club Senden']);
});

test('filtereVereine: Objekte {id, name} kommen als Objekte zurück', () => {
    const liste = [{ id: 2, name: 'Offline Club' }, { id: 1, name: 'Judo Offenbach' }, { id: 3, name: 'JC Nord' }];
    assert.deepEqual(filtereVereine(liste, 'Off'), [{ id: 2, name: 'Offline Club' }, { id: 1, name: 'Judo Offenbach' }]);
});

test('platzText: Singular und Plural', () => {
    assert.equal(platzText(1), 'noch 1 Platz frei');
    assert.equal(platzText(3), 'noch 3 Plätze frei');
});

test('gruppiereNachBezeichnung: Tätigkeiten alphabetisch (numerisch), Slots nach Beginn', () => {
    const slots = [
        { taetigkeit: 'Matte 10', slotId: 1, von_min: 540, bis_min: 660 },
        { taetigkeit: 'Waage', slotId: 2, von_min: 660, bis_min: 780 },
        { taetigkeit: 'Matte 2', slotId: 3, von_min: 660, bis_min: 780 },
        { taetigkeit: 'Matte 2', slotId: 4, von_min: 540, bis_min: 660 },
        { taetigkeit: 'Waage', slotId: 5, von_min: 540, bis_min: 660 }
    ];
    const gruppen = gruppiereNachBezeichnung(slots);
    assert.deepEqual(gruppen.map(g => g.bezeichnung), ['Matte 2', 'Matte 10', 'Waage']);
    assert.deepEqual(gruppen[0].slots.map(s => s.slotId), [4, 3]);
    assert.deepEqual(gruppen[2].slots.map(s => s.slotId), [5, 2]);
    assert.deepEqual(gruppiereNachBezeichnung([]), []);
});

test('wartetAufFreischaltung: kein freigeschalteter Verein', () => {
    assert.equal(wartetAufFreischaltung([{ verein_id: 1, freigegeben: false }]), true);
    assert.equal(wartetAufFreischaltung([]), true);
    assert.equal(wartetAufFreischaltung([{ verein_id: 1, freigegeben: false }, { verein_id: 2, freigegeben: true }]), false);
    // Profil nicht geladen: keine Aussage, kein Hinweis
    assert.equal(wartetAufFreischaltung(null), false);
    assert.equal(wartetAufFreischaltung(undefined), false);
});

test('datumText: Wochentag kurz und Datum', () => {
    assert.equal(datumText('2026-11-14'), 'Sa., 14.11.2026');
    assert.equal(datumText('2026-10-19'), 'Mo., 19.10.2026');
});
