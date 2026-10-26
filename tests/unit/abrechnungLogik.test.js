import test from 'node:test';
import assert from 'node:assert/strict';
import {
    STAMMDATEN_FELDER, fehlendeStammdaten, pruefePraefix, formatiereRechnungsnummer,
    kaempferSchluessel, zaehleKaempferJeVerein, baueVerwendungszweck, addiereTage,
    heuteBerlin, rechnungsAnzeigeStatus, rechnungsArt, angerechneterBetragCent
} from '../../src/shared/abrechnung.js';

const t = (o) => ({ vorname: 'A', nachname: 'B', geburtsjahr: 2012, verein: 'JC A', status: 'angemeldet', gewogen: 0, startgeld_bezahlt: 0, judopass_id: null, ...o });

test('Zählung: Doppelzeile zählt einmal, zurückgezogen und Ausrichter nicht', () => {
    const liste = [
        t({ vorname: 'X', nachname: 'Y', judopass_id: 'P1' }),
        t({ vorname: 'X', nachname: 'Y', judopass_id: ' P1 ', startgeld_bezahlt: 1 }),
        t({ vorname: 'Z', nachname: 'Z', status: 'zurueckgezogen' }),
        t({ vorname: 'O', nachname: 'O', verein: 'Ausrichter' })
    ];
    const m = zaehleKaempferJeVerein(liste, { basis: 'gemeldet', ausrichterName: 'Ausrichter' });
    assert.equal(m.size, 1);
    const e = [...m.values()][0];
    assert.equal(e.vereinName, 'JC A');
    assert.equal(e.anzahl, 1);
    assert.deepEqual(e.kaempfer, [{ name: 'Y, X', judopass_id: 'P1' }]);
});

test('Zählung nach Waage', () => {
    const liste = [
        t({ vorname: 'A', nachname: 'A', gewogen: 0 }),
        t({ vorname: 'B', nachname: 'B', gewogen: 1, status: 'disqualifiziert', startgeld_bezahlt: 1 })
    ];
    const e = [...zaehleKaempferJeVerein(liste, { basis: 'teilnahme_waage', ausrichterName: null }).values()][0];
    assert.equal(e.anzahl, 1);
    assert.equal(e.bezahltAnzahl, 1);
});

test('Schlüssel ohne Pass-ID', () => {
    assert.equal(kaempferSchluessel(t({ vorname: 'Max', nachname: 'Muster' })), kaempferSchluessel(t({ vorname: 'max ', nachname: 'muster ' })));
    const e = [...zaehleKaempferJeVerein([t({ vorname: 'Max', nachname: 'Muster' }), t({ vorname: 'max', nachname: 'muster ' })], { basis: 'gemeldet', ausrichterName: null }).values()][0];
    assert.equal(e.anzahl, 1);
});

test('fehlendeStammdaten', () => {
    assert.equal(fehlendeStammdaten(null, {}).length, 7);
    assert.deepEqual(STAMMDATEN_FELDER, ['anschrift', 'rechnung_email', 'absender_name', 'ust_hinweis', 'rechnungs_praefix']);
    const voll = { anschrift: 'a', rechnung_email: 'e', absender_name: 'n', steuernummer: '1', ust_hinweis: 'h', rechnungs_praefix: 'JCK-' };
    assert.deepEqual(fehlendeStammdaten(voll, {}), ['Kontoinhaber und IBAN']);
    assert.deepEqual(fehlendeStammdaten(voll, { iban: 'DE1', kontoinhaber: 'K' }), []);
    assert.deepEqual(fehlendeStammdaten({ ...voll, iban_vorhanden: true }, {}), []);
    assert.deepEqual(fehlendeStammdaten({ ...voll, steuernummer: '', ust_id: '' }, { iban: 'DE1', kontoinhaber: 'K' }), ['Steuernummer oder USt-IdNr.']);
});

test('Nummer und Präfix', () => {
    assert.equal(formatiereRechnungsnummer('JCK-', 7), 'JCK-00007');
    assert.ok(pruefePraefix('JC K'));
    assert.ok(pruefePraefix(''));
    assert.equal(pruefePraefix('JCK-'), null);
});

test('Verwendungszweck', () => {
    const d = { turnierName: 'Cup', vereinName: 'JC A', rechnungsnummer: 'JCK-00001' };
    assert.ok(baueVerwendungszweck('Startgeld <Turniername> <Verein>', d).endsWith(' JCK-00001'));
    assert.equal(baueVerwendungszweck(null, d), 'Startgeld Cup JC A JCK-00001');
    const lang = baueVerwendungszweck('<Turniername> <Rechnungsnummer>', { ...d, turnierName: 'T'.repeat(300) });
    assert.ok(lang.length <= 140);
    assert.ok(lang.includes('JCK-00001'));
});

