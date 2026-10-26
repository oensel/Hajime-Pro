import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruefeGlaeubigerId } from '../../src/shared/glaeubigerId.js';
import { sepaText, sepaKennung } from '../../src/shared/sepaZeichen.js';
import {
    istTargetGeschaeftstag, naechsterGeschaeftstag, addiereGeschaeftstage, fruehestesFaelligkeitsdatum
} from '../../src/shared/targetKalender.js';
import { MANDATSTEXT_VERSION, baueMandatstext } from '../../src/shared/mandatText.js';

test('Gläubiger-ID: Testnummer der Bundesbank ist gültig', () => {
    const r = pruefeGlaeubigerId('DE98ZZZ09999999999');
    assert.equal(r.ok, true);
    assert.equal(r.wert, 'DE98ZZZ09999999999');
    assert.equal(r.fehler, null);
});

test('Gläubiger-ID: falsche Prüfziffern, Normalisierung, Länge', () => {
    const falsch = pruefeGlaeubigerId('DE99ZZZ09999999999');
    assert.equal(falsch.ok, false);
    assert.equal(falsch.wert, null);
    assert.ok(falsch.fehler);
    const norm = pruefeGlaeubigerId('de98 zzz0 9999 9999 99');
    assert.equal(norm.ok, true);
    assert.equal(norm.wert, 'DE98ZZZ09999999999');
    const kurz = pruefeGlaeubigerId('DE98ZZZ0999');
    assert.equal(kurz.ok, false);
    assert.match(kurz.fehler, /18/);
    assert.equal(pruefeGlaeubigerId('').ok, false);
    assert.equal(pruefeGlaeubigerId(null).ok, false);
    assert.equal(pruefeGlaeubigerId('1298ZZZ09999999999').ok, false);
    assert.equal(pruefeGlaeubigerId('DE98ZZZ0999999999!').ok, false);
});

test('Gläubiger-ID: Geschäftsbereichskennung wird für die Prüfung ignoriert', () => {
    const a = pruefeGlaeubigerId('DE98AAA09999999999');
    const b = pruefeGlaeubigerId('DE98ZZZ09999999999');
    assert.equal(a.ok, b.ok);
});

test('Gläubiger-ID: andere Länder 8 bis 35 Zeichen', () => {
    assert.equal(pruefeGlaeubigerId('AT12').ok, false);
    assert.equal(pruefeGlaeubigerId('A'.repeat(36)).ok, false);
});

test('sepaText: Transliteration, Sonderzeichen, Kürzung', () => {
    assert.equal(sepaText('Jürgen & Söhne <GmbH> 😀', 70), 'Juergen + Soehne GmbH');
    assert.equal(sepaText('ÄÖÜ äöü ß', 70), 'AeOeUe aeoeue ss');
    assert.equal(sepaText("a/b-c?d:e(f).g,h'i+j", 70), "a/b-c?d:e(f).g,h'i+j");
    assert.equal(sepaText('abcdefghij', 4), 'abcd');
    assert.equal(sepaText('abc def', 4), 'abc');
    assert.equal(sepaText(null, 10), '');
});

test('sepaKennung: ohne Leerzeichen, auf 35 gekürzt', () => {
    assert.equal(sepaKennung('JCK M12 V3'), 'JCKM12V3');
    assert.equal(sepaKennung('A'.repeat(50)).length, 35);
    assert.equal(sepaKennung('abcdef', 3), 'abc');
});

test('TARGET2-Geschäftstage', () => {
    assert.equal(istTargetGeschaeftstag('2027-03-26'), false); // Karfreitag
    assert.equal(istTargetGeschaeftstag('2027-03-29'), false); // Ostermontag
    assert.equal(istTargetGeschaeftstag('2027-03-30'), true);
    assert.equal(istTargetGeschaeftstag('2026-12-26'), false);
    assert.equal(istTargetGeschaeftstag('2026-12-25'), false);
    assert.equal(istTargetGeschaeftstag('2026-12-24'), true);
    assert.equal(istTargetGeschaeftstag('2027-01-01'), false);
    assert.equal(istTargetGeschaeftstag('2026-05-01'), false);
    assert.equal(istTargetGeschaeftstag('2026-11-21'), false); // Samstag
    assert.equal(istTargetGeschaeftstag('2026-11-22'), false); // Sonntag
    assert.equal(istTargetGeschaeftstag('2026-11-23'), true);
    // Ostern 2026: 5.4. -> Karfreitag 3.4., Ostermontag 6.4.
    assert.equal(istTargetGeschaeftstag('2026-04-03'), false);
    assert.equal(istTargetGeschaeftstag('2026-04-06'), false);
    assert.equal(istTargetGeschaeftstag('2026-04-07'), true);
    // Ostern 2024: 31.3. (Schaltjahr)
    assert.equal(istTargetGeschaeftstag('2024-03-29'), false);
    assert.equal(istTargetGeschaeftstag('2024-04-01'), false);
    // Christi Himmelfahrt ist kein TARGET-Feiertag
    assert.equal(istTargetGeschaeftstag('2026-05-14'), true);
});

