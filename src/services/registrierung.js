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
const QUELLEN = new Set(['helfer-app', 'verwaltung']);

export function normalisiereEmail(email) {
    return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Konto zu einer E-Mail-Adresse, unabhängig von der Schreibweise. */
export async function findeKontoPerEmail(knex, email) {
    const norm = normalisiereEmail(email);
    if (!norm) return null;
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
 * Ein noch unbestätigtes Konto mit derselben Adresse wird übernommen (Name, Passwort, Verein der neuen Eingabe;
 * ältere Bestätigungslinks verfallen) und bekommt eine neue Mail (200). Eine bestätigte Adresse → 409.
 * @param {{ email, password, vorname, nachname, vereinId?, quelle?: 'helfer-app'|'verwaltung', basisUrl: string }} daten
 * @param {{ sende?: Function }} [optionen]
 * @returns {Promise<{ status: 201|200|400|409, body: object }>}
 */
export async function registriere(knex, { email, password, vorname, nachname, vereinId, quelle, basisUrl }, { sende = sendeMail } = {}) {
    const norm = normalisiereEmail(email);
    const vor = typeof vorname === 'string' ? vorname.trim() : '';
    const nach = typeof nachname === 'string' ? nachname.trim() : '';
    if (!norm || !password || !vor || !nach) {
        return antwort(400, { error: 'E-Mail, Passwort, Vorname und Nachname sind erforderlich.' });
    }
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

    let konto;
    let status;
    if (vorhanden) {
        await knex('benutzer').where({ id: vorhanden.id }).update({
            email: norm,
            vorname: vor,
            nachname: nach,
            password_hash: hashPassword(password),
            updated_at: knex.fn.now()
        });
        await entwerteTokens(knex, vorhanden.id, 'email');
        konto = { id: vorhanden.id, email: norm, vorname: vor };
        status = 200;
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
        konto = { id, email: norm, vorname: vor };
        status = 201;
    }

    const token = await erzeugeToken(knex, {
        benutzerId: konto.id, zweck: 'email', vereinId: verein ? verein.id : null, angefragtUeber: herkunft
    });
    await sendeBestaetigungsMail(sende, konto, basisUrl, token);

    return antwort(status, {
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
    const benutzerId = eintrag.benutzer_id;
    await knex('benutzer').where({ id: benutzerId }).whereNull('email_bestaetigt_am')
        .update({ email_bestaetigt_am: knex.fn.now(), updated_at: knex.fn.now() });
    // Weitere offene Bestätigungslinks haben sich erledigt.
    await entwerteTokens(knex, benutzerId, 'email');

    const vereinId = eintrag.verein_id;
    if (!vereinId) return { ok: true };

    const verein = await knex('vereine').where({ id: vereinId }).first();
    if (!verein) return { ok: true };

    const bestehend = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: vereinId }).first();
    if (!bestehend) {
        await knex('benutzer_vereine').insert({
            benutzer_id: benutzerId,
            verein_id: vereinId,
            freigegeben: 0,
            angefragt_ueber: eintrag.angefragt_ueber || 'verwaltung'
        });
        await knex('benutzer').where({ id: benutzerId }).whereNull('aktiver_verein_id')
            .update({ aktiver_verein_id: vereinId, updated_at: knex.fn.now() });

        try {
            const freiToken = await erzeugeToken(knex, { benutzerId, zweck: 'freischaltung', vereinId });
            const freischaltLink = `${String(basisUrl || '').replace(/\/+$/, '')}/freigabe.html?token=${encodeURIComponent(freiToken)}`;
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

    // Verein und Quelle der Registrierung stehen am letzten Bestätigungs-Token (auch wenn er abgelaufen ist).
    const letzter = await knex('token_einmal')
        .where({ benutzer_id: konto.id, zweck: 'email' })
        .orderBy('id', 'desc')
        .first();
    await entwerteTokens(knex, konto.id, 'email');
    const token = await erzeugeToken(knex, {
        benutzerId: konto.id,
        zweck: 'email',
        vereinId: letzter ? letzter.verein_id : null,
        angefragtUeber: letzter ? letzter.angefragt_ueber : null
    });
    await sendeBestaetigungsMail(sende, konto, basisUrl, token);
    return { ok: true };
}
