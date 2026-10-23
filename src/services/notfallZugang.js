// Notfall-Zugang für Super-Admins (Passwort vergessen UND Mail nicht erreichbar): ein sehr langer Schlüssel
// (64 Zufallsbytes, ~86 Zeichen) wird mit scripts/notfall-schluessel.mjs erzeugt und einmal angezeigt (ausdrucken, wegschließen).
// In der Tabelle notfall_schluessel steht nur sein SHA-256, es gibt höchstens einen. Wer den Schlüssel auf
// notfall-zugang.html eingibt, setzt damit das Passwort eines Super-Admin-Kontos neu (kein Login ohne Passwort); das Konto
// wird dabei entsperrt und bestätigt, die Zwei-Faktor-Anmeldung zurückgesetzt, offene Reset-Links verfallen und der Schlüssel ist danach verbraucht (ein neuer wird
// mit dem Skript erzeugt). Fehler antworten immer gleich, damit weder Schlüssel noch Konto erraten werden können.
import crypto from 'crypto';
import { hashPassword } from '../utils/password.js';
import { sendeMail } from '../utils/mailer.js';
import { findeKontoPerEmail, MIN_PASSWORT_LAENGE } from './registrierung.js';
import { vergesseSperrStand } from '../utils/kontoSperre.js';
import { setzeZweiFaktorZurueck } from './zweiFaktor.js';

export const SCHLUESSEL_BYTES = 64;
const MAX_PASSWORT_LAENGE = 200;
const MAX_SCHLUESSEL_LAENGE = 512;
export const MELDUNG_UNGUELTIG = 'Schlüssel oder Konto sind ungültig.';

export function hashSchluessel(schluessel) {
    return crypto.createHash('sha256').update(String(schluessel).trim()).digest('hex');
}

/** Erzeugt einen neuen Schlüssel und ersetzt den bisherigen. @returns {Promise<string>} der Klartext (nur jetzt sichtbar) */
export async function erzeugeNotfallSchluessel(knex) {
    const schluessel = crypto.randomBytes(SCHLUESSEL_BYTES).toString('base64url');
    await knex.transaction(async (trx) => {
        await trx('notfall_schluessel').del();
        await trx('notfall_schluessel').insert({ schluessel_hash: hashSchluessel(schluessel) });
    });
    return schluessel;
}

/** @returns {Promise<{ vorhanden: boolean, erstellt: Date|null }>} */
export async function notfallSchluesselStatus(knex) {
    const zeile = await knex('notfall_schluessel').first('created_at');
    return { vorhanden: !!zeile, erstellt: zeile ? zeile.created_at : null };
}

const fehler = (status, error) => ({ ok: false, status, error });

/**
 * Setzt mit dem Notfall-Schlüssel das Passwort eines Super-Admins neu.
 * @returns {Promise<{ ok: true, email: string } | { ok: false, status: number, error: string }>}
 */
export async function nutzeNotfallSchluessel(knex, { schluessel, email, passwort }, { sende = sendeMail } = {}) {
    if (typeof passwort !== 'string' || passwort.length < MIN_PASSWORT_LAENGE) {
        return fehler(400, `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.`);
    }
    if (passwort.length > MAX_PASSWORT_LAENGE) return fehler(400, 'Das Passwort ist zu lang.');
    if (typeof schluessel !== 'string' || !schluessel.trim() || schluessel.length > MAX_SCHLUESSEL_LAENGE || typeof email !== 'string') {
        return fehler(403, MELDUNG_UNGUELTIG);
    }
    // Nur Super-Admin-Konten sind zulässig; passt das Konto nicht, bleibt der Schlüssel unverbraucht.
    const konto = await findeKontoPerEmail(knex, email);
    if (!konto || !konto.ist_super_admin) return fehler(403, MELDUNG_UNGUELTIG);

    const verbraucht = await knex.transaction(async (trx) => {
        // Der Schlüssel wird atomar verbraucht: wer ihn löscht, darf ihn benutzen.
        const geloescht = await trx('notfall_schluessel').where({ schluessel_hash: hashSchluessel(schluessel) }).del();
        if (geloescht === 0) return false;
        await trx('benutzer').where({ id: konto.id }).update({
            password_hash: hashPassword(passwort),
            muss_passwort_aendern: false,
            gesperrt: false,
            gesperrt_am: null,
            email_bestaetigt_am: trx.raw('COALESCE(email_bestaetigt_am, now())'),
            updated_at: trx.fn.now()
        });
        await trx('token_einmal').where({ benutzer_id: konto.id, zweck: 'passwort' }).del();
        return true;
    });
    if (!verbraucht) return fehler(403, MELDUNG_UNGUELTIG);

    // Ohne Telefon und Backup-Codes wäre der Zugang sonst weiter gesperrt: beim nächsten Login wird die 2FA neu eingerichtet.
    await setzeZweiFaktorZurueck(knex, konto.id);
    vergesseSperrStand(konto.id);
    console.warn(`[Notfall-Zugang] Der Notfall-Schlüssel wurde für ${konto.email} benutzt und ist verbraucht.`);
    try {
        await sende({
            to: konto.email,
            subject: 'Hajime Pro: Notfall-Schlüssel wurde benutzt',
            text: `Hallo ${konto.vorname},

mit dem Notfall-Schlüssel wurde das Passwort Ihres Super-Admin-Kontos neu gesetzt. Der Schlüssel ist damit verbraucht; erzeugen Sie bei Bedarf einen neuen (node scripts/notfall-schluessel.mjs erzeugen).

Waren Sie das nicht, ändern Sie sofort das Passwort und erzeugen Sie einen neuen Schlüssel.`
        });
    } catch (err) {
        console.error('[Notfall-Zugang] Benachrichtigung fehlgeschlagen:', err.message);
    }
    return { ok: true, email: konto.email };
}
