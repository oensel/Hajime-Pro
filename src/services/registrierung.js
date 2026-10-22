// Registrierung mit E-Mail-Bestätigung (Helferverwaltung, Spec Abschnitt 4):
//   1. registriere: Konto mit email_bestaetigt_am = null, Mail mit einmaligem Link <basisUrl>/bestaetigen.html?token=…
//      (der gewünschte Verein und die Quelle hängen am Token, eine Mitgliedschaft gibt es noch nicht).
//   2. bestaetige: setzt email_bestaetigt_am, legt erst jetzt die Mitgliedschaft (freigegeben = 0) an und schickt
//      den Entscheidern (Vereins-Admins, sonst Super-Admins) einen Freischaltungs-Link <basisUrl>/freigabe.html?token=….
//   Ohne Verein (Altfluss) endet die Bestätigung beim bestätigten Konto; der Beitritt läuft danach über
//   verein_auswahl.html bzw. /api/vereine/join.
// E-Mail-Adressen werden getrimmt und kleingeschrieben gespeichert und ohne Beachtung der Schreibweise gesucht
// (Bestandskonten können noch Großbuchstaben enthalten).
import crypto from 'crypto';
import { hashPassword } from '../utils/password.js';
import { sendeMail } from '../utils/mailer.js';
import { erzeugeToken, verbrauchePruefe, entwerteTokens } from './einmalToken.js';
import { benachrichtigeUeberBeitrittsanfrage } from '../controllers/vereinController.js';

export const MIN_PASSWORT_LAENGE = 8;
// Längste zulässige E-Mail-Adresse (RFC 5321); längere lehnen Registrierung, Login und Profil mit 400 ab.
export const MAX_EMAIL_LAENGE = 254;
export const MELDUNG_EMAIL_ZU_LANG = `Die E-Mail-Adresse ist zu lang (höchstens ${MAX_EMAIL_LAENGE} Zeichen).`;
const QUELLEN = new Set(['helfer-app', 'verwaltung']);

export function normalisiereEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Konto zu einer E-Mail-Adresse, unabhängig von der Schreibweise. */
export async function findeKontoPerEmail(knex, email) {
    const norm = normalisiereEmail(email);
    if (!norm || norm.length > MAX_EMAIL_LAENGE) return null;
    const exakt = await knex('benutzer').where({ email: norm }).first();
    if (exakt) return exakt;
    return (await knex('benutzer').whereRaw('lower(trim(email)) = ?', [norm]).orderBy('created_at').first()) || null;
}

const antwort = (status, body) => ({ status, body: { success: status < 400, ...body } });

function bestaetigungsLink(basisUrl, token) {
    return `${String(basisUrl || '').replace(/\/+$/, '')}/bestaetigen.html?token=${encodeURIComponent(token)}`;
}

async function sendeBestaetigungsMail(sende, konto, basisUrl, token) {
    try {
        await sende({
            to: konto.email,
            subject: 'Hajime Pro: Bitte bestätigen Sie Ihre E-Mail-Adresse',
            text: `Hallo ${konto.vorname},

bitte bestätigen Sie Ihre E-Mail-Adresse für Hajime Pro über diesen Link (48 Stunden gültig, nur einmal verwendbar):
${bestaetigungsLink(basisUrl, token)}

Falls Sie sich nicht registriert haben, können Sie diese Mail ignorieren.`
        });
    } catch (err) {
        // Die Registrierung scheitert nie am Mailversand (Spec 4); die Mail lässt sich neu anfordern.
        console.error('[Registrierung] Bestätigungsmail fehlgeschlagen:', err.message);
    }
}

/**
 * Registriert ein Konto (unbestätigt) und verschickt die Bestätigungsmail.
 * Ein noch unbestätigtes Konto mit derselben Adresse bleibt unverändert (kein Überschreiben von Passwort, Name
 * oder Verein durch Dritte); es bekommt nur einen neuen Bestätigungslink wie bei sendeBestaetigungNeu. Die Antwort
 * ist dann dieselbe wie bei einer neuen Adresse (201), nur eine bestätigte Adresse verrät sich (409).
 * @param {{ email, password, vorname, nachname, vereinId?, quelle?: 'helfer-app'|'verwaltung', basisUrl: string }} daten
 * @param {{ sende?: Function }} [optionen]
 * @returns {Promise<{ status: 201|400|409, body: object }>}
 */
