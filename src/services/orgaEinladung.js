// Orga-Planer: Einladungen für Externe (Spec 2026-10-18-orga-planer-design, "Zuweisen, Mail, Einladung").
// Ein Link in der Mail führt auf einladung.html; dort legt die eingeladene Person ein Passwort fest (neues Konto)
// bzw. bestätigt mit dem Passwort ihres bestehenden Kontos. Eingeladene bekommen nur die Rolle 'helfer', das Konto
// gilt als bestätigt (der Link kam per Mail) und ist im einladenden Verein sofort freigegeben.
// In orga_einladungen steht nur der SHA-256 des Tokens; der Klartext existiert nur im Link der Mail.
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { findeKontoPerEmail, normalisiereEmail, MIN_PASSWORT_LAENGE } from './registrierung.js';

export const EINLADUNG_GUELTIG_TAGE = 14;
const MELDUNG_UNGUELTIG = 'Der Einladungslink ist ungültig, abgelaufen oder wurde bereits verwendet.';

export function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Legt eine neue Einladung an und entwertet ältere offene für (E-Mail, Verein). Liefert den Klartext-Token. */
export async function erzeugeEinladung(knex, { email, name = null, vereinId }) {
    const norm = normalisiereEmail(email);
    const token = crypto.randomBytes(32).toString('base64url');
    await knex.transaction(async (trx) => {
        await trx('orga_einladungen')
            .where({ email: norm, verein_id: vereinId })
            .whereNull('benutzt_am')
            .whereRaw('laeuft_ab_am > now()')
            .update({ laeuft_ab_am: trx.fn.now() });
        await trx('orga_einladungen').insert({
            token_hash: hashToken(token),
            email: norm,
            name: name || null,
            verein_id: vereinId,
            // Ablauf in der Datenbankzeit, damit Prüfung (now()) und Ablauf dieselbe Uhr nutzen.
            laeuft_ab_am: trx.raw("now() + (? * interval '1 day')", [EINLADUNG_GUELTIG_TAGE])
        });
    });
    return token;
}

function gueltig(query, token) {
    return query
        .where({ token_hash: hashToken(token) })
        .whereNull('benutzt_am')
        .whereRaw('laeuft_ab_am > now()');
}

const istTokenText = (t) => typeof t === 'string' && t.length > 0;

/**
 * Prüft eine Einladung, ohne sie zu verbrauchen (Anzeige von einladung.html).
 * @returns {Promise<null | { email: string, name: string|null, vereinName: string, kontoVorhanden: boolean }>}
 */
export async function pruefeEinladung(knex, token) {
    if (!istTokenText(token)) return null;
    const e = await gueltig(knex('orga_einladungen'), token).first();
    if (!e) return null;
    const verein = await knex('vereine').where({ id: e.verein_id }).first('name');
    const konto = await findeKontoPerEmail(knex, e.email);
    return { email: e.email, name: e.name, vereinName: verein ? verein.name : '', kontoVorhanden: !!konto };
}

class Abbruch extends Error {
    constructor(status, error) {
        super(error);
        this.status = status;
    }
}

/**
 * Löst eine Einladung ein: legt das Konto an (bestätigt) bzw. verlangt bei vorhandenem Konto dessen Passwort, trägt
 * die Mitgliedschaft als freigegebener 'helfer' ein und weist alle offenen Aufgaben dieser Adresse im Verein dem
 * Konto zu. Der Token wird atomar verbraucht; scheitert etwas danach, wird alles zurückgerollt.
 * @returns {Promise<{ ok: true, benutzerId: string, vereinId: number } | { ok: false, status: number, error: string }>}
 */
export async function loeseEinladungEin(knex, token, { password, vorname, nachname } = {}) {
    if (!istTokenText(token)) return { ok: false, status: 400, error: MELDUNG_UNGUELTIG };
    const vorab = await gueltig(knex('orga_einladungen'), token).first();
    if (!vorab) return { ok: false, status: 400, error: MELDUNG_UNGUELTIG };

    const vorhanden = await findeKontoPerEmail(knex, vorab.email);
    const vor = typeof vorname === 'string' ? vorname.trim() : '';
    const nach = typeof nachname === 'string' ? nachname.trim() : '';
    if (typeof password !== 'string' || !password) {
        return { ok: false, status: 400, error: 'Bitte ein Passwort angeben.' };
    }
    if (!vorhanden) {
        if (password.length < MIN_PASSWORT_LAENGE) {
            return { ok: false, status: 400, error: `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.` };
        }
        if (!vor || !nach) return { ok: false, status: 400, error: 'Vorname und Nachname sind erforderlich.' };
    }

    try {
        return await knex.transaction(async (trx) => {
            const zeilen = await gueltig(trx('orga_einladungen'), token)
                .update({ benutzt_am: trx.fn.now() })
                .returning(['id', 'email', 'verein_id']);
            const e = zeilen[0];
            if (!e) throw new Abbruch(400, MELDUNG_UNGUELTIG);

            let benutzerId;
            const konto = await findeKontoPerEmail(trx, e.email);
            if (konto) {
                // Bestehendes Konto: nur mit dessen Passwort; Name und Passwort bleiben unverändert.
                if (!verifyPassword(password, konto.password_hash)) throw new Abbruch(401, 'Das Passwort ist nicht korrekt.');
                benutzerId = konto.id;
                await trx('benutzer').where({ id: benutzerId }).whereNull('email_bestaetigt_am')
                    .update({ email_bestaetigt_am: trx.fn.now(), updated_at: trx.fn.now() });
                await trx('benutzer').where({ id: benutzerId }).whereNull('aktiver_verein_id')
                    .update({ aktiver_verein_id: e.verein_id, updated_at: trx.fn.now() });
            } else {
                benutzerId = crypto.randomUUID();
                await trx('benutzer').insert({
                    id: benutzerId,
                    email: e.email,
                    vorname: vor,
                    nachname: nach,
                    password_hash: hashPassword(password),
                    email_bestaetigt_am: trx.fn.now(),
                    aktiver_verein_id: e.verein_id,
                    created_at: trx.fn.now(),
                    updated_at: trx.fn.now()
                });
            }

            const mitgliedschaft = await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: e.verein_id }).first();
            if (!mitgliedschaft) {
                await trx('benutzer_vereine').insert({
                    benutzer_id: benutzerId, verein_id: e.verein_id, freigegeben: 1, rolle: 'helfer', angefragt_ueber: 'verwaltung'
                });
            } else if (!Number(mitgliedschaft.freigegeben)) {
                await trx('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: e.verein_id })
                    .update({ freigegeben: 1, rolle: 'helfer' });
            }

            // Offene Aufgaben dieser Adresse in Turnieren dieses Vereins gehören jetzt dem Konto (freie Felder bleiben).
            await trx('orga_aufgaben')
                .whereNull('benutzer_id')
                .whereNull('erledigt_am')
                .whereRaw('lower(trim(email_frei)) = ?', [e.email])
                .whereIn('turnier_id', trx('turniere').where({ verein_id: e.verein_id }).select('id'))
                .update({ benutzer_id: benutzerId });

            return { ok: true, benutzerId, vereinId: e.verein_id };
        });
    } catch (err) {
        if (err instanceof Abbruch) return { ok: false, status: err.status, error: err.message };
        throw err;
    }
}
