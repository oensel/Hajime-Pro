// Rendert Urkunden mit pdf-lib: Seite 1 der Blanko-Vorlage wird einmal eingebettet und auf jeder
// Seite als Hintergrund gezeichnet, darüber die Textfelder (Koordinaten in pt, Ursprung oben links).
// Schriften aus public/fonts/urkunden per fontkit mit Subsetting (auch Zeichen außerhalb WinAnsi).
import fs from 'node:fs/promises';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { findeSchrift, STANDARD_SCHRIFT_ID } from '../shared/urkundenSchriften.js';
import { ersetzePlatzhalter, passeGroesseAn, berechneX, basislinie } from '../shared/urkundenText.js';

const SCHRIFT_VERZEICHNIS = new URL('../../public/fonts/urkunden/', import.meta.url);
const schriftCache = new Map();

export class FehlerUngueltigesPdf extends Error {}

async function ladeQuelle(bytes) {
    let quelle;
    try {
        quelle = await PDFDocument.load(bytes);
    } catch (err) {
        const verschluesselt = err?.constructor?.name === 'EncryptedPDFError';
        throw new FehlerUngueltigesPdf(verschluesselt
            ? 'Verschlüsselte PDF-Dateien werden nicht unterstützt.'
            : 'Die Datei ist kein gültiges PDF.');
    }
    if (quelle.getPageCount() === 0) throw new FehlerUngueltigesPdf('Das PDF enthält keine Seite.');
    return quelle;
}

function sichtbareGroesse(seite) {
    const { width, height } = seite.getSize();
    const drehung = ((seite.getRotation().angle % 360) + 360) % 360;
    return { drehung, breite: drehung % 180 === 0 ? width : height, hoehe: drehung % 180 === 0 ? height : width };
}

export async function leseVorlagenPdf(bytes) {
    const { breite, hoehe } = sichtbareGroesse((await ladeQuelle(bytes)).getPage(0));
    return { breite, hoehe };
}

async function schriftBytes(id) {
    const schrift = findeSchrift(id) || findeSchrift(STANDARD_SCHRIFT_ID);
    if (!schriftCache.has(schrift.id)) {
        schriftCache.set(schrift.id, await fs.readFile(new URL(schrift.datei, SCHRIFT_VERZEICHNIS)));
    }
    return schriftCache.get(schrift.id);
}

function farbe(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return rgb(0, 0, 0);
    return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

// Zeichnet die (ungedrehte) eingebettete Seite so, dass sie wie im Viewer mit /Rotate erscheint.
function zeichneHintergrund(seite, hintergrund, drehung) {
    const w = hintergrund.width;
    const h = hintergrund.height;
    const lage = {
        0: { x: 0, y: 0, rotate: degrees(0) },
        90: { x: 0, y: w, rotate: degrees(-90) },
        180: { x: w, y: h, rotate: degrees(180) },
        270: { x: h, y: 0, rotate: degrees(90) }
    }[drehung] || { x: 0, y: 0, rotate: degrees(0) };
    seite.drawPage(hintergrund, lage);
}

// Eine Seite ganz ohne Inhalt (leeres Blanko) lässt sich nicht einbetten — dann ohne Hintergrund.
async function bettetHintergrundEin(ziel, seite) {
    if (!seite.node.Contents()) return null;
    return ziel.embedPage(seite);
}

export async function renderUrkunden({ pdfBytes, felder, datensaetze }) {
    const quelle = await ladeQuelle(pdfBytes);
    const { drehung, breite, hoehe } = sichtbareGroesse(quelle.getPage(0));

    const ziel = await PDFDocument.create();
    ziel.registerFontkit(fontkit);
    const hintergrund = await bettetHintergrundEin(ziel, quelle.getPage(0));

    const schriften = new Map();
    for (const feld of felder) {
        const id = findeSchrift(feld.schrift) ? feld.schrift : STANDARD_SCHRIFT_ID;
        if (!schriften.has(id)) {
            const font = await ziel.embedFont(await schriftBytes(id), { subset: true });
            schriften.set(id, { font, zeichen: new Set(font.getCharacterSet()) });
        }
    }

    const warnungen = [];
    datensaetze.forEach((datensatz, index) => {
        const seite = ziel.addPage([breite, hoehe]);
        if (hintergrund) zeichneHintergrund(seite, hintergrund, drehung);

        for (const feld of felder) {
            const { font, zeichen } = schriften.get(findeSchrift(feld.schrift) ? feld.schrift : STANDARD_SCHRIFT_ID);
            const warne = grund => warnungen.push({ seite: index + 1, name: datensatz.Name ?? '', feld: feld.text, grund });

            let text = ersetzePlatzhalter(feld.text, datensatz);
            if ([...text].some(c => !zeichen.has(c.codePointAt(0)))) {
                text = [...text].map(c => (zeichen.has(c.codePointAt(0)) ? c : '?')).join('');
                warne('zeichen_fehlt');
            }
            if (!text) continue;

            const misst = (t, g) => font.widthOfTextAtSize(t, g);
            const { groesse, passt } = passeGroesseAn(text, feld.groesse, feld.breite, misst);
            if (!passt) warne('zu_lang');

            seite.drawText(text, {
                x: berechneX(feld.ausrichtung, feld.x, feld.breite, misst(text, groesse)),
                y: hoehe - basislinie(feld.y, groesse),
                size: groesse,
                font,
                color: farbe(feld.farbe)
            });
        }
    });

    return { bytes: await ziel.save(), warnungen };
}
