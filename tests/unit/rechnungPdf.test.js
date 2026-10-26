import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { baueRechnungsZeilen, erzeugeRechnungPdf, euro, datum, umbrechen, braucheGirocode, giroCodePayloadFuer } from '../../src/services/rechnungPdf.js';

const basis = (extra = {}) => ({
    art: 'rechnung', nummer: 'JCK-00001', rechnungsdatum: '2026-11-01', leistungsdatum: '2026-10-31',
    zahlungszielDatum: '2026-11-15', turnierBezeichnung: 'Herbstturnier',
    aussteller: { name: 'JC Kiel', anschrift: 'Weg 1\n24103 Kiel', rechnung_email: 'a@b.de', steuernummer: '12/345/67890', ust_id: '', ust_hinweis: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' },
    empfaenger: { name: 'JC Lübeck', ansprechperson: 'Frau Muster', anschrift: 'Str 2\n23552 Lübeck' },
    kaempfer: ['Anna A', 'Ben B', 'Cem C'], anzahl: 3, einzelpreisCent: 800, betragCent: 2400, barErhaltenCent: 0,
    zahlweg: 'ueberweisung',
    zahlung: { kontoinhaber: 'JC Kiel e.V.', iban: 'DE89370400440532013000', verwendungszweck: 'Startgeld JCK-00001' },
    hinweis: 'Danke!', ...extra
});
const alles = (z) => Object.values(z).flat().map(e => (typeof e === 'string' ? e : `${e.text} ${e.betrag}`)).join('\n');

test('Überweisung enthält Betrag, IBAN, Zweck und Zahlungsziel', () => {
    const t = alles(baueRechnungsZeilen(basis()));
    for (const s of ['24,00 €', 'DE89 3704 0044 0532 0130 00', 'Startgeld JCK-00001', 'zahlbar bis 15.11.2026', '12/345/67890', 'Gemäß § 19 UStG', 'Rechnung', '01.11.2026']) assert.ok(t.includes(s), s);
});
test('Quittung: bar erhalten, keine IBAN', () => {
    const t = alles(baueRechnungsZeilen(basis({ art: 'quittung', zahlweg: 'bar', barErhaltenCent: 2400, zahlung: null, zahlungszielDatum: null })));
    assert.ok(t.includes('bar erhalten'));
    assert.ok(!t.includes('DE89'));
});
test('Bar teilweise zeigt offen', () => {
    const t = alles(baueRechnungsZeilen(basis({ zahlweg: 'bar', barErhaltenCent: 800 })));
    assert.ok(t.includes('offen 16,00 €'));
    assert.ok(t.includes('bar erhalten 8,00 €'));
});
test('Überweisung teilweise bezahlt: "bereits bezahlt", offen, Girocode nur über den offenen Betrag', () => {
    const d = basis({ barErhaltenCent: 800 });
    const t = alles(baueRechnungsZeilen(d));
    assert.ok(t.includes('bereits bezahlt 8,00 €'));
    assert.ok(t.includes('offen 16,00 €'));
    assert.ok(!t.includes('bar erhalten'));
    assert.ok(t.includes('offenen Betrag von 16,00 €'));
    assert.equal(braucheGirocode(d), true);
    assert.ok(giroCodePayloadFuer(d).split(String.fromCharCode(10)).includes('EUR16.00'));
    assert.ok(giroCodePayloadFuer(basis()).split(String.fromCharCode(10)).includes('EUR24.00'));
});
test('Quittung bei Überweisung: bereits bezahlt am, keine IBAN, kein Girocode', () => {
    const d = basis({ art: 'quittung', barErhaltenCent: 2400, barDatum: '2026-10-31', zahlung: null, zahlungszielDatum: null });
    const t = alles(baueRechnungsZeilen(d));
    assert.ok(t.includes('Betrag bereits bezahlt am 31.10.2026.'));
    assert.ok(!t.includes('bar erhalten'));
    assert.ok(!t.includes('DE89'));
    assert.equal(braucheGirocode(d), false);
    assert.equal(baueRechnungsZeilen(d).kopf[baueRechnungsZeilen(d).titelIndex], 'Quittung Nr. JCK-00001');
});
const LASTSCHRIFT = { mandatsreferenz: 'JCKM12V7', mandatDatum: '2026-10-01', glaeubigerId: 'DE98ZZZ09999999999', ibanMaske: 'DE02 **** **** **** **20 51', einzugAm: '2026-11-09' };
test('Lastschrift: Vorabankündigung mit Betrag, Einzugsdatum, Maske, Mandatsreferenz und Gläubiger-ID; keine Anrechnung, kein Girocode', () => {
    const d = basis({ zahlweg: 'lastschrift', zahlung: null, zahlungszielDatum: null, barErhaltenCent: 0, lastschrift: LASTSCHRIFT });
    const z = baueRechnungsZeilen(d);
    const t = alles(z);
    assert.ok(z.zahlung.includes('Der Betrag von 24,00 € wird per SEPA-Lastschrift am 09.11.2026 von Ihrem Konto DE02 **** **** **** **20 51 eingezogen. Mandatsreferenz JCKM12V7, Gläubiger-ID DE98ZZZ09999999999.'), z.zahlung.join('|'));
    assert.ok(!t.includes('bereits bezahlt'));
    assert.ok(!t.includes('überweisen'));
    assert.ok(!t.includes('zahlbar bis'));
    assert.ok(!t.includes('DE89'));
    assert.ok(!t.includes('keine Bankverbindung'));
    assert.equal(braucheGirocode(d), false);
    // Selbst mit Ausrichter-Bankdaten bleibt es bei der Lastschrift (kein Überweisungsblock, kein Girocode)
    const mitBank = basis({ zahlweg: 'lastschrift', lastschrift: LASTSCHRIFT });
    assert.ok(!alles(baueRechnungsZeilen(mitBank)).includes('DE89'));
    assert.equal(braucheGirocode(mitBank), false);
});
test('Lastschrift ohne vollständige Angaben wirft statt einen Satz ohne Datum zu drucken', () => {
    for (const lastschrift of [undefined, null, { ...LASTSCHRIFT, einzugAm: null }, { ...LASTSCHRIFT, ibanMaske: '' }, { ...LASTSCHRIFT, glaeubigerId: undefined }, { ...LASTSCHRIFT, mandatsreferenz: null }]) {
        assert.throws(() => baueRechnungsZeilen(basis({ zahlweg: 'lastschrift', zahlung: null, lastschrift })), /Lastschriftangaben/);
    }
});
test('Lastschrift-PDF wird erzeugt', async () => {
    const bytes = await erzeugeRechnungPdf(basis({ zahlweg: 'lastschrift', zahlung: null, zahlungszielDatum: null, lastschrift: LASTSCHRIFT }));
    assert.equal((await PDFDocument.load(bytes)).getTitle(), 'Rechnung JCK-00001');
});
test('PDF mit 120 Kämpfern hat mehrere Seiten und Titel', async () => {
    const bytes = await erzeugeRechnungPdf(basis({ kaempfer: Array.from({ length: 120 }, (_, i) => `Kämpfer ${i}`), anzahl: 120, betragCent: 96000 }));
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 2);
    assert.equal(doc.getTitle(), 'Rechnung JCK-00001');
});
test('Zeichen außerhalb der Schrift und Nullbetrag werfen nicht', async () => {
    await erzeugeRechnungPdf(basis({ kaempfer: ['Max \u{1F600}'], turnierBezeichnung: 'T \u{1F600}' }));
    await erzeugeRechnungPdf(basis({ betragCent: 0, anzahl: 0, kaempfer: [] }));
});

