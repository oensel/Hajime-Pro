// Turnier per E-Mail teilen: die Mail enthält einen Direktlink zur Turnier-Ansicht (turnier-ansicht.html). Wer schon
// ein Konto hat, meldet sich an und landet dort; wer keines hat, registriert sich auf derselben Anmeldeseite (der
// Link merkt sich das Ziel). Es entstehen keine neuen Rechte: freigeschaltete Mitglieder können dort Teilnehmer
// anmelden (bestehende Fremdverein-Anmeldung), alle anderen sehen nur die Turnierdaten.
import { sendeMail } from '../utils/mailer.js';
import { FachFehler } from '../utils/fachFehler.js';
import { basis, zerlegeEmailListe, MAX_EINLADUNGEN_JE_ANFRAGE } from './helferEinladung.js';
import { normalisiereEmail } from './registrierung.js';
import { turnierAnsichtPfad, loginMitWeiterleitung } from '../shared/weiterZiel.js';

export const MAX_VEREINE_JE_ANFRAGE = 100;

/**
 * E-Mail-Adressen der Admins der Vereine (freigegeben, Rolle admin, E-Mail bestätigt, Konto nicht gesperrt).
 * @returns {Promise<{ adminAdressen: string[], vereineOhneAdmin: string[] }>} Namen der Vereine ohne erreichbaren Admin
 */
async function ladeVereinsAdmins(knex, vereinIds) {
    if (vereinIds.length === 0) return { adminAdressen: [], vereineOhneAdmin: [], vereinsIdsGefunden: [] };
    const vereine = await knex('vereine').whereIn('id', vereinIds).select('id', 'name');
    const admins = await knex('benutzer_vereine as bv')
        .join('benutzer as b', 'b.id', 'bv.benutzer_id')
        .whereIn('bv.verein_id', vereine.map((v) => v.id))
        .where({ 'bv.freigegeben': 1, 'bv.rolle': 'admin' })
        .whereNotNull('b.email_bestaetigt_am')
        .where((q) => q.whereNull('b.gesperrt').orWhere('b.gesperrt', false))
        .select('bv.verein_id', 'b.email');
    const mitAdmin = new Set(admins.map((a) => a.verein_id));
    return {
        adminAdressen: admins.map((a) => normalisiereEmail(a.email)).filter(Boolean),
        vereinsIdsGefunden: vereine.map((v) => v.id),
        vereineOhneAdmin: vereine.filter((v) => !mitAdmin.has(v.id)).map((v) => v.name)
    };
}

function datumText(datum) {
    if (!datum) return '';
    const tag = datum instanceof Date
        ? `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(datum.getDate()).padStart(2, '0')}`
        : String(datum).slice(0, 10);
    return tag.split('-').reverse().join('.');
}

function mailText(turnier, link) {
    const zeilen = [`Turnier: ${turnier.bezeichnung}`];
    const datum = datumText(turnier.datum);
    if (datum) zeilen.push(`Datum: ${datum}`);
    const ort = [turnier.plz, turnier.ort].filter(Boolean).join(' ');
    if (ort) zeilen.push(`Ort: ${ort}`);
    if (turnier.ausrichter) zeilen.push(`Ausrichter: ${turnier.ausrichter}`);
    return `Hallo,

Sie wurden auf ein Turnier in Hajime Pro hingewiesen:

${zeilen.join('\n')}

Über diesen Link sehen Sie das Turnier. Haben Sie schon ein Konto, melden Sie sich an; sonst registrieren Sie sich auf der Anmeldeseite (Reiter „Konto erstellen“) und wählen dabei Ihren Verein. Freigeschaltete Mitglieder können dort außerdem Teilnehmer anmelden.
${link}

Falls Sie die Mail nicht erwartet haben, können Sie sie ignorieren.`;
}

/**
 * Versendet den Turnier-Link an eingetragene Adressen und an die Admins ausgewählter Vereine. Ergebnis je Adresse: 'gesendet' oder 'fehler'.
 * @returns {Promise<{ ergebnisse: { email: string, status: string }[], ungueltig: string[] }>}
 */
export async function teileTurnierPerMail(knex, { turnier, eingabe, vereinIds = [], eingeladenVon = null, basisUrl, sende = sendeMail }) {
    const { adressen: eingetragen, ungueltig } = zerlegeEmailListe(eingabe);
    if (eingetragen.length === 0 && ungueltig.length === 0 && vereinIds.length === 0) {
        throw Object.assign(new FachFehler(400, 'Bitte mindestens eine E-Mail-Adresse oder einen Verein angeben.'), { status: 400 });
    }
    if (vereinIds.length > MAX_VEREINE_JE_ANFRAGE) {
        throw Object.assign(new FachFehler(400, `Bitte höchstens ${MAX_VEREINE_JE_ANFRAGE} Vereine auf einmal auswählen.`), { status: 400 });
    }
    if (eingetragen.length > MAX_EINLADUNGEN_JE_ANFRAGE) {
        throw Object.assign(new FachFehler(400, `Bitte höchstens ${MAX_EINLADUNGEN_JE_ANFRAGE} Adressen auf einmal eintragen.`), { status: 400 });
    }
    const b = basis(basisUrl);
    const { adminAdressen, vereineOhneAdmin, vereinsIdsGefunden } = await ladeVereinsAdmins(knex, vereinIds);
    // Die Einladung der Vereine bleibt gespeichert: deren Admins sehen sie in der Turnierübersicht (auch ohne Mail-Erfolg).
    if (vereinsIdsGefunden.length > 0) {
        await knex('turnier_einladungen')
            .insert(vereinsIdsGefunden.map((vereinId) => ({ turnier_id: turnier.id, verein_id: vereinId, eingeladen_von: eingeladenVon })))
            .onConflict(['turnier_id', 'verein_id']).ignore();
    }
    // Eine Adresse, die schon eingetragen ist oder in mehreren Vereinen Admin ist, bekommt nur eine Mail.
    const adressen = [...new Set([...eingetragen, ...adminAdressen])];
    const link = `${b}${loginMitWeiterleitung(turnierAnsichtPfad(turnier.id))}`;
    // Adressen, die der Absender nicht selbst eingetragen hat (Vereins-Admins), erscheinen nie einzeln in der Antwort,
    // sondern nur als Anzahl: sonst könnte jeder Verwalter die Admin-Adressen fremder Vereine auslesen.
    const eingetragenSet = new Set(eingetragen);
    const ergebnisse = [];
    const vereinsAdmins = { gesendet: 0, fehler: 0 };
    for (const email of adressen) {
        let status = 'gesendet';
        try {
            await sende({ to: email, subject: `Hajime Pro: Turnier „${turnier.bezeichnung}“`, text: mailText(turnier, link) });
        } catch (err) {
            console.error('[Turnier-Teilen] Mail fehlgeschlagen:', err.message);
            status = 'fehler';
        }
        if (eingetragenSet.has(email)) ergebnisse.push({ email, status });
        else vereinsAdmins[status] += 1;
    }
    return { ergebnisse, ungueltig, vereinsAdmins, vereineOhneAdmin };
}
