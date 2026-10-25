// Rechnungs-/Quittungs-PDF für das Startgeld (A4, NotoSans, pdf-lib). Texte kommen aus der reinen Funktion
// baueRechnungsZeilen; der Girocode (EPC-QR) wird bei offenem Betrag als Vektorquadrate gezeichnet.
import fs from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { bereinigeText } from './helferAusweis.js';
import { zeichneQr } from './pdfQr.js';
import { baueGiroCodePayload } from '../shared/girocode.js';
import { formatiereIban } from '../shared/iban.js';

const SCHRIFT_VERZEICHNIS = new URL('../../public/fonts/urkunden/', import.meta.url);
const SEITE = { b: 595, h: 842 };
const RAND = 56;
const ZEILE = 14;
const GIRO_GROESSE = 113.4; // 40 mm

const euro = (cent) => `${(Math.round(Number(cent) || 0) / 100).toFixed(2).replace('.', ',')} €`;
const datum = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(iso || '');
};
const zeilenVon = (text) => String(text || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean);

export function berechneOffenCent(d) {
    return Math.max(0, (d.betragCent || 0) - (d.barErhaltenCent || 0));
}

export function baueRechnungsZeilen(d) {
    const istQuittung = d.art === 'quittung';
    const a = d.aussteller || {};
    const e = d.empfaenger || {};
    const offen = berechneOffenCent(d);
    const kopf = [
        a.name, ...zeilenVon(a.anschrift), a.rechnung_email,
        a.steuernummer ? `Steuernummer: ${a.steuernummer}` : null,
        a.ust_id ? `USt-IdNr.: ${a.ust_id}` : null,
        '',
        `${istQuittung ? 'Quittung' : 'Rechnung'} Nr. ${d.nummer}`,
        `${istQuittung ? 'Quittungsdatum' : 'Rechnungsdatum'}: ${datum(d.rechnungsdatum)}`,
        `Leistungszeitpunkt: ${datum(d.leistungsdatum)}`
    ].filter(z => z != null);
    const empfaenger = [e.name, e.ansprechperson ? `z. Hd. ${e.ansprechperson}` : null, ...zeilenVon(e.anschrift)].filter(Boolean);
    const positionen = [
        { text: `Startgeld ${d.turnierBezeichnung}: ${d.anzahl} Kämpfer à ${euro(d.einzelpreisCent)}`, betrag: euro(d.betragCent) },
        ...(d.kaempfer || []).map(k => ({ text: `   ${k}`, betrag: '' }))
    ];
    const summen = [{ text: 'Gesamtbetrag', betrag: euro(d.betragCent) }];
    if (d.zahlweg === 'bar' && (d.barErhaltenCent || 0) > 0 && offen > 0) {
        summen.push({ text: 'bar erhalten', betrag: euro(d.barErhaltenCent) }, { text: 'offen', betrag: euro(offen) });
    }
    const zahlung = [];
    if (istQuittung || (d.zahlweg === 'bar' && offen === 0)) {
        zahlung.push(`Betrag bar erhalten am ${datum(d.rechnungsdatum)}.`);
    } else if (d.zahlweg === 'lastschrift') {
        zahlung.push('Der Betrag wird per Lastschrift eingezogen.');
    } else if (d.zahlung?.iban) {
        zahlung.push(offen < (d.betragCent || 0) ? `Bitte überweisen Sie den offenen Betrag von ${euro(offen)}:` : 'Bitte überweisen Sie den Betrag:');
        zahlung.push(`Kontoinhaber: ${d.zahlung.kontoinhaber}`, `IBAN: ${formatiereIban(d.zahlung.iban)}`,
            `Verwendungszweck: ${d.zahlung.verwendungszweck}`);
        if (d.zahlungszielDatum) zahlung.push(`zahlbar bis ${datum(d.zahlungszielDatum)}`);
    }
    const fuss = [a.ust_hinweis, d.hinweis].filter(Boolean);
    return { kopf, empfaenger, positionen, summen, zahlung, fuss };
}

