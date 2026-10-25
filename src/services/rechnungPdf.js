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

/** Cent -> deutscher Betrag mit Tausenderpunkt, z. B. 123456 -> "1.234,56 €" (gewöhnliches Leerzeichen vor €). */
export function euro(cent) {
    const c = Math.round(Number(cent) || 0);
    const betrag = Math.abs(c);
    const ganz = String(Math.floor(betrag / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${c < 0 ? '-' : ''}${ganz},${String(betrag % 100).padStart(2, '0')} €`.replace(/ /g, ' ');
}
/** ISO-Text oder Date (UTC-Anteile, unabhängig von der Zeitzone) -> TT.MM.JJJJ. */
export function datum(wert) {
    const iso = wert instanceof Date ? (Number.isNaN(wert.getTime()) ? '' : wert.toISOString()) : String(wert || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};
const zeilenVon = (text) => String(text || '').split(/\r?\n/).map(z => z.trim()).filter(Boolean);

export function berechneOffenCent(d) {
    return Math.max(0, (d.betragCent || 0) - (d.barErhaltenCent || 0));
}

/** Girocode nur bei echter Rechnung mit Überweisungsangaben und offenem Betrag. */
export function braucheGirocode(d) {
    return d.art !== 'quittung' && d.zahlweg !== 'lastschrift' && berechneOffenCent(d) > 0 && !!d.zahlung?.iban;
}

export function baueRechnungsZeilen(d) {
    const istQuittung = d.art === 'quittung';
    const a = d.aussteller || {};
    const e = d.empfaenger || {};
    const offen = berechneOffenCent(d);
    const titel = `${istQuittung ? 'Quittung' : 'Rechnung'} Nr. ${d.nummer}`;
    const kopf = [
        a.name, ...zeilenVon(a.anschrift), a.rechnung_email,
        a.steuernummer ? `Steuernummer: ${a.steuernummer}` : null,
        a.ust_id ? `USt-IdNr.: ${a.ust_id}` : null,
        '',
        titel,
        `${istQuittung ? 'Quittungsdatum' : 'Rechnungsdatum'}: ${datum(d.rechnungsdatum)}`,
        `Leistungszeitpunkt: ${datum(d.leistungsdatum)}`
    ].filter(z => z != null);
    const empfaenger = [e.name, e.ansprechperson ? `z. Hd. ${e.ansprechperson}` : null, ...zeilenVon(e.anschrift)].filter(Boolean);
    const positionen = [
        { text: `Startgeld ${d.turnierBezeichnung}: ${d.anzahl} Kämpfer à ${euro(d.einzelpreisCent)}`, betrag: euro(d.betragCent) },
        ...(d.kaempfer || []).map(k => ({ text: String(k), betrag: '', einzug: true }))
    ];
    const summen = [{ text: 'Gesamtbetrag', betrag: euro(d.betragCent) }];
    if (d.zahlweg === 'bar' && (d.barErhaltenCent || 0) > 0 && offen > 0) {
        summen.push({ text: 'bar erhalten', betrag: euro(d.barErhaltenCent) }, { text: 'offen', betrag: euro(offen) });
    }
    const zahlung = [];
    if (istQuittung || (d.zahlweg === 'bar' && offen === 0)) {
        zahlung.push(`Betrag bar erhalten am ${datum(d.barDatum || d.rechnungsdatum)}.`);
    } else if (d.zahlweg === 'lastschrift') {
        zahlung.push('Der Betrag wird per Lastschrift eingezogen.');
    } else if (d.zahlung?.iban) {
        zahlung.push(offen < (d.betragCent || 0) ? `Bitte überweisen Sie den offenen Betrag von ${euro(offen)}:` : 'Bitte überweisen Sie den Betrag:');
        zahlung.push(`Kontoinhaber: ${d.zahlung.kontoinhaber}`, `IBAN: ${formatiereIban(d.zahlung.iban)}`,
            `Verwendungszweck: ${d.zahlung.verwendungszweck}`);
        if (d.zahlungszielDatum) zahlung.push(`zahlbar bis ${datum(d.zahlungszielDatum)}`);
    }
    if (!istQuittung && offen > 0 && d.zahlweg !== 'lastschrift' && !d.zahlung?.iban) {
        zahlung.push(`Hinweis: Es ist keine Bankverbindung hinterlegt. Bitte klären Sie die Zahlung von ${euro(offen)} direkt mit dem Aussteller.`);
    }
    const fuss = [a.ust_hinweis, d.hinweis].filter(Boolean);
    return { kopf, titelIndex: kopf.indexOf(titel), empfaenger, positionen, summen, zahlung, fuss };
}

/** Bricht Text an Wortgrenzen um; einzelne zu breite Wörter werden zeichenweise getrennt. breiteVon misst einen Text. */
export function umbrechen(breiteVon, text, breite) {
    const zeilen = [];
    let aktuell = '';
    const hinzu = (wort) => {
        const probe = aktuell ? `${aktuell} ${wort}` : wort;
        if (breiteVon(probe) <= breite) { aktuell = probe; return; }
        if (aktuell) { zeilen.push(aktuell); aktuell = ''; }
        if (breiteVon(wort) <= breite) { aktuell = wort; return; }
        for (const c of wort) {
            if (aktuell && breiteVon(aktuell + c) > breite) { zeilen.push(aktuell); aktuell = ''; }
            aktuell += c;
        }
    };
    for (const w of String(text).split(' ')) hinzu(w);
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
    const neueSeite = () => { seite = pdf.addPage([SEITE.b, SEITE.h]); y = SEITE.h - RAND - ZEILE; };
    const platz = (hoehe) => { if (y - hoehe < RAND) neueSeite(); };
    const text = (t, { font = normal, size = 10, x = RAND, rechts = false } = {}) => {
        const s = sauber(t);
        const px = rechts ? SEITE.b - RAND - font.widthOfTextAtSize(s, size) : x;
        seite.drawText(s, { x: px, y, size, font, color: schwarz });
    };
    // Bricht um und zeichnet; Einzug über x-Versatz (nicht über führende Leerzeichen).
    const absatz = (zeilen, opt = {}, einzug = 0, reserve = 0) => {
        const font = opt.font || normal;
        const size = opt.size || 10;
        for (const t of zeilen) {
            for (const w of umbrechen(s => font.widthOfTextAtSize(s, size), sauber(t), breite - einzug - reserve)) {
                platz(ZEILE); text(w, { ...opt, x: RAND + einzug }); y -= ZEILE;
            }
        }
    };

    z.kopf.forEach((t, i) => {
        if (!t) { y -= ZEILE; return; }
        const titelZeile = i === z.titelIndex;
        absatz([t], { font: i === 0 || titelZeile ? fett : normal, size: titelZeile ? 13 : 10 });
    });
    y -= ZEILE;
    absatz(z.empfaenger);
    y -= ZEILE;

    const betragBreite = 90;
    for (const p of z.positionen) {
        const einzug = p.einzug ? 12 : 0;
        const font = p.betrag ? fett : normal;
        umbrechen(s => font.widthOfTextAtSize(s, 10), sauber(p.text), breite - einzug - betragBreite).forEach((w, i) => {
            platz(ZEILE);
            text(w, { font, x: RAND + einzug });
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

    if (braucheGirocode(daten)) {
        platz(GIRO_GROESSE + 24);
        y -= 6;
        const payload = baueGiroCodePayload({
            name: daten.zahlung.kontoinhaber, iban: daten.zahlung.iban, betrag: berechneOffenCent(daten) / 100, verwendungszweck: daten.zahlung.verwendungszweck
        });
        text('Girocode zum Scannen mit der Banking-App', { size: 8 }); y -= 6;
        zeichneQr(seite, payload, RAND, y - GIRO_GROESSE, GIRO_GROESSE);
        y -= GIRO_GROESSE + 10;
    }
    y -= ZEILE;
    absatz(z.fuss, { size: 9 });

    // Folgeseiten: Nummer und Seitenzahl oben (nur bei mehr als einer Seite).
    const seiten = pdf.getPages();
    if (seiten.length > 1) {
        seiten.forEach((sz, n) => {
            if (n === 0) return;
            sz.drawText(sauber(`${titel} – Seite ${n + 1}/${seiten.length}`), { x: RAND, y: SEITE.h - RAND + 4, size: 8, font: normal, color: rgb(0.4, 0.4, 0.4) });
        });
    }
    return pdf.save();
}
