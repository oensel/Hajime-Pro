import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { URKUNDEN_SCHRIFTEN, findeSchrift, STANDARD_SCHRIFT_ID, SCHRIFT_FAMILIEN, stileDerFamilie, schriftFuer } from '../../src/shared/urkundenSchriften.js';

test('jede Schrift hat eine vorhandene Datei', () => {
    assert.equal(URKUNDEN_SCHRIFTEN.length, 11);
    for (const s of URKUNDEN_SCHRIFTEN) {
        assert.ok(fs.existsSync(path.join('public/fonts/urkunden', s.datei)), s.datei);
    }
});

test('findeSchrift', () => {
    assert.equal(findeSchrift(STANDARD_SCHRIFT_ID).datei, 'NotoSans-Regular.ttf');
    assert.equal(findeSchrift('gibtsnicht'), undefined);
});

test('Schreibschriften und Fraktur kennen Umlaute und ß', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    for (const id of ['pinyon-script', 'alex-brush', 'unifraktur-maguntia']) {
        const font = await doc.embedFont(fs.readFileSync(path.join('public/fonts/urkunden', findeSchrift(id).datei)));
        const zeichen = new Set(font.getCharacterSet());
        for (const c of 'UrkundeÄÖÜäöüß') assert.ok(zeichen.has(c.codePointAt(0)), `${id}: ${c}`);
    }
});

test('Familien und Stile', () => {
    assert.equal(SCHRIFT_FAMILIEN.length, 7);
    assert.deepEqual(stileDerFamilie('Noto Serif'), ['normal', 'fett', 'kursiv']);
    assert.deepEqual(stileDerFamilie('Cinzel (Titel)'), ['normal']);
    assert.equal(schriftFuer('Noto Sans', 'kursiv'), 'noto-sans-italic');
    assert.equal(schriftFuer('Noto Serif', 'fett'), 'noto-serif-bold');
    assert.equal(schriftFuer('Alex Brush (Schreibschrift)', 'fett'), 'alex-brush');
    for (const s of URKUNDEN_SCHRIFTEN) assert.equal(schriftFuer(s.familie, s.stil), s.id);
});