test('euro: deutsches Format mit Tausenderpunkt und normalem Leerzeichen', () => {
    assert.equal(euro(99), '0,99 €');
    assert.equal(euro(100000), '1.000,00 €');
    assert.equal(euro(123456), '1.234,56 €');
    assert.equal(euro(1234567), '12.345,67 €');
    assert.ok(!euro(123456).includes(' '));
});
test('datum: ISO-Text und Date', () => {
    assert.equal(datum('2026-11-15'), '15.11.2026');
    assert.equal(datum(new Date('2026-11-15T00:00:00Z')), '15.11.2026');
});
test('umbrechen: nichts ragt über die Breite, lange Wörter werden getrennt', () => {
    const mess = (t) => [...t].length * 5;
    const lang = 'A'.repeat(120);
    for (const text of [lang, `${lang} und ein ganz normaler Satz mit mehreren Wörtern`]) {
        const zeilen = umbrechen(mess, text, 100);
        assert.ok(zeilen.length > 1);
        for (const z of zeilen) assert.ok(mess(z) <= 100, z);
        assert.equal(zeilen.join(' ').replace(/ /g, ''), text.replace(/ /g, ''));
    }
});
test('braucheGirocode: Entscheidungstabelle', () => {
    assert.equal(braucheGirocode(basis()), true);
    assert.equal(braucheGirocode(basis({ zahlweg: 'lastschrift' })), false);
    assert.equal(braucheGirocode(basis({ zahlweg: 'bar', barErhaltenCent: 2400 })), false);
    assert.equal(braucheGirocode(basis({ zahlung: null })), false);
    assert.equal(braucheGirocode(basis({ art: 'quittung' })), false);
    assert.equal(braucheGirocode(basis({ zahlweg: 'bar', barErhaltenCent: 800 })), true);
});
test('Lastschrift-Satz, barDatum, fehlende Bankdaten', () => {
    assert.ok(alles(baueRechnungsZeilen(basis({ zahlweg: 'lastschrift', zahlung: null, lastschrift: LASTSCHRIFT }))).includes('per SEPA-Lastschrift am 09.11.2026'));
    const q = alles(baueRechnungsZeilen(basis({ art: 'quittung', zahlweg: 'bar', barErhaltenCent: 2400, barDatum: '2026-10-31', zahlung: null })));
    assert.ok(q.includes('bar erhalten am 31.10.2026'));
    assert.ok(alles(baueRechnungsZeilen(basis({ zahlung: null }))).includes('keine Bankverbindung'));
});
test('Kopf trägt Titelindex; Kämpfer sind eingezogen ohne führende Leerzeichen', () => {
    const z = baueRechnungsZeilen(basis());
    assert.equal(z.kopf[z.titelIndex], 'Rechnung Nr. JCK-00001');
    assert.equal(z.positionen[1].text, 'Anna A');
    assert.equal(z.positionen[1].einzug, true);
});
test('Rechnung mit 120-Zeichen-Namen wird erzeugt, Folgeseiten bei langer Liste', async () => {
    const lang = 'Sehr langer Name '.repeat(8).slice(0, 120);
    const bytes = await erzeugeRechnungPdf(basis({
        turnierBezeichnung: lang, aussteller: { ...basis().aussteller, name: lang, anschrift: 'X'.repeat(120) },
        kaempfer: Array.from({ length: 100 }, (_, i) => `Kämpfer ${i}`), anzahl: 100, betragCent: 80000
    }));
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 2);
});