function umbrechen(font, text, groesse, breite) {
    const woerter = text.split(' ');
    const zeilen = [];
    let aktuell = '';
    for (const w of woerter) {
        const probe = aktuell ? `${aktuell} ${w}` : w;
        if (aktuell && font.widthOfTextAtSize(probe, groesse) > breite) { zeilen.push(aktuell); aktuell = w; } else aktuell = probe;
    }
    zeilen.push(aktuell);
    return zeilen;
}

export async function erzeugeRechnungPdf(daten) {
    const z = baueRechnungsZeilen(daten);
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const normal = await pdf.embedFont(await fs.readFile(new URL('NotoSans-Regular.ttf', SCHRIFT_VERZEICHNIS)), { subset: true });
    const fett = await pdf.embedFont(await fs.readFile(new URL('NotoSans-Bold.ttf', SCHRIFT_VERZEICHNIS)), { subset: true });
    const satz = new Set(normal.getCharacterSet());
    const sauber = (t) => bereinigeText(t, satz);
    const titel = `${daten.art === 'quittung' ? 'Quittung' : 'Rechnung'} ${daten.nummer}`;
    pdf.setTitle(sauber(titel));
    pdf.setProducer('Hajime Pro');

    const breite = SEITE.b - 2 * RAND;
    let seite = pdf.addPage([SEITE.b, SEITE.h]);
    let y = SEITE.h - RAND;
    const schwarz = rgb(0.1, 0.1, 0.1);
    const neueSeite = () => { seite = pdf.addPage([SEITE.b, SEITE.h]); y = SEITE.h - RAND; };
    const platz = (hoehe) => { if (y - hoehe < RAND) neueSeite(); };
    const text = (t, { font = normal, size = 10, x = RAND, rechts = false } = {}) => {
        const s = sauber(t);
        const px = rechts ? SEITE.b - RAND - font.widthOfTextAtSize(s, size) : x;
        seite.drawText(s, { x: px, y, size, font, color: schwarz });
    };
    const absatz = (zeilen, opt = {}) => {
        for (const t of zeilen) {
            for (const w of umbrechen(opt.font || normal, sauber(t), opt.size || 10, breite)) {
                platz(ZEILE); text(w, opt); y -= ZEILE;
            }
        }
    };

    z.kopf.forEach((t, i) => {
        platz(ZEILE);
        if (t) text(t, { font: i === 0 || /^(Rechnung|Quittung) Nr\./.test(t) ? fett : normal, size: /^(Rechnung|Quittung) Nr\./.test(t) ? 13 : 10 });
        y -= ZEILE;
    });
    y -= ZEILE;
    absatz(z.empfaenger);
    y -= ZEILE;

    const betragBreite = 90;
    for (const p of z.positionen) {
        const zeilen = umbrechen(normal, sauber(p.text), 10, breite - betragBreite);
        zeilen.forEach((w, i) => {
            platz(ZEILE);
            text(w, { font: p.betrag ? fett : normal });
            if (i === 0 && p.betrag) text(p.betrag, { rechts: true, font: fett });
            y -= ZEILE;
        });
    }
    y -= 6;
    for (const s of z.summen) {
        platz(ZEILE + 4);
        seite.drawLine({ start: { x: RAND, y: y + 11 }, end: { x: SEITE.b - RAND, y: y + 11 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
        text(s.text, { font: fett }); text(s.betrag, { rechts: true, font: fett }); y -= ZEILE + 2;
    }
    y -= ZEILE;
    absatz(z.zahlung);

    const offen = berechneOffenCent(daten);
    if (offen > 0 && daten.zahlung?.iban && daten.zahlweg !== 'lastschrift') {
        platz(GIRO_GROESSE + 24);
        y -= 6;
        const payload = baueGiroCodePayload({
            name: daten.zahlung.kontoinhaber, iban: daten.zahlung.iban, betrag: offen / 100, verwendungszweck: daten.zahlung.verwendungszweck
        });
        text('Girocode zum Scannen mit der Banking-App', { size: 8 }); y -= 6;
        zeichneQr(seite, payload, RAND, y - GIRO_GROESSE, GIRO_GROESSE);
        y -= GIRO_GROESSE + 10;
    }
    y -= ZEILE;
    absatz(z.fuss, { size: 9 });
    return pdf.save();
}
