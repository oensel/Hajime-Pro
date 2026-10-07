// Dateiformat zum Austausch einzelner Urkunden-Vorlagen zwischen Vereinen/Installationen
// (Designer: "Exportieren"/"Importieren"). Dateiendung: .hajime-urkunde.json
//
// {
//   "format": "hajime-urkunden-vorlagen",
//   "version": 1,
//   "exportiert_am": "<ISO-Zeitstempel>",
//   "vorlagen": [{
//     "name", "pdf_base64", "pdf_dateiname", "seiten_breite_pt", "seiten_hoehe_pt",
//     "felder": [...],            // wie urkunden_vorlagen.felder (Text/Linie/Bild, pt, Ursprung oben links)
//     "bilder": { <bild_id>: { "typ": "image/png|image/jpeg", "daten": "<Base64>" } }
//   }]
// }
//
// Bewusst nicht enthalten: Voreinstellungen (Platzbereich, Reihenfolge, Abschluss-Angebot) — das ist
// Sache des importierenden Vereins. Beim Import wird nie überschrieben: Namenskonflikte werden mit
// " (2)", " (3)" … aufgelöst. Im Gegensatz zum Turnier-Export (urkundenVorlagenTransfer.js) ist die
// Datei für Hand-Austausch gedacht und wird daher streng geprüft, ungültige Vorlagen werden mit
// Begründung gemeldet statt still übersprungen.
import { pruefeFelder } from '../controllers/urkundenController.js';
import { leseVorlagenPdf, FehlerUngueltigesPdf } from './urkundenRenderer.js';
import { leseBilder, pruefeBild, bereinigeBilder } from './urkundenBilder.js';

export const DATEI_FORMAT = 'hajime-urkunden-vorlagen';
export const DATEI_VERSION = 1;
export const MAX_VORLAGEN_PRO_DATEI = 50;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

export class FehlerUngueltigeDatei extends Error {}

// zeilen: Zeilen aus urkunden_vorlagen
export function baueVorlagenDatei(zeilen) {
    return {
        format: DATEI_FORMAT,
        version: DATEI_VERSION,
        exportiert_am: new Date().toISOString(),
        vorlagen: zeilen.map(z => {
            const felder = JSON.parse(z.felder || '[]');
            return {
                name: z.name,
                pdf_base64: Buffer.from(z.pdf).toString('base64'),
                pdf_dateiname: z.pdf_dateiname || null,
                seiten_breite_pt: z.seiten_breite_pt,
                seiten_hoehe_pt: z.seiten_hoehe_pt,
                felder,
                bilder: bereinigeBilder(leseBilder(z.bilder), felder)
            };
        })
    };
}

async function pruefeVorlage(v) {
    if (!v || typeof v !== 'object') return 'Kein gültiger Eintrag.';
    if (typeof v.name !== 'string' || !v.name.trim()) return 'Name fehlt.';
    if (typeof v.pdf_base64 !== 'string' || !v.pdf_base64) return 'PDF fehlt.';
    const pdf = Buffer.from(v.pdf_base64, 'base64');
    if (pdf.length === 0) return 'PDF fehlt.';
    if (pdf.length > MAX_PDF_BYTES) return 'Das PDF ist größer als 10 MB.';
    let groesse;
    try {
        groesse = await leseVorlagenPdf(pdf);
    } catch (err) {
        if (err instanceof FehlerUngueltigesPdf) return err.message;
        throw err;
    }
    const bilder = leseBilder(v.bilder ?? {});
    for (const bild of Object.values(bilder)) {
        const fehler = pruefeBild(bild);
        if (fehler) return fehler;
    }
    // Maße immer aus dem PDF: eine handbearbeitete Datei kann sie nicht verfälschen.
    const fehler = pruefeFelder(v.felder ?? [], groesse.breite, groesse.hoehe, new Set(Object.keys(bilder)));
    if (fehler) return fehler;
    return { pdf, groesse, bilder };
}

// Liest eine hochgeladene Datei (bereits geparstes JSON). Wirft FehlerUngueltigeDatei, wenn es keine
// Vorlagen-Datei ist; sonst { gueltig: [...zum Anlegen], abgelehnt: [{ name, grund }] }.
export async function leseVorlagenDatei(datei) {
    if (!datei || typeof datei !== 'object' || datei.format !== DATEI_FORMAT) {
        throw new FehlerUngueltigeDatei('Das ist keine Hajime-Urkunden-Vorlagendatei.');
    }
    if (!Number.isInteger(datei.version) || datei.version < 1) throw new FehlerUngueltigeDatei('Dateiversion fehlt.');
    if (datei.version > DATEI_VERSION) {
        throw new FehlerUngueltigeDatei('Die Datei stammt aus einer neueren Hajime-Version. Bitte Hajime aktualisieren.');
    }
    if (!Array.isArray(datei.vorlagen) || datei.vorlagen.length === 0) throw new FehlerUngueltigeDatei('Die Datei enthält keine Vorlagen.');
    if (datei.vorlagen.length > MAX_VORLAGEN_PRO_DATEI) {
        throw new FehlerUngueltigeDatei(`Höchstens ${MAX_VORLAGEN_PRO_DATEI} Vorlagen pro Datei.`);
    }

    const gueltig = [];
    const abgelehnt = [];
    for (const v of datei.vorlagen) {
        const ergebnis = await pruefeVorlage(v);
        if (typeof ergebnis === 'string') {
            abgelehnt.push({ name: typeof v?.name === 'string' ? v.name : '(ohne Name)', grund: ergebnis });
            continue;
        }
        const felder = v.felder ?? [];
        gueltig.push({
            name: v.name.trim(),
            pdf: ergebnis.pdf,
            pdf_dateiname: typeof v.pdf_dateiname === 'string' ? v.pdf_dateiname.slice(0, 255) : null,
            seiten_breite_pt: ergebnis.groesse.breite,
            seiten_hoehe_pt: ergebnis.groesse.hoehe,
            felder,
            bilder: bereinigeBilder(ergebnis.bilder, felder)
        });
    }
    return { gueltig, abgelehnt };
}

// "Name", "Name (2)", "Name (3)" … – der erste Name, der nicht in vergeben steckt.
export function freierName(name, vergeben) {
    if (!vergeben.has(name)) return name;
    for (let i = 2; ; i++) {
        const kandidat = `${name} (${i})`;
        if (!vergeben.has(kandidat)) return kandidat;
    }
}

// Legt die geprüften Vorlagen beim Verein an; liefert [{ name, id }] mit den tatsächlich vergebenen Namen.
export async function legeVorlagenAn(knex, vereinId, vorlagen) {
    return knex.transaction(async trx => {
        const vergeben = new Set((await trx('urkunden_vorlagen').where({ verein_id: vereinId }).select('name')).map(z => z.name));
        const angelegt = [];
        for (const v of vorlagen) {
            const name = freierName(v.name, vergeben);
            vergeben.add(name);
            const [eingefuegt] = await trx('urkunden_vorlagen').insert({
                verein_id: vereinId,
                name,
                pdf: v.pdf,
                pdf_dateiname: v.pdf_dateiname,
                seiten_breite_pt: v.seiten_breite_pt,
                seiten_hoehe_pt: v.seiten_hoehe_pt,
                felder: JSON.stringify(v.felder),
                bilder: JSON.stringify(v.bilder)
            }).returning('id');
            angelegt.push({ name, id: typeof eingefuegt === 'object' ? eingefuegt.id : eingefuegt });
        }
        return angelegt;
    });
}
