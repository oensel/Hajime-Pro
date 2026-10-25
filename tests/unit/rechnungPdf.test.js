import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { baueRechnungsZeilen, erzeugeRechnungPdf } from '../../src/services/rechnungPdf.js';

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
test('PDF mit 120 Kämpfern hat mehrere Seiten und Titel', async () => {
    const bytes = await erzeugeRechnungPdf(basis({ kaempfer: Array.from({ length: 120 }, (_, i) => `Kämpfer ${i}`), anzahl: 120, betragCent: 96000 }));
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 2);
    assert.equal(doc.getTitle(), 'Rechnung JCK-00001');
});
test('Zeichen außerhalb der Schrift werfen nicht; Nullbetrag ohne Girocode', async () => {
    await erzeugeRechnungPdf(basis({ kaempfer: ['Max \u{1F600}'], turnierBezeichnung: 'T \u{1F600}' }));
    await erzeugeRechnungPdf(basis({ betragCent: 0, anzahl: 0, kaempfer: [] }));
});
