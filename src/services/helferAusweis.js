// Druckbare Helferausweise (Spec Abschnitt 9): ein Ausweis je Person mit allen Einsätzen des Turniers,
// 4 Ausweise (2×2) je A4-Seite. Technik wie urkundenRenderer.js (pdf-lib + fontkit, Schriften aus
// public/fonts/urkunden). Der QR-Code (`hajime-helfer:<turnierId>:<kennung>`) wird als Rechtecke gezeichnet.
import fs from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import { FachFehler } from '../utils/fachFehler.js';
import { formatiereMinuten } from '../shared/helferZeit.js';
import { datumAlsText } from './helferPlan.js';

const SCHRIFT_VERZEICHNIS = new URL('../../public/fonts/urkunden/', import.meta.url);
const SEITE = { b: 595, h: 842 };
const AUSWEIS = { b: 255, h: 380 };
const RAND = 12;
const KOPF_H = 64;
const QR_GROESSE = 96;
export const PALETTE = ['#1565c0', '#2e7d32', '#c62828', '#6a1b9a', '#ef6c00', '#00838f', '#ad1457', '#37474f'];

const hexZuRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);

function kopfFarbe(bezeichnung) {
    let h = 0;
    for (const c of String(bezeichnung || '')) h = (h * 31 + c.codePointAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

const DUNKEL_HEX = '#1a1a1a';

function luminanz(hex) {
    const [r, g, b] = hexZuRgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG-Kontrastverhältnis zweier Farben (#rrggbb). */
export function kontrastVerhaeltnis(hexA, hexB) {
    const [hell, dunkel] = [luminanz(hexA), luminanz(hexB)].sort((x, y) => y - x);
    return (hell + 0.05) / (dunkel + 0.05);
}

/** Textfarbe (weiß oder dunkel) mit dem höheren Kontrast auf dem Hintergrund. */
export function waehleTextFarbe(hintergrundHex) {
    return kontrastVerhaeltnis('#ffffff', hintergrundHex) >= kontrastVerhaeltnis(DUNKEL_HEX, hintergrundHex) ? '#ffffff' : DUNKEL_HEX;
}

/** Steuerzeichen/Zeilenumbrüche -> Leerzeichen; Zeichen, die die Schrift nicht kennt, -> '?'. */
export function bereinigeText(text, zeichenSatz) {
    const roh = String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!zeichenSatz) return roh;
    return [...roh].map(c => (zeichenSatz.has(c.codePointAt(0)) ? c : '?')).join('');
}

/** Bei zu vielen Einsätzen: letzte Zeile wird „… und n weitere“. */
export const MAX_ZEILEN = 11;
export function planeZeilen(einsaetze, maxZeilen = MAX_ZEILEN) {
    if (einsaetze.length <= maxZeilen) return { anzeige: einsaetze, rest: 0 };
    return { anzeige: einsaetze.slice(0, maxZeilen - 1), rest: einsaetze.length - (maxZeilen - 1) };
}

/** Zeitangabe einer Ausweiszeile; Vortag-Dienste (tag_versatz < 0) tragen das Präfix „Vortag“. */
export function einsatzZeitText(e) {
    return `${e.vortag ? 'Vortag ' : ''}${formatiereMinuten(e.von)}–${formatiereMinuten(e.bis)}`;
}

function datumDeutsch(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (text || '');
}

// Größte Schriftgröße (<= max, >= min), bei der der Text in die Breite passt; sonst gekürzt mit „…“.
function passeAn(font, text, max, min, breite) {
    const satz = zeichenSatzVon(font);
    const sauber = bereinigeText(text, satz);
    let groesse = max;
    while (groesse > min && font.widthOfTextAtSize(sauber, groesse) > breite) groesse -= 0.5;
    if (font.widthOfTextAtSize(sauber, groesse) <= breite) return { text: sauber, groesse };
    let t = [...sauber];
    while (t.length > 1 && font.widthOfTextAtSize(`${t.join('')}…`, groesse) > breite) t.pop();
    return { text: `${t.join('').trimEnd()}…`, groesse };
}

const zeichenSaetze = new WeakMap();
function zeichenSatzVon(font) {
    if (!zeichenSaetze.has(font)) zeichenSaetze.set(font, new Set(font.getCharacterSet()));
    return zeichenSaetze.get(font);
}

function zeichneQr(seite, inhalt, x, y, groesse) {
    const qr = qrcode(0, 'M');
    qr.addData(inhalt);
    qr.make();
    const n = qr.getModuleCount();
    const m = groesse / n;
    seite.drawRectangle({ x, y, width: groesse, height: groesse, color: rgb(1, 1, 1) });
    for (let z = 0; z < n; z++) {
        for (let s = 0; s < n; s++) {
            if (qr.isDark(z, s)) {
                seite.drawRectangle({ x: x + s * m, y: y + groesse - (z + 1) * m, width: m + 0.02, height: m + 0.02, color: rgb(0, 0, 0) });
            }
        }
    }
}

/**
 * Personen mit Einsätzen für die Ausweise (sortiert nach Name). Filter betrifft nur Konten.
 * @returns {Promise<{kennung:string, istKonto:boolean, name:string, einsaetze:{von:number,bis:number,taetigkeit:string,vortag:boolean}[]}[]>}
 */
export async function baueAusweisDaten(knex, turnierId, { benutzerIds } = {}) {
    const zeilen = await knex('helfer_einsaetze as e')
        .join('helfer_slots as s', 's.id', 'e.slot_id')
        .join('helfer_taetigkeiten as t', 't.id', 's.taetigkeit_id')
        .leftJoin('benutzer as b', 'b.id', 'e.benutzer_id')
        .where('t.turnier_id', turnierId)
        .orderByRaw('(t.tag_versatz * 1440 + s.von_min), (t.tag_versatz * 1440 + s.bis_min), e.id')
        .select('e.benutzer_id', 'e.name_manuell', 'b.vorname', 'b.nachname',
            's.von_min', 's.bis_min', 't.bezeichnung', 't.tag_versatz');
    const personen = new Map();
    let manuell = 0;
    for (const z of zeilen) {
        const schluessel = z.benutzer_id ? `b:${z.benutzer_id}` : `m:${z.name_manuell}`;
        if (!personen.has(schluessel)) {
            const istKonto = !!z.benutzer_id;
            personen.set(schluessel, {
                kennung: istKonto ? z.benutzer_id : `m${++manuell}`,
                istKonto,
                name: (istKonto ? [z.vorname, z.nachname].filter(Boolean).join(' ').trim() : String(z.name_manuell || '').trim()) || 'Helfer',
                einsaetze: []
            });
        }
        personen.get(schluessel).einsaetze.push({ von: z.von_min, bis: z.bis_min, taetigkeit: z.bezeichnung, vortag: z.tag_versatz < 0 });
    }
    let liste = [...personen.values()];
    if (benutzerIds?.length) {
        const erlaubt = new Set(benutzerIds);
        liste = liste.filter(p => p.istKonto && erlaubt.has(p.kennung));
    }
    return liste.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * @param {Object} knex
 * @param {number|string} turnierId
 * @param {{ benutzerIds?: string[] }} [optionen] - Filter auf Konten; manuelle Namen nur ohne Filter
 * @returns {Promise<Uint8Array>}
 * @throws {FachFehler} 404, wenn niemand einen Einsatz hat
 */
export async function erzeugeAusweisPdf(knex, turnierId, { benutzerIds } = {}) {
    const turnier = await knex('turniere').where({ id: turnierId }).first('bezeichnung', 'datum', 'ort');
    if (!turnier) throw new FachFehler(404, 'Turnier nicht gefunden.');
    const personen = await baueAusweisDaten(knex, turnierId, { benutzerIds });
    if (personen.length === 0) throw new FachFehler(404, 'Es gibt keine Helfer mit Einsätzen für Ausweise.');

    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const normal = await pdf.embedFont(await fs.readFile(new URL('NotoSans-Regular.ttf', SCHRIFT_VERZEICHNIS)), { subset: true });
    const fett = await pdf.embedFont(await fs.readFile(new URL('NotoSans-Bold.ttf', SCHRIFT_VERZEICHNIS)), { subset: true });
    const datum = datumDeutsch(datumAlsText(turnier.datum));
    const luecke = (SEITE.b - 2 * AUSWEIS.b) / 3;
    const lueckeV = (SEITE.h - 2 * AUSWEIS.h) / 3;

    let seite = null;
    personen.forEach((person, i) => {
        const platz = i % 4;
        if (platz === 0) seite = pdf.addPage([SEITE.b, SEITE.h]);
        const x0 = luecke + (platz % 2) * (AUSWEIS.b + luecke);
        const yOben = SEITE.h - lueckeV - Math.floor(platz / 2) * (AUSWEIS.h + lueckeV);
        const y0 = yOben - AUSWEIS.h;
        const innen = AUSWEIS.b - 2 * RAND;

        seite.drawRectangle({ x: x0, y: y0, width: AUSWEIS.b, height: AUSWEIS.h, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.75, borderDashArray: [4, 3] });
        const farbeHex = kopfFarbe(person.einsaetze[0].taetigkeit);
        seite.drawRectangle({ x: x0, y: yOben - KOPF_H, width: AUSWEIS.b, height: KOPF_H, color: rgb(...hexZuRgb(farbeHex)) });
        const kopfHex = waehleTextFarbe(farbeHex);
        const kopfText = rgb(...hexZuRgb(kopfHex));

        const tn = passeAn(fett, turnier.bezeichnung || '', 15, 8, innen);
        seite.drawText(tn.text, { x: x0 + RAND, y: yOben - 28, size: tn.groesse, font: fett, color: kopfText });
        const dt = passeAn(normal, [datum, turnier.ort].filter(Boolean).join(' · '), 10, 7, innen);
        seite.drawText(dt.text, { x: x0 + RAND, y: yOben - 46, size: dt.groesse, font: normal, color: kopfText });

        const name = passeAn(fett, person.name, 24, 11, innen);
        seite.drawText(name.text, { x: x0 + RAND, y: yOben - KOPF_H - 34, size: name.groesse, font: fett, color: rgb(0.05, 0.05, 0.05) });

        // Einsatzliste zwischen Name und QR-Code
        const listeOben = yOben - KOPF_H - 56;
        const listeUnten = y0 + RAND + QR_GROESSE + 10;
        const verfuegbar = listeOben - listeUnten;
        const { anzeige, rest } = planeZeilen(person.einsaetze, Math.min(MAX_ZEILEN, Math.max(1, Math.floor(verfuegbar / 12))));
        const zeilen = anzeige.length + (rest ? 1 : 0);
        const hoeheZeile = Math.min(18, verfuegbar / zeilen);
        const groesse = Math.min(11, hoeheZeile * 0.72);
        const dunkel = rgb(0.1, 0.1, 0.1);
        anzeige.forEach((e, k) => {
            const zeit = einsatzZeitText(e);
            const zeitBreite = fett.widthOfTextAtSize(anzeige.some(x => x.vortag) ? 'Vortag 00:00–00:00' : '00:00–00:00', groesse) + 8;
            const y = listeOben - k * hoeheZeile - groesse;
            seite.drawText(zeit, { x: x0 + RAND, y, size: groesse, font: fett, color: dunkel });
            const t = passeAn(normal, e.taetigkeit, groesse, 6, innen - zeitBreite);
            seite.drawText(t.text, { x: x0 + RAND + zeitBreite, y, size: t.groesse, font: normal, color: dunkel });
        });
        if (rest) {
            seite.drawText(`… und ${rest} weitere`, {
                x: x0 + RAND, y: listeOben - anzeige.length * hoeheZeile - groesse,
                size: groesse, font: normal, color: rgb(0.35, 0.35, 0.35)
            });
        }

        zeichneQr(seite, `hajime-helfer:${turnierId}:${person.kennung}`, x0 + (AUSWEIS.b - QR_GROESSE) / 2, y0 + RAND, QR_GROESSE);
    });
    return pdf.save();
}
