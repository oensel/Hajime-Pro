import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, degrees } from 'pdf-lib';
import { renderUrkunden, leseVorlagenPdf, FehlerUngueltigesPdf } from '../../src/services/urkundenRenderer.js';

async function blanko(rotate = 0, leer = false) {
    const d = await PDFDocument.create();
    const p = d.addPage([595.28, 841.89]);
    if (!leer) p.drawRectangle({ x: 20, y: 20, width: 555, height: 800, borderWidth: 2 });
    if (rotate) p.setRotation(degrees(rotate));
    return d.save();
}
const feld = (text, breite = 400) => ({ id: 'f', text, x: 97, y: 400, breite, schrift: 'noto-serif-bold', groesse: 30, farbe: '#112233', ausrichtung: 'zentriert' });

test('3 Datensätze → 3 Seiten, Sonderzeichen ohne Warnung', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}'), feld('Kreismeisterschaft')],
        datensaetze: [{ Name: 'Łukasz Şahin' }, { Name: 'Anna' }, { Name: 'Đorđe' }] });
    assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 3);
    assert.deepEqual(r.warnungen, []);
});

test('zu langer Text → Warnung zu_lang auf Seite 1', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}', 50)], datensaetze: [{ Name: 'Maximiliane Mustermann-Schmidt' }] });
    assert.deepEqual(r.warnungen.map(w => [w.seite, w.grund]), [[1, 'zu_lang']]);
});

test('fehlendes Zeichen → Warnung', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(), felder: [feld('{Name}')], datensaetze: [{ Name: '李雷' }] });
    assert.equal(r.warnungen[0].grund, 'zeichen_fehlt');
});

test('Vorlage liegt nur einmal im PDF', async () => {
    const pdfBytes = await blanko();
    const r = await renderUrkunden({ pdfBytes, felder: [feld('{Name}')], datensaetze: Array.from({ length: 100 }, (_, i) => ({ Name: `Person ${i}` })) });
    assert.ok(r.bytes.length < pdfBytes.length + 1_000_000, String(r.bytes.length));
});

test('gedrehte Vorlage wird mit sichtbarer Größe gerendert', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(90), felder: [feld('{Name}')], datensaetze: [{ Name: 'Anna' }] });
    const seite = (await PDFDocument.load(r.bytes)).getPage(0);
    assert.deepEqual([Math.round(seite.getWidth()), Math.round(seite.getHeight())], [842, 595]);
});

test('leseVorlagenPdf: Rotation und ungültig', async () => {
    assert.deepEqual(await leseVorlagenPdf(await blanko(90)), { breite: 841.89, hoehe: 595.28 });
    await assert.rejects(leseVorlagenPdf(new Uint8Array([1, 2, 3])), FehlerUngueltigesPdf);
});

test('Seite ganz ohne Inhalt wird ohne Hintergrund gerendert', async () => {
    const r = await renderUrkunden({ pdfBytes: await blanko(0, true), felder: [feld('{Name}')], datensaetze: [{ Name: 'Anna' }] });
    assert.equal((await PDFDocument.load(r.bytes)).getPageCount(), 1);
});
