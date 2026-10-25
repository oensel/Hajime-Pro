// Bestätigung sensibler Aktionen eines Super-Admins im Super-Admin-Modus: der aktuelle 2FA-Code (Header X-2FA-Code) oder,
// wo es der Aufrufer erlaubt, eine frische Zwei-Faktor-Anmeldung (Claim zf im Sitzungs-Token, höchstens 10 Minuten alt).
// Letzteres braucht der Direktweg vom Hallen-Server: dort verbraucht schon die Cloud-Anmeldung den TOTP-Code, ein zweites
// Mal ließe er sich nicht prüfen. Alle anderen Konten (Admins, Benutzer) und Betrieb ohne 2FA-Pflicht: immer ok.
import { ladeBenutzerMitAktivemVerein } from './vereinHelper.js';
import { pruefeCodeFuerAktion, zweiFaktorPflicht } from '../services/zweiFaktor.js';

export const FRISCHE_ANMELDUNG_SEKUNDEN = 600;
// Kleine Uhrabweichung zwischen Instanzen tolerieren, ein zf weit in der Zukunft gilt nicht.
const ZUKUNFT_TOLERANZ_SEKUNDEN = 60;

function istFrisch(zf) {
    if (typeof zf !== 'number' || !Number.isFinite(zf)) return false;
    const alter = Date.now() / 1000 - zf;
    return alter <= FRISCHE_ANMELDUNG_SEKUNDEN && alter >= -ZUKUNFT_TOLERANZ_SEKUNDEN;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, status: 403, code: 'zwei_faktor', error: string }>}
 */
export async function pruefeSensibleAktion(knex, req, { frischeAnmeldungGenuegt = false } = {}) {
    if (!zweiFaktorPflicht()) return { ok: true };
    const benutzer = req.user && req.user.id ? await ladeBenutzerMitAktivemVerein(knex, req.user.id) : null;
    if (!benutzer || !benutzer.super_admin_aktiv) return { ok: true };
    if (frischeAnmeldungGenuegt && istFrisch(req.user.zf)) return { ok: true };
    const code = typeof req.get === 'function' ? req.get('x-2fa-code') : undefined;
    const ergebnis = await pruefeCodeFuerAktion(knex, req.user.id, code);
    if (ergebnis.ok) return { ok: true };
    // Immer 403 (nie 401: menu.js leitet bei 401 zur Anmeldung), damit die Oberfläche den Code abfragen kann.
    return { ok: false, status: 403, code: 'zwei_faktor', error: ergebnis.error || 'Bitte den aktuellen Code der Authenticator-App angeben.' };
}