test('naechsterGeschaeftstag', () => {
    assert.equal(naechsterGeschaeftstag('2026-12-24'), '2026-12-24');
    assert.equal(naechsterGeschaeftstag('2026-12-25'), '2026-12-28');
    assert.equal(naechsterGeschaeftstag('2026-12-31'), '2026-12-31');
    assert.equal(naechsterGeschaeftstag('2027-01-01'), '2027-01-04');
    assert.equal(naechsterGeschaeftstag('2024-02-29'), '2024-02-29');
    assert.equal(naechsterGeschaeftstag('2028-02-26'), '2028-02-28'); // Sa -> Mo, Schaltjahr
});

test('addiereGeschaeftstage über Monats-, Jahres- und Schaltjahrgrenzen', () => {
    assert.equal(addiereGeschaeftstage('2026-11-20', 1), '2026-11-23');
    assert.equal(addiereGeschaeftstage('2026-11-20', 0), '2026-11-20');
    assert.equal(addiereGeschaeftstage('2026-12-23', 2), '2026-12-28'); // 24. ja, 25./26./27. nein
    assert.equal(addiereGeschaeftstage('2026-12-31', 1), '2027-01-04');
    assert.equal(addiereGeschaeftstage('2024-02-28', 2), '2024-03-01');
    assert.equal(addiereGeschaeftstage('2026-01-30', 1), '2026-02-02');
    assert.equal(addiereGeschaeftstage('2027-03-25', 1), '2027-03-30'); // Karfreitag + Ostermontag
});

test('fruehestesFaelligkeitsdatum (L7)', () => {
    assert.equal(fruehestesFaelligkeitsdatum('2026-11-20', 5, '2026-11-20'), '2026-11-25');
    assert.equal(fruehestesFaelligkeitsdatum('2026-11-01', 5, '2026-11-20'), '2026-11-23');
    // Rechnungsdatum + Frist auf Wochenende -> nächster Geschäftstag
    assert.equal(fruehestesFaelligkeitsdatum('2026-11-16', 5, '2026-11-16'), '2026-11-23');
    // Jahreswechsel
    assert.equal(fruehestesFaelligkeitsdatum('2026-12-28', 5, '2026-12-28'), '2027-01-04');
});

test('Mandatstext enthält die Pflichtangaben', () => {
    assert.equal(MANDATSTEXT_VERSION, '2026-11-v1');
    const t = baueMandatstext({
        glaeubigerName: 'Judo Club Kassel', glaeubigerId: 'DE98ZZZ09999999999',
        mandatsreferenz: 'JCKM12V3', vorabTage: 5, turnierBezeichnung: 'Kassel Open', zahlenderVerein: 'TSV Test'
    });
    assert.match(t, /SEPA-Lastschriftmandat \(einmalige Zahlung\)/);
    assert.ok(t.includes('DE98ZZZ09999999999'));
    assert.ok(t.includes('JCKM12V3'));
    assert.ok(t.includes('Judo Club Kassel'));
    assert.ok(t.includes('TSV Test'));
    assert.ok(t.includes('Startgeld Kassel Open'));
    assert.ok(t.includes('acht Wochen'));
    assert.ok(t.includes('5 Tage'));
    assert.ok(t.includes('Wir ermächtigen'));
    assert.ok(t.includes('weisen wir unser Kreditinstitut an'));
});

test('Gläubiger-ID: Nicht-ASCII-Zeichen werden vor dem Großschreiben abgelehnt', () => {
    assert.equal(pruefeGlaeubigerId('DE98ZZZ0999999ß999').ok, false);
    assert.equal(pruefeGlaeubigerId('DE98ZZZ09999999ß9').ok, false);
    assert.equal(pruefeGlaeubigerId('ßE98ZZZ09999999999').ok, false);
    // ß würde durch toUpperCase() zu SS und damit eine gültige ID ergeben
    assert.equal(pruefeGlaeubigerId('DE22ZZZSS999999999').ok, true);
    assert.equal(pruefeGlaeubigerId('DE22ZZZß999999999').ok, false);
});

test('Mandatstext: Einzahl bei einem Tag Vorabankündigung', () => {
    const basis = {
        glaeubigerName: 'A', glaeubigerId: 'DE98ZZZ09999999999', mandatsreferenz: 'X',
        turnierBezeichnung: 'T', zahlenderVerein: 'V'
    };
    const eins = baueMandatstext({ ...basis, vorabTage: 1 });
    assert.ok(eins.includes('1 Tag vor'));
    assert.ok(!eins.includes('1 Tage'));
    assert.ok(baueMandatstext({ ...basis, vorabTage: 2 }).includes('2 Tage vor'));
});

test('TARGET-Kalender: ungültige Datumsstrings werfen statt endlos zu laufen', () => {
    for (const schlecht of ['abc', '2026-13-01', '2026-02-30', '', undefined, '2026-1-1', '26-01-01']) {
        assert.throws(() => istTargetGeschaeftstag(schlecht), Error);
        assert.throws(() => naechsterGeschaeftstag(schlecht), Error);
        assert.throws(() => addiereGeschaeftstage(schlecht, 1), Error);
        assert.throws(() => fruehestesFaelligkeitsdatum(schlecht, 5, '2026-11-02'), Error);
        assert.throws(() => fruehestesFaelligkeitsdatum('2026-11-02', 5, schlecht), Error);
    }
});