test('Datum und Status', () => {
    assert.equal(addiereTage('2026-12-28', 14), '2027-01-11');
    assert.match(heuteBerlin(new Date('2026-06-30T22:30:00Z')), /^2026-07-01$/);
    assert.equal(rechnungsAnzeigeStatus({ status: 'versandt', zahlungsziel_datum: '2026-11-01' }, '2026-11-02'), 'ueberfaellig');
    assert.equal(rechnungsAnzeigeStatus({ status: 'versandt', zahlungsziel_datum: '2026-11-01' }, '2026-11-01'), 'versandt');
    assert.equal(rechnungsAnzeigeStatus({ status: 'bezahlt', zahlungsziel_datum: '2026-11-01' }, '2026-12-01'), 'bezahlt');
});

test('rechnungsAnzeigeStatus: eingezogen nur bei Lastschrift mit Datei und erreichtem Einzugsdatum (L9)', () => {
    const ls = (o) => ({ zahlweg: 'lastschrift', status: 'versandt', zahlungsziel_datum: null, sepa_datei_id: 7, einzug_am: '2026-11-09', ...o });
    assert.equal(rechnungsAnzeigeStatus(ls(), '2026-11-09'), 'eingezogen');
    assert.equal(rechnungsAnzeigeStatus(ls(), '2026-12-01'), 'eingezogen');
    assert.equal(rechnungsAnzeigeStatus(ls(), '2026-11-08'), 'versandt');           // Einzugsdatum noch nicht erreicht
    assert.equal(rechnungsAnzeigeStatus(ls({ sepa_datei_id: null }), '2026-12-01'), 'versandt'); // ohne Datei
    assert.equal(rechnungsAnzeigeStatus(ls({ status: 'offen' }), '2026-12-01'), 'eingezogen');
    assert.equal(rechnungsAnzeigeStatus(ls({ status: 'bezahlt' }), '2026-12-01'), 'bezahlt');
    assert.equal(rechnungsAnzeigeStatus(ls({ status: 'zurueckgebucht' }), '2026-12-01'), 'zurueckgebucht');
    assert.equal(rechnungsAnzeigeStatus(ls({ einzug_am: null }), '2026-12-01'), 'versandt');
    // Datum als Date-Objekt (pg ohne Typparser)
    assert.equal(rechnungsAnzeigeStatus(ls({ einzug_am: '2026-11-09T00:00:00.000Z' }), '2026-11-09'), 'eingezogen');
    // Andere Zahlwege werden nie "eingezogen", auch mit Datei
    assert.equal(rechnungsAnzeigeStatus(ls({ zahlweg: 'ueberweisung', zahlungsziel_datum: '2026-11-20' }), '2026-12-01'), 'ueberfaellig');
    assert.equal(rechnungsAnzeigeStatus(ls({ zahlweg: 'ueberweisung', zahlungsziel_datum: '2026-11-20' }), '2026-11-10'), 'versandt');
});

test('rechnungsArt', () => {
    assert.equal(rechnungsArt({ zahlweg: 'bar', anzahl: 3, bezahltAnzahl: 3 }), 'quittung');
    assert.equal(rechnungsArt({ zahlweg: 'bar', anzahl: 3, bezahltAnzahl: 2 }), 'rechnung');
    // Alles bezahlt ist bei jedem Zahlweg eine Quittung, außer Lastschrift (Stufe 3).
    assert.equal(rechnungsArt({ zahlweg: 'ueberweisung', anzahl: 3, bezahltAnzahl: 3 }), 'quittung');
    assert.equal(rechnungsArt({ zahlweg: 'ueberweisung', anzahl: 3, bezahltAnzahl: 2 }), 'rechnung');
    assert.equal(rechnungsArt({ zahlweg: 'lastschrift', anzahl: 3, bezahltAnzahl: 3 }), 'rechnung');
    assert.equal(rechnungsArt({ zahlweg: 'ueberweisung', anzahl: 0, bezahltAnzahl: 0 }), 'rechnung');
});

test('angerechneterBetragCent: bezahlte Kämpfer bei jedem Zahlweg außer Lastschrift', () => {
    assert.equal(angerechneterBetragCent({ zahlweg: 'bar', anzahl: 3, bezahltAnzahl: 1 }, 800), 800);
    assert.equal(angerechneterBetragCent({ zahlweg: 'ueberweisung', anzahl: 3, bezahltAnzahl: 2 }, 800), 1600);
    assert.equal(angerechneterBetragCent({ zahlweg: 'ueberweisung', anzahl: 2, bezahltAnzahl: 5 }, 800), 1600);
    assert.equal(angerechneterBetragCent({ zahlweg: 'lastschrift', anzahl: 3, bezahltAnzahl: 3 }, 800), 0);
});
