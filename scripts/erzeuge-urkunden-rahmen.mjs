// Erzeugt die mitgelieferten Standard-Rahmen (A4 hoch, reine Vektorgrafik) nach
// public/urkunden-rahmen/. Aufruf: node scripts/erzeuge-urkunden-rahmen.mjs
// Die Ergebnisse sind committet; das Skript wird nur für Änderungen am Design gebraucht.
import fs from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import { URKUNDEN_RAHMEN } from '../src/shared/urkundenRahmen.js';

const B = 595.28;
const H = 841.89;
const ZIEL = new URL('../public/urkunden-rahmen/', import.meta.url);

const farbe = hex => rgb(...[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255));

// Rechteckrahmen mit Abstand a zum Seitenrand (pdf-lib: Ursprung unten links).
function rahmen(seite, a, staerke, f) {
    seite.drawRectangle({ x: a, y: a, width: B - 2 * a, height: H - 2 * a, borderWidth: staerke, borderColor: f });
}

// SVG-Pfad in einer Ecke; der Pfad ist für die Ecke oben links gezeichnet (y nach unten) und wird
// für die anderen Ecken gespiegelt. Nur M/L/C/Z mit absoluten Koordinatenpaaren — bei A würden
// auch Radien und Flags mitgespiegelt.
function ecken(seite, pfad, f, { staerke = 1, fuellung = false } = {}) {
    const lagen = [
        { x: 0, y: H, scaleX: 1, scaleY: 1 },
        { x: B, y: H, scaleX: -1, scaleY: 1 },
        { x: 0, y: 0, scaleX: 1, scaleY: -1 },
        { x: B, y: 0, scaleX: -1, scaleY: -1 }
    ];
    for (const { x, y, scaleX, scaleY } of lagen) {
        // drawSvgPath kennt nur einen Skalierungsfaktor — Spiegelung über eigene Koordinaten.
        const gespiegelt = pfad.replace(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g, (_, px, py) => `${Number(px) * scaleX},${Number(py) * scaleY}`);
        seite.drawSvgPath(gespiegelt, fuellung
            ? { x, y, color: f, borderWidth: 0 }
            : { x, y, borderColor: f, borderWidth: staerke });
    }
}

const DESIGNS = {
    // Goldener Doppelrahmen mit Rauten in den Ecken
    klassisch(seite) {
        const gold = farbe('#b08d3c');
        rahmen(seite, 22, 4, gold);
        rahmen(seite, 34, 1, gold);
        ecken(seite, 'M 28,20 L 36,28 L 28,36 L 20,28 Z', gold, { fuellung: true });
    },
    // Bordeaux, Doppellinie, geschwungene Eckornamente und Zierlinie oben
    ornament(seite) {
        const rot = farbe('#7b1e2b');
        rahmen(seite, 28, 2.5, rot);
        rahmen(seite, 36, 0.75, rot);
        ecken(seite, 'M 36,110 C 36,70 70,36 110,36 M 48,90 C 52,64 64,52 90,48 M 36,36 C 60,40 72,52 76,76 C 52,72 40,60 36,36 Z', rot, { staerke: 1.2 });
        for (const [x, y] of [[62, H - 62], [B - 62, H - 62], [62, 62], [B - 62, 62]]) {
            seite.drawCircle({ x, y, size: 3.5, color: rot });
        }
        seite.drawLine({ start: { x: B / 2 - 90, y: H - 70 }, end: { x: B / 2 - 12, y: H - 70 }, thickness: 0.75, color: rot });
        seite.drawLine({ start: { x: B / 2 + 12, y: H - 70 }, end: { x: B / 2 + 90, y: H - 70 }, thickness: 0.75, color: rot });
        seite.drawSvgPath('M 0,-6 L 6,0 L 0,6 L -6,0 Z', { x: B / 2, y: H - 70, color: rot, borderWidth: 0 });
    },
    // Farbbalken oben und unten, feine Kontur
    modern(seite) {
        const blau = farbe('#1f3a68');
        const hell = farbe('#4a90d9');
        seite.drawRectangle({ x: 0, y: H - 64, width: B, height: 64, color: blau });
        seite.drawRectangle({ x: 0, y: H - 74, width: B, height: 5, color: hell });
        seite.drawRectangle({ x: 0, y: 0, width: B, height: 32, color: blau });
        seite.drawRectangle({ x: 0, y: 37, width: B, height: 3, color: hell });
        seite.drawRectangle({ x: 30, y: 60, width: B - 60, height: H - 164, borderWidth: 0.5, borderColor: farbe('#9aa9c2') });
    },
    // Schwarz-roter Rahmen mit roten Eckquadraten
    judo(seite) {
        const schwarz = farbe('#1a1a1a');
        const rot = farbe('#c8102e');
        rahmen(seite, 20, 7, schwarz);
        rahmen(seite, 33, 2, rot);
        rahmen(seite, 38, 0.5, schwarz);
        ecken(seite, 'M 16,16 L 44,16 L 44,44 L 16,44 Z', rot, { fuellung: true });
        ecken(seite, 'M 25,25 L 35,25 L 35,35 L 25,35 Z', farbe('#ffffff'), { fuellung: true });
    },
    // Eine dünne graue Linie
    schlicht(seite) {
        rahmen(seite, 30, 0.75, farbe('#8a8a8a'));
    }
};

await fs.mkdir(ZIEL, { recursive: true });
for (const { id, name, datei } of URKUNDEN_RAHMEN) {
    const doc = await PDFDocument.create();
    doc.setTitle(`Urkunden-Rahmen ${name}`);
    doc.setProducer('Hajime Pro');
    doc.setCreationDate(new Date('2026-09-30T00:00:00Z'));
    doc.setModificationDate(new Date('2026-09-30T00:00:00Z'));
    DESIGNS[id](doc.addPage([B, H]));
    await fs.writeFile(new URL(datei, ZIEL), await doc.save());
    console.log(`public/urkunden-rahmen/${datei}`);
}
