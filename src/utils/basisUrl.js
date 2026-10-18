// Basis-URL für Links in Mails (Registrierung, Freischaltung). Der Host-Header eines Requests ist vom Absender
// frei wählbar; in der Cloud darf er deshalb nie in einen Mail-Link gelangen (Host-Header-Injection: ein
// Angreifer ließe sich sonst Bestätigungs-/Freischaltungs-Links auf seine Domain schicken).
//   - PUBLIC_BASE_URL (nur http/https, auf den Origin gekürzt) gilt immer, wenn sie gültig ist.
//   - Im Betriebsmodus cloud ist sie Pflicht: ohne gültigen Wert gibt es keine Basis-URL (null).
//   - Außerhalb der Cloud (Entwicklung, Tests, Hallen-Server) fällt sie auf Protokoll + Host des Requests zurück.
import betriebsmodus from '../config/betriebsmodus.cjs';

/** Normalisiert PUBLIC_BASE_URL auf den Origin (ohne Pfad, ohne Slash am Ende); ungültig → null. */
export function normalisiereBasisUrl(wert) {
    if (typeof wert !== 'string' || !wert.trim()) return null;
    let url;
    try {
        url = new URL(wert.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
}

/**
 * @returns {string|null} Basis-URL ohne Slash am Ende, oder null (Cloud ohne gültige PUBLIC_BASE_URL)
 */
export function ermittleBasisUrl(req, env = process.env) {
    const konfiguriert = normalisiereBasisUrl(env.PUBLIC_BASE_URL);
    if (konfiguriert) return konfiguriert;
    if (betriebsmodus.liesBetriebsmodus(env).istCloud) return null;
    return `${req.protocol}://${req.get('host')}`;
}

export const HINWEIS_FEHLENDE_BASIS_URL =
    'PUBLIC_BASE_URL ist nicht (gültig) gesetzt – im Betriebsmodus cloud Pflicht für Links in Registrierungs- und '
    + 'Freischaltungs-Mails (z.B. PUBLIC_BASE_URL=https://hajime.example.de).';
