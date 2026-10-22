// Passwort zurücksetzen per Mail („Passwort vergessen“ auf der Anmeldeseite, „Reset-Mail senden“ für Super-Admins):
// ein Einmal-Link (Zweck 'passwort', 2 Stunden gültig, nur SHA-256 gespeichert) führt auf passwort-zuruecksetzen.html,
// dort wird das neue Passwort gesetzt. Der Link beweist den Besitz der Adresse: ein noch unbestätigtes Konto gilt danach
// als bestätigt. Gesperrte Konten bekommen keinen Link. Die Antwort an Anfragende verrät nie, ob eine Adresse existiert.
import { hashPassword } from '../utils/password.js';
import { sendeMail } from '../utils/mailer.js';
import { erzeugeToken, verbrauchePruefe, entwerteTokens } from './einmalToken.js';
import { findeKontoPerEmail, MIN_PASSWORT_LAENGE } from './registrierung.js';

export const RESET_GUELTIG_STUNDEN = 2;
// Mindestabstand zwischen zwei Reset-Mails an dasselbe Konto (gegen Mail-Bombing über „Passwort vergessen“)
const MINDESTABSTAND_SEKUNDEN = 120;
const MAX_PASSWORT_LAENGE = 200;

export function resetLink(basisUrl, token) {
    return `${String(basisUrl || '').replace(/\/+$/, '')}/passwort-zuruecksetzen.html?token=${encodeURIComponent(token)}`;
}

async function sendeResetMail(sende, konto, basisUrl, token, durchAdmin) {
    const anlass = durchAdmin
        ? 'Ein Administrator hat für Ihr Konto das Zurücksetzen des Passworts angestoßen.'
        : 'Für Ihr Konto wurde das Zurücksetzen des Passworts angefordert.';
    await sende({
        to: konto.email,
        subject: 'Hajime Pro: Passwort zurücksetzen',
        text: `Hallo ${konto.vorname},

${anlass} Über diesen Link können Sie ein neues Passwort festlegen (${RESET_GUELTIG_STUNDEN} Stunden gültig, nur einmal verwendbar):
${resetLink(basisUrl, token)}

Falls Sie das nicht angefordert haben, können Sie diese Mail ignorieren; Ihr Passwort bleibt dann unverändert.`
    });
}

/**
 * „Passwort vergessen“: schickt dem Konto zur Adresse einen Link. Liefert immer { ok: true } (nichts verrät, ob die
 * Adresse existiert); unbekannte, gesperrte und zu frisch bediente Konten bekommen keine Mail.
 */
export async function fordereZuruecksetzungAn(knex, email, basisUrl, { sende = sendeMail } = {}) {
    const konto = await findeKontoPerEmail(knex, email);
    if (!konto || konto.gesperrt) return { ok: true };
    await sendeResetLink(knex, konto, basisUrl, { sende, abstandPruefen: true, durchAdmin: false });
    return { ok: true };
}

/**
 * Link an ein bekanntes Konto schicken (Super-Admin: ohne Mindestabstand). Ältere offene Links verfallen.
 * @returns {Promise<boolean>} false, wenn wegen des Mindestabstands nichts gesendet wurde
 */
export async function sendeResetLink(knex, konto, basisUrl, { sende = sendeMail, abstandPruefen = true, durchAdmin = false } = {}) {
    if (abstandPruefen) {
        const letzter = await knex('token_einmal')
            .where({ benutzer_id: konto.id, zweck: 'passwort' })
            .orderBy('id', 'desc')
            .first([knex.raw("created_at > now() - (? * interval '1 second') as zu_frisch", [MINDESTABSTAND_SEKUNDEN])]);
        if (letzter && letzter.zu_frisch) return false;
    }
    await entwerteTokens(knex, konto.id, 'passwort');
    const token = await erzeugeToken(knex, { benutzerId: konto.id, zweck: 'passwort', gueltigStunden: RESET_GUELTIG_STUNDEN });
    try {
        await sendeResetMail(sende, konto, basisUrl, token, durchAdmin);
    } catch (err) {
        // „Passwort vergessen“ scheitert nie sichtbar am Mailversand; die Anfrage lässt sich wiederholen.
        console.error('[Passwort-Reset] Mail fehlgeschlagen:', err.message);
        if (durchAdmin) throw err;
    }
    return true;
}

/** Setzt mit dem Link das neue Passwort und verbraucht ihn atomar (bei gesperrtem Konto bleibt alles unverändert). */
export async function setzePasswortZurueck(knex, token, passwort) {
    if (typeof passwort !== 'string' || passwort.length < MIN_PASSWORT_LAENGE) {
        return { ok: false, status: 400, error: `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.` };
    }
    if (passwort.length > MAX_PASSWORT_LAENGE) return { ok: false, status: 400, error: 'Das Passwort ist zu lang.' };
    // Gesperrte Konten dürfen kein neues Passwort setzen (der Link ist dann wertlos).
    return knex.transaction(async (trx) => {
        const eintrag = await verbrauchePruefe(trx, token, 'passwort');
        if (!eintrag) {
            return { ok: false, status: 400, error: 'Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.' };
        }
        const konto = await trx('benutzer').where({ id: eintrag.benutzer_id }).first('id', 'gesperrt', 'email_bestaetigt_am');
        if (!konto || konto.gesperrt) {
            return { ok: false, status: 400, error: 'Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.' };
        }
        await trx('benutzer').where({ id: konto.id }).update({
            password_hash: hashPassword(passwort),
            muss_passwort_aendern: false,
            ...(konto.email_bestaetigt_am ? {} : { email_bestaetigt_am: trx.fn.now() }),
            updated_at: trx.fn.now()
        });
        await entwerteTokens(trx, konto.id, 'passwort');
        return { ok: true };
    });
}
