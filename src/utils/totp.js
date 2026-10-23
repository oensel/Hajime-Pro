// TOTP nach RFC 6238 (HMAC-SHA1, 30-Sekunden-Schritte, 6 Stellen), kompatibel zu Google Authenticator, Authy, Bitwarden usw.
// Ohne zusätzliche Abhängigkeit; Geheimnisse sind Base32-Text.
import crypto from 'crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const SCHRITT_SEKUNDEN = 30;
export const STELLEN = 6;

export function base32Kodiere(buffer) {
    let bits = 0;
    let wert = 0;
    let text = '';
    for (const byte of buffer) {
        wert = (wert << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            text += BASE32[(wert >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) text += BASE32[(wert << (5 - bits)) & 31];
    return text;
}

export function base32Dekodiere(text) {
    const bereinigt = String(text).toUpperCase().replace(/[\s=-]/g, '');
    let bits = 0;
    let wert = 0;
    const bytes = [];
    for (const zeichen of bereinigt) {
        const index = BASE32.indexOf(zeichen);
        if (index === -1) throw new Error('Ungültiges Base32-Zeichen.');
        wert = (wert << 5) | index;
        bits += 5;
        if (bits >= 8) {
            bytes.push((wert >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(bytes);
}

/** Neues Geheimnis (20 Zufallsbytes, Base32). */
export function erzeugeTotpGeheimnis() {
    return base32Kodiere(crypto.randomBytes(20));
}

/** Zeitschritt zu einem Zeitpunkt (Millisekunden). */
export function schrittFuer(zeitMs = Date.now()) {
    return Math.floor(zeitMs / 1000 / SCHRITT_SEKUNDEN);
}

/** Code für einen Zeitschritt. */
export function totpCode(geheimnisBase32, schritt) {
    const zaehler = Buffer.alloc(8);
    zaehler.writeBigUInt64BE(BigInt(schritt));
    const hmac = crypto.createHmac('sha1', base32Dekodiere(geheimnisBase32)).update(zaehler).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const zahl = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(zahl % 10 ** STELLEN).padStart(STELLEN, '0');
}

/**
 * Prüft einen eingegebenen Code gegen den aktuellen und die beiden benachbarten Schritte (Uhrabweichung).
 * `letzterSchritt`: bereits benutzter Schritt; ein Code für diesen oder einen früheren Schritt gilt nicht (kein zweites Mal).
 * @returns {{ ok: boolean, schritt?: number }}
 */
export function pruefeTotpCode(geheimnisBase32, eingabe, { letzterSchritt = null, zeitMs = Date.now() } = {}) {
    const code = String(eingabe ?? '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return { ok: false };
    const aktuell = schrittFuer(zeitMs);
    let gefunden = null;
    for (const schritt of [aktuell - 1, aktuell, aktuell + 1]) {
        const soll = Buffer.from(totpCode(geheimnisBase32, schritt));
        const ist = Buffer.from(code);
        // alle drei Schritte vergleichen (gleichbleibende Laufzeit), den neuesten Treffer merken
        if (crypto.timingSafeEqual(soll, ist)) gefunden = schritt;
    }
    if (gefunden === null) return { ok: false };
    if (letzterSchritt !== null && letzterSchritt !== undefined && gefunden <= Number(letzterSchritt)) return { ok: false };
    return { ok: true, schritt: gefunden };
}

/** otpauth-Adresse für den QR-Code der Authenticator-App. */
export function otpauthUrl({ geheimnis, konto, aussteller = 'Hajime Pro' }) {
    const label = encodeURIComponent(`${aussteller}:${konto}`);
    return `otpauth://totp/${label}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}&algorithm=SHA1&digits=${STELLEN}&period=${SCHRITT_SEKUNDEN}`;
}
