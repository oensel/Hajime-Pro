// IBAN-Hilfen (framework-frei, läuft am Server und im Browser).

// Mindestlängen je Land; unbekannte Länder: 15 bis 34 Zeichen.
const LAENDER_LAENGE = { DE: 22, AT: 20, CH: 21, NL: 18, BE: 16, FR: 27, LU: 20, IT: 27, ES: 24, PL: 28, DK: 18, LI: 21 };

export function normalisiereIban(text) {
    return String(text ?? '').replace(/[\s\-.]/g, '').toUpperCase();
}

function modulo97(iban) {
    const umgestellt = iban.slice(4) + iban.slice(0, 4);
    let rest = 0;
    for (const zeichen of umgestellt) {
        const wert = /[A-Z]/.test(zeichen) ? String(zeichen.charCodeAt(0) - 55) : zeichen;
        for (const ziffer of wert) rest = (rest * 10 + Number(ziffer)) % 97;
    }
    return rest;
}

export function pruefeIban(text) {
    const iban = normalisiereIban(text);
    if (!iban) return { ok: false, iban: null, fehler: 'Bitte eine IBAN angeben.' };
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { ok: false, iban: null, fehler: 'Die IBAN enthält ungültige Zeichen.' };
    const soll = LAENDER_LAENGE[iban.slice(0, 2)];
    const laengeOk = soll ? iban.length === soll : iban.length >= 15 && iban.length <= 34;
    if (!laengeOk) return { ok: false, iban: null, fehler: 'Die IBAN hat nicht die richtige Länge.' };
    if (modulo97(iban) !== 1) return { ok: false, iban: null, fehler: 'Die IBAN-Prüfziffer stimmt nicht.' };
    return { ok: true, iban, fehler: null };
}

export function maskiereIban(iban) {
    const n = normalisiereIban(iban);
    if (n.length < 8) return '****';
    const mitte = n.slice(4, -2);
    const gruppen = [];
    for (let i = 0; i < mitte.length; i += 4) gruppen.push('*'.repeat(Math.min(4, mitte.length - i)));
    return [n.slice(0, 4), ...gruppen, n.slice(-2)].join(' ');
}

export function formatiereIban(iban) {
    return normalisiereIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
}

// Findet IBANs mit und ohne Vierer-Leerzeichen in Freitext (global: vor Wiederverwendung nicht mit test() mischen).
export const IBAN_MUSTER = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