export async function registriere(knex, { email, password, vorname, nachname, vereinId, quelle, basisUrl }, { sende = sendeMail } = {}) {
    const norm = normalisiereEmail(email);
    const vor = typeof vorname === 'string' ? vorname.trim() : '';
    const nach = typeof nachname === 'string' ? nachname.trim() : '';
    if (!norm || !password || !vor || !nach) {
        return antwort(400, { error: 'E-Mail, Passwort, Vorname und Nachname sind erforderlich.' });
    }
    if (norm.length > MAX_EMAIL_LAENGE) return antwort(400, { error: MELDUNG_EMAIL_ZU_LANG });
    if (typeof password !== 'string' || password.length < MIN_PASSWORT_LAENGE) {
        return antwort(400, { error: `Das Passwort muss mindestens ${MIN_PASSWORT_LAENGE} Zeichen lang sein.` });
    }
    const herkunft = quelle == null || quelle === '' ? 'verwaltung' : quelle;
    if (!QUELLEN.has(herkunft)) {
        return antwort(400, { error: 'Ungültige Quelle der Registrierung.' });
    }

    let verein = null;
    if (vereinId != null && vereinId !== '') {
        const vid = Number(vereinId);
        if (Number.isInteger(vid) && vid > 0) {
            verein = await knex('vereine').where({ id: vid }).first();
        }
        if (!verein) return antwort(400, { error: 'Der gewählte Verein existiert nicht.' });
    }

    const vorhanden = await findeKontoPerEmail(knex, norm);
    if (vorhanden && vorhanden.email_bestaetigt_am) {
        return antwort(409, { error: 'Diese E-Mail-Adresse ist bereits registriert.' });
    }

    if (vorhanden) {
        await sendeNeuenBestaetigungslink(knex, vorhanden, basisUrl, sende);
    } else {
        const id = crypto.randomUUID();
        await knex('benutzer').insert({
            id,
            email: norm,
            vorname: vor,
            nachname: nach,
            password_hash: hashPassword(password),
            email_bestaetigt_am: null,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
        });
        const token = await erzeugeToken(knex, {
            benutzerId: id, zweck: 'email', vereinId: verein ? verein.id : null, angefragtUeber: herkunft
        });
        await sendeBestaetigungsMail(sende, { id, email: norm, vorname: vor }, basisUrl, token);
    }

    return antwort(201, {
        bestaetigungAusstehend: true,
        message: 'Wir haben Ihnen eine E-Mail geschickt. Bitte bestätigen Sie Ihre Adresse über den Link darin.'
    });
}

/**
 * Bestätigt die E-Mail-Adresse per Token. Mit gewünschtem Verein entsteht jetzt die Beitrittsanfrage
 * (freigegeben = 0) und die Entscheider bekommen eine Mail mit Freischaltungs-Link.
 * @returns {Promise<{ ok: true, vereinId?: number } | { ok: false, status: number, error: string }>}
 */
export async function bestaetige(knex, token, basisUrl, { sende = sendeMail } = {}) {
    const eintrag = await verbrauchePruefe(knex, token, 'email');
    if (!eintrag) {
        return { ok: false, status: 400, error: 'Der Bestätigungslink ist ungültig, abgelaufen oder wurde bereits verwendet.' };
    }
    return schliesseBestaetigungAb(knex, {
        benutzerId: eintrag.benutzer_id, vereinId: eintrag.verein_id, angefragtUeber: eintrag.angefragt_ueber
    }, basisUrl, sende);
}

/**
 * Gemeinsamer Abschluss der Bestätigung (Link der Mail oder manuell durch einen Super-Admin): E-Mail als bestätigt
 * markieren, offene Bestätigungslinks entwerten und, wenn bei der Registrierung ein Verein gewünscht war, die
 * Beitrittsanfrage anlegen und die Entscheider benachrichtigen.
 */
