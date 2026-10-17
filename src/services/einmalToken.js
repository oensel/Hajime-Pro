// Einmal-Token für Links in Mails (Helferverwaltung, Spec Abschnitt 4): E-Mail-Bestätigung ('email') und
// Freischaltung einer Beitrittsanfrage ('freischaltung'). In der Tabelle token_einmal steht nur der
// SHA-256 des Tokens; der Klartext existiert nur im Link der Mail.
import crypto from 'crypto';

const ZWECKE = new Set(['email', 'freischaltung']);

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function istTokenText(token) {
    return typeof token === 'string' && token.length > 0;
}

/**
 * Erzeugt einen Token und speichert seinen Hash.
 * @param {{ benutzerId: string, zweck: 'email'|'freischaltung', vereinId?: number|null, gueltigStunden?: number, angefragtUeber?: string|null }} p
 * @returns {Promise<string>} der Klartext-Token (URL-sicher)
 */
export async function erzeugeToken(knex, { benutzerId, zweck, vereinId = null, gueltigStunden = 48, angefragtUeber = null }) {
    if (!ZWECKE.has(zweck)) throw new Error(`Unbekannter Token-Zweck: ${zweck}`);
    if (!benutzerId) throw new Error('benutzerId fehlt.');
    const stunden = Number(gueltigStunden);
    if (!Number.isFinite(stunden) || stunden <= 0) throw new Error('Ungültige Gültigkeitsdauer.');

    const token = crypto.randomBytes(32).toString('base64url');
    await knex('token_einmal').insert({
        benutzer_id: benutzerId,
        zweck,
        verein_id: vereinId ?? null,
        angefragt_ueber: angefragtUeber ?? null,
        token_hash: hashToken(token),
        // Ablauf in der Datenbankzeit, damit Prüfung (now()) und Ablauf dieselbe Uhr nutzen.
        laeuft_ab_am: knex.raw("now() + (? * interval '1 hour')", [stunden])
    });
    return token;
}

const SPALTEN = ['id', 'benutzer_id', 'verein_id', 'angefragt_ueber'];

function gueltig(query, token, zweck) {
    return query
        .where({ token_hash: hashToken(token), zweck })
        .whereNull('benutzt_am')
        .whereRaw('laeuft_ab_am > now()');
}

/**
 * Prüft einen Token, ohne ihn zu verbrauchen (z.B. Anzeige der Freischaltungs-Seite).
 * @returns {Promise<null | { id: number, benutzer_id: string, verein_id: number|null, angefragt_ueber: string|null }>}
 */
export async function pruefeToken(knex, token, zweck) {
    if (!istTokenText(token) || !ZWECKE.has(zweck)) return null;
    const zeile = await gueltig(knex('token_einmal'), token, zweck).first(SPALTEN);
    return zeile || null;
}

/**
 * Prüft und verbraucht einen Token atomar: benutzt_am wird nur gesetzt, wenn es noch leer ist; bei
 * gleichzeitigen Aufrufen gewinnt genau einer, jeder weitere liefert null.
 * @returns {Promise<null | { id: number, benutzer_id: string, verein_id: number|null, angefragt_ueber: string|null }>}
 */
export async function verbrauchePruefe(knex, token, zweck) {
    if (!istTokenText(token) || !ZWECKE.has(zweck)) return null;
    const zeilen = await gueltig(knex('token_einmal'), token, zweck)
        .update({ benutzt_am: knex.fn.now() })
        .returning(SPALTEN);
    return zeilen[0] || null;
}

/**
 * Gab es diesen Token je (auch verbraucht oder abgelaufen)? Unterscheidet „ungültiger Link“ (404) von
 * „bereits entschieden oder abgelaufen“ (410).
 * @returns {Promise<boolean>}
 */
export async function tokenBekannt(knex, token, zweck) {
    if (!istTokenText(token) || !ZWECKE.has(zweck)) return false;
    return !!(await knex('token_einmal').where({ token_hash: hashToken(token), zweck }).first('id'));
}

/**
 * Macht alle noch offenen Tokens eines Kontos für einen Zweck ungültig (z.B. ältere Bestätigungslinks).
 * @returns {Promise<number>} Anzahl entwerteter Tokens
 */
export async function entwerteTokens(knex, benutzerId, zweck) {
    return knex('token_einmal')
        .where({ benutzer_id: benutzerId, zweck })
        .whereNull('benutzt_am')
        .update({ benutzt_am: knex.fn.now() });
}
