// Bilder der Urkunden-Vorlagen (Spalte urkunden_vorlagen.bilder): { <bild_id>: { typ, daten } },
// daten = Base64. Nur PNG und JPEG — die Formate, die pdf-lib einbetten kann.
import crypto from 'node:crypto';

export const MAX_BILD_BYTES = 2 * 1024 * 1024;
export const MAX_BILDER = 10;

const PNG_SIGNATUR = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function erkenneBildTyp(bytes) {
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATUR)) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    return null;
}

export function leseBilder(json) {
    try {
        const bilder = typeof json === 'string' ? JSON.parse(json || '{}') : json;
        return bilder && typeof bilder === 'object' && !Array.isArray(bilder) ? bilder : {};
    } catch { return {}; }
}

export const neueBildId = () => `b${crypto.randomBytes(6).toString('hex')}`;

// Behält nur Bilder, auf die ein Feld verweist.
export function bereinigeBilder(bilder, felder) {
    const benutzt = new Set(felder.filter(f => f?.typ === 'bild').map(f => f.bild_id));
    return Object.fromEntries(Object.entries(bilder).filter(([id]) => benutzt.has(id)));
}

// Prüft einen Bilder-Eintrag (auch aus einer Exportdatei); liefert eine Fehlermeldung oder null.
export function pruefeBild(bild) {
    if (!bild || typeof bild.daten !== 'string') return 'Ungültiges Bild.';
    const bytes = Buffer.from(bild.daten, 'base64');
    if (bytes.length === 0) return 'Bilddatei fehlt.';
    if (bytes.length > MAX_BILD_BYTES) return 'Ein Bild darf höchstens 2 MB groß sein.';
    const typ = erkenneBildTyp(bytes);
    if (!typ || typ !== bild.typ) return 'Nur PNG- und JPEG-Bilder werden unterstützt.';
    return null;
}