export async function schliesseBestaetigungAb(knex, { benutzerId, vereinId, angefragtUeber }, basisUrl, sende = sendeMail) {
    await knex('benutzer').where({ id: benutzerId }).whereNull('email_bestaetigt_am')
        .update({ email_bestaetigt_am: knex.fn.now(), updated_at: knex.fn.now() });
    // Weitere offene Bestätigungslinks haben sich erledigt.
    await entwerteTokens(knex, benutzerId, 'email');

    if (!vereinId) return { ok: true };

    const verein = await knex('vereine').where({ id: vereinId }).first();
    if (!verein) return { ok: true };

    const bestehend = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
    if (!bestehend) {
        await knex('benutzer_vereine').insert({
            benutzer_id: benutzerId,
            verein_id: vereinId,
            freigegeben: 0,
            angefragt_ueber: angefragtUeber || 'verwaltung'
        });
        await knex('benutzer').where({ id: benutzerId }).whereNull('aktiver_verein_id')
            .update({ aktiver_verein_id: vereinId, updated_at: knex.fn.now() });

        try {
            // Ohne sichere Basis-URL (Cloud ohne PUBLIC_BASE_URL) kein Link; die Anfrage bleibt in der Liste offener Anfragen.
            let freischaltLink;
            if (basisUrl) {
                const freiToken = await erzeugeToken(knex, { benutzerId, zweck: 'freischaltung', vereinId });
                freischaltLink = `${String(basisUrl).replace(/\/+$/, '')}/freigabe.html?token=${encodeURIComponent(freiToken)}`;
            }
            const antragsteller = await knex('benutzer').where({ id: benutzerId }).first();
            await benachrichtigeUeberBeitrittsanfrage(knex, antragsteller, vereinId, verein.name, sende, { freischaltLink });
        } catch (err) {
            // Ohne Mail bleibt die Anfrage in der Liste offener Anfragen (Spec 4).
            console.error('[Registrierung] Benachrichtigung über Beitrittsanfrage fehlgeschlagen:', err.message);
        }
    }
    return { ok: true, vereinId };
}

/**
 * Schickt einem noch unbestätigten Konto einen neuen Bestätigungslink (ältere verfallen). Verrät nie, ob die
 * Adresse existiert: liefert immer { ok: true }.
 */
export async function sendeBestaetigungNeu(knex, email, basisUrl, { sende = sendeMail } = {}) {
    const konto = await findeKontoPerEmail(knex, email);
    if (!konto || konto.email_bestaetigt_am) return { ok: true };
    await sendeNeuenBestaetigungslink(knex, konto, basisUrl, sende);
    return { ok: true };
}

// Mindestabstand zwischen zwei Bestätigungsmails an dasselbe Konto (gegen Mail-Bombing über Registrierung bzw.
// "erneut senden"); die Antwort an den Aufrufer bleibt dieselbe.
const MINDESTABSTAND_BESTAETIGUNGSMAIL_SEKUNDEN = 120;

/**
 * Super-Admin: Bestätigungsmail an ein unbestätigtes Konto (auch kurz nach der letzten, ohne Mindestabstand).
 * @returns {Promise<boolean>} false, wenn das Konto schon bestätigt ist
 */
export async function sendeBestaetigungAnKonto(knex, konto, basisUrl, { sende = sendeMail } = {}) {
    if (konto.email_bestaetigt_am) return false;
    await sendeNeuenBestaetigungslink(knex, konto, basisUrl, sende, { abstandPruefen: false });
    return true;
}

/**
 * Super-Admin: bestätigt ein Konto von Hand (statt über den Link der Mail). Ein bei der Registrierung gewünschter
 * Verein (steht am letzten Bestätigungs-Token) führt wie sonst zur Beitrittsanfrage.
 */
export async function bestaetigeKontoManuell(knex, benutzerId, basisUrl, { sende = sendeMail } = {}) {
    const letzter = await knex('token_einmal')
        .where({ benutzer_id: benutzerId, zweck: 'email' })
        .orderBy('id', 'desc')
        .first('verein_id', 'angefragt_ueber');
    return schliesseBestaetigungAb(knex, {
        benutzerId, vereinId: letzter ? letzter.verein_id : null, angefragtUeber: letzter ? letzter.angefragt_ueber : null
    }, basisUrl, sende);
}

// Neuer Bestätigungslink für ein unbestätigtes Konto; ältere verfallen, Verein und Quelle stammen vom letzten Token.
// Ist der letzte Token jünger als der Mindestabstand, geschieht nichts (der bisherige Link bleibt gültig).
async function sendeNeuenBestaetigungslink(knex, konto, basisUrl, sende, { abstandPruefen = true } = {}) {
    // Verein und Quelle der Registrierung stehen am letzten Bestätigungs-Token (auch wenn er abgelaufen ist).
    const letzter = await knex('token_einmal')
        .where({ benutzer_id: konto.id, zweck: 'email' })
        .orderBy('id', 'desc')
        .first(['*', knex.raw("created_at > now() - (? * interval '1 second') as zu_frisch", [MINDESTABSTAND_BESTAETIGUNGSMAIL_SEKUNDEN])]);
    if (abstandPruefen && letzter && letzter.zu_frisch) return;
    await entwerteTokens(knex, konto.id, 'email');
    const token = await erzeugeToken(knex, {
        benutzerId: konto.id,
        zweck: 'email',
        vereinId: letzter ? letzter.verein_id : null,
        angefragtUeber: letzter ? letzter.angefragt_ueber : null
    });
    await sendeBestaetigungsMail(sende, konto, basisUrl, token);
}
