import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
    baueVorlagenDatei, leseVorlagenDatei, legeVorlagenAn, freierName, FehlerUngueltigeDatei, DATEI_FORMAT
} from '../../src/services/urkundenVorlagenDatei.js';
import { PNG_1PX } from './helpers/bilder.js';
import { starteTestPostgres } from '../helpers/testPostgres.js';

async function blanko() {
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    return Buffer.from(await d.save());
}
const textFeld = { id: 'f1', text: '{Name}', x: 10, y: 20, breite: 200, schrift: 'noto-sans', groesse: 20, farbe: '#000000', ausrichtung: 'links' };
const bildFeld = { id: 'i1', typ: 'bild', bild_id: 'logo', x: 10, y: 100, breite: 50, hoehe: 50 };

test('freierName zählt hoch', () => {
    assert.equal(freierName('A', new Set()), 'A');
    assert.equal(freierName('A', new Set(['A'])), 'A (2)');
    assert.equal(freierName('A', new Set(['A', 'A (2)'])), 'A (3)');
});

test('Vorlagendatei: Rundreise ohne Überschreiben, strenge Prüfung', async () => {
    const pdf = await blanko();
    const zeile = {
        name: 'Standard', pdf, pdf_dateiname: 'x.pdf', seiten_breite_pt: 595, seiten_hoehe_pt: 842,
        felder: JSON.stringify([textFeld, bildFeld]),
        bilder: JSON.stringify({ logo: { typ: 'image/png', daten: PNG_1PX }, unbenutzt: { typ: 'image/png', daten: PNG_1PX } }),
        platzbereich: '5', bei_abschluss_anbieten: true
    };
    const datei = JSON.parse(JSON.stringify(baueVorlagenDatei([zeile])));
    assert.equal(datei.format, DATEI_FORMAT);
    assert.deepEqual(Object.keys(datei.vorlagen[0].bilder), ['logo']);
    assert.equal('platzbereich' in datei.vorlagen[0], false);

    const gelesen = await leseVorlagenDatei(datei);
    assert.deepEqual(gelesen.abgelehnt, []);
    assert.equal(gelesen.gueltig.length, 1);
    assert.deepEqual(gelesen.gueltig[0].felder, [textFeld, bildFeld]);

    // Fremde/neuere/leere Dateien werden abgewiesen.
    await assert.rejects(leseVorlagenDatei({ foo: 1 }), FehlerUngueltigeDatei);
    await assert.rejects(leseVorlagenDatei({ ...datei, version: 99 }), FehlerUngueltigeDatei);
    await assert.rejects(leseVorlagenDatei({ ...datei, vorlagen: [] }), FehlerUngueltigeDatei);

    // Einzelne kaputte Vorlagen werden mit Grund abgelehnt, gültige bleiben.
    const v = datei.vorlagen[0];
    const mix = await leseVorlagenDatei({ ...datei, vorlagen: [
        v,
        { ...v, name: 'KeinPdf', pdf_base64: Buffer.from('kein pdf').toString('base64') },
        { ...v, name: 'FeldKaputt', felder: [{ ...textFeld, text: 42 }] },
        { ...v, name: 'BildFehlt', bilder: {} },
        { ...v, name: '  ' }
    ] });
    assert.equal(mix.gueltig.length, 1);
    assert.deepEqual(mix.abgelehnt.map(a => a.name), ['KeinPdf', 'FeldKaputt', 'BildFehlt', '  ']);
});

test('legeVorlagenAn überschreibt nie und vergibt freie Namen', async () => {
    const db = await starteTestPostgres();
    const { knex } = db;
    try {
        const [e] = await knex('vereine').insert({ name: 'JC Test' }).returning('id');
        const vereinId = typeof e === 'object' ? e.id : e;
        await knex('urkunden_vorlagen').insert({ verein_id: vereinId, name: 'Standard', pdf: Buffer.from('%PDF-alt'), seiten_breite_pt: 1, seiten_hoehe_pt: 1 });
        const pdf = await blanko();
        const v = { name: 'Standard', pdf, pdf_dateiname: null, seiten_breite_pt: 595, seiten_hoehe_pt: 842, felder: [textFeld], bilder: {} };
        const angelegt = await legeVorlagenAn(knex, vereinId, [v, v]);
        assert.deepEqual(angelegt.map(a => a.name), ['Standard (2)', 'Standard (3)']);
        const zeilen = await knex('urkunden_vorlagen').where({ verein_id: vereinId }).orderBy('name');
        assert.equal(zeilen.length, 3);
        assert.equal(Buffer.from(zeilen[0].pdf).toString(), '%PDF-alt');
    } finally { await db.stoppe(); }
});
