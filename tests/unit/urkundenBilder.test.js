import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { erkenneBildTyp, leseBilder, bereinigeBilder, pruefeBild } from '../../src/services/urkundenBilder.js';
import { renderUrkunden } from '../../src/services/urkundenRenderer.js';
import { pruefeFelder } from '../../src/controllers/urkundenController.js';
import { PNG_1PX, JPEG_1PX, PNG_RGBA_TRANSPARENT, PNG_PALETTE_TRANSPARENT } from './helpers/bilder.js';
import { PDFName, PDFRawStream } from 'pdf-lib';

test('erkenneBildTyp', () => {
    assert.equal(erkenneBildTyp(Buffer.from(PNG_1PX, 'base64')), 'image/png');
    assert.equal(erkenneBildTyp(Buffer.from(JPEG_1PX, 'base64')), 'image/jpeg');
    assert.equal(erkenneBildTyp(Buffer.from('GIF89a')), null);
});

test('pruefeBild', () => {
    assert.equal(pruefeBild({ typ: 'image/png', daten: PNG_1PX }), null);
    assert.match(pruefeBild({ typ: 'image/jpeg', daten: PNG_1PX }), /PNG/);
    assert.match(pruefeBild({ typ: 'image/png', daten: '' }), /fehlt/);
    assert.match(pruefeBild({ typ: 'image/png', daten: Buffer.alloc(3 * 1024 * 1024).toString('base64') }), /2 MB/);
    assert.match(pruefeBild(null), /Ungültig/);
});

test('leseBilder und bereinigeBilder', () => {
    assert.deepEqual(leseBilder('kaputt'), {});
    assert.deepEqual(leseBilder('[]'), {});
    const bilder = { a: { typ: 'image/png', daten: PNG_1PX }, b: { typ: 'image/png', daten: PNG_1PX } };
    assert.deepEqual(Object.keys(bereinigeBilder(bilder, [{ typ: 'bild', bild_id: 'b' }, { text: 'x' }])), ['b']);
});

test('pruefeFelder: Bildfelder', () => {
    const bild = { id: 'i', typ: 'bild', bild_id: 'b1', x: 10, y: 10, breite: 100, hoehe: 80 };
    assert.equal(pruefeFelder([bild], 595, 842, new Set(['b1'])), null);
    assert.match(pruefeFelder([bild], 595, 842, new Set()), /Bild nicht gefunden/);
    assert.match(pruefeFelder([{ ...bild, hoehe: 0 }], 595, 842), /Ungültig/);
    assert.match(pruefeFelder([{ ...bild, y: 800 }], 595, 842), /Seite/);
});

test('Renderer zeichnet PNG und JPEG auf jede Seite, fehlendes Bild wird übersprungen', async () => {
    const d = await PDFDocument.create();
    d.addPage([595.28, 841.89]).drawRectangle({ x: 20, y: 20, width: 555, height: 800, borderWidth: 2 });
    const r = await renderUrkunden({
        pdfBytes: await d.save(),
        felder: [
            { id: 'p', typ: 'bild', bild_id: 'png', x: 20, y: 20, breite: 80, hoehe: 80 },
            { id: 'j', typ: 'bild', bild_id: 'jpg', x: 400, y: 20, breite: 80, hoehe: 80 },
            { id: 'x', typ: 'bild', bild_id: 'weg', x: 200, y: 20, breite: 80, hoehe: 80 }
        ],
        bilder: { png: { typ: 'image/png', daten: PNG_1PX }, jpg: { typ: 'image/jpeg', daten: JPEG_1PX } },
        datensaetze: [{ Name: 'A' }, { Name: 'B' }]
    });
    assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 2);
});

// Transparente PNG-Bereiche (Alphakanal oder Palette mit tRNS; GIFs kommen im Browser als RGBA-PNG
// an) müssen im PDF als Transparenzmaske (SMask) ankommen, sonst wären sie weiß bzw. schwarz.
test('transparente PNGs werden mit Transparenzmaske eingebettet', async () => {
    for (const daten of [PNG_RGBA_TRANSPARENT, PNG_PALETTE_TRANSPARENT]) {
        const d = await PDFDocument.create();
        d.addPage([595.28, 841.89]).drawRectangle({ x: 20, y: 20, width: 555, height: 800, borderWidth: 2 });
        const r = await renderUrkunden({
            pdfBytes: await d.save(),
            felder: [{ id: 'p', typ: 'bild', bild_id: 'logo', x: 20, y: 20, breite: 80, hoehe: 40 }],
            bilder: { logo: { typ: 'image/png', daten } },
            datensaetze: [{ Name: 'A' }]
        });
        const pdf = await PDFDocument.load(r.bytes);
        const bilder = pdf.context.enumerateIndirectObjects()
            .map(([, obj]) => obj)
            .filter(obj => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
        const mitMaske = bilder.filter(b => b.dict.get(PDFName.of('SMask')));
        assert.equal(mitMaske.length, 1, 'genau ein Bild mit SMask');
    }
});
