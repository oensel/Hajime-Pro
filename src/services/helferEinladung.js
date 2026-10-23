// Admins laden Personen per E-Mail als Helfer in ihren Verein ein (einzeln oder als Liste).
// Die Einladung selbst (Token, Einlösen mit Registrierung bzw. Passwort, sofortige Freischaltung als Helfer) ist die
// des Orga-Planers (orgaEinladung.js, Seite einladung.html); hier kommt nur das Versenden und Auswerten dazu.
import { sendeMail } from '../utils/mailer.js';
import { FachFehler } from '../utils/fachFehler.js';
import { HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { erzeugeEinladung, legeMitgliedschaftAn, EINLADUNG_GUELTIG_TAGE } from './orgaEinladung.js';
import { findeKontoPerEmail, normalisiereEmail, MAX_EMAIL_LAENGE } from './registrierung.js';
import { istFreigegebenesMitglied } from '../utils/vereinHelper.js';

export const MAX_EINLADUNGEN_JE_ANFRAGE = 100;
const EMAIL_MUSTER = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;".]+$/;

/**
 * Zerlegt eine Liste (Text mit Zeilenumbrüchen, Kommas, Semikolons oder Leerzeichen bzw. ein Array) in E-Mail-Adressen.
 * Formen wie "Anna Muster <anna@beispiel.de>" werden auf die Adresse reduziert. Doppelte Adressen zählen einmal.
 * @returns {{ adressen: string[], ungueltig: string[] }}
 */
export function zerlegeEmailListe(eingabe) {
    const teile = (Array.isArray(eingabe) ? eingabe : String(eingabe ?? '').split(/[\n\r,;]+/))
        .map((t) => String(t ?? '').trim())
        .filter(Boolean);
    const adressen = [];
    const ungueltig = [];
    const gesehen = new Set();
    for (const teil of teile) {
        const klammer = teil.match(/<([^<>]+)>/);
        const kandidat = normalisiereEmail(klammer ? klammer[1] : teil);
        if (!kandidat || kandidat.length > MAX_EMAIL_LAENGE || !EMAIL_MUSTER.test(kandidat)) {
            ungueltig.push(teil);
            continue;
        }
        if (gesehen.has(kandidat)) continue;
        gesehen.add(kandidat);
        adressen.push(kandidat);
    }
    return { adressen, ungueltig };
}

export function basis(basisUrl) {
    const b = typeof basisUrl === 'string' ? basisUrl.trim().replace(/\/+$/, '') : '';
    if (!b) {
        const e = new FachFehler(503, HINWEIS_FEHLENDE_BASIS_URL);
        e.status = 503;
        throw e;
    }
    return b;
}

function zuordnungsMailText(vereinName, link) {
    return `Hallo,

${vereinName} hat Sie in Hajime Pro als Helfer aufgenommen. Sie können sich mit Ihrem bestehenden Konto anmelden und ${vereinName} im Vereinswechsler wählen:
${link}

Falls Sie das nicht erwartet haben, wenden Sie sich bitte an den Verein.`;
}

function mailText(vereinName, link) {
    return `Hallo,

${vereinName} lädt Sie als Helfer zu Hajime Pro ein.

Über diesen Link legen Sie Ihr Konto an (Vor- und Nachname sowie ein Passwort festlegen, danach sind Sie sofort freigeschaltet; ${EINLADUNG_GUELTIG_TAGE} Tage gültig, nur einmal verwendbar):
${link}

Falls Sie die Einladung nicht erwartet haben, können Sie diese Mail ignorieren.`;
}

/**
 * Nimmt Personen per E-Mail in den Verein auf. Ergebnis je Adresse: 'gesendet' (neue Adresse: Einladung mit Link zur
 * Registrierung, danach sofort freigegeben), 'zugeordnet' (die Adresse hat schon ein Konto: es wird direkt als Helfer
 * des Vereins freigegeben, weitere Vereine bleiben, kurze Info-Mail), 'bereits_mitglied' (freigegebenes Mitglied des
 * Vereins, keine Mail) oder 'fehler' (Mailversand fehlgeschlagen; die Einladung wird dann entwertet statt offen zu bleiben).
 * @returns {Promise<{ ergebnisse: { email: string, status: string }[], ungueltig: string[] }>}
 */
export async function sendeHelferEinladungen(knex, { vereinId, eingabe, basisUrl, sende = sendeMail }) {
    const { adressen, ungueltig } = zerlegeEmailListe(eingabe);
    if (adressen.length === 0 && ungueltig.length === 0) {
        throw Object.assign(new FachFehler(400, 'Bitte mindestens eine E-Mail-Adresse angeben.'), { status: 400 });
    }
    if (adressen.length > MAX_EINLADUNGEN_JE_ANFRAGE) {
        throw Object.assign(new FachFehler(400, `Bitte höchstens ${MAX_EINLADUNGEN_JE_ANFRAGE} Adressen auf einmal einladen.`), { status: 400 });
    }
    const b = basis(basisUrl);
    const verein = await knex('vereine').where({ id: vereinId }).first('name');
    if (!verein) throw Object.assign(new FachFehler(404, 'Verein nicht gefunden.'), { status: 404 });

    const ergebnisse = [];
    for (const email of adressen) {
        const konto = await findeKontoPerEmail(knex, email);
        if (konto && (await istFreigegebenesMitglied(knex, konto.id, vereinId))) {
            ergebnisse.push({ email, status: 'bereits_mitglied' });
            continue;
        }
        // Nur Konten, die schon irgendwo Mitglied sind, werden direkt zugeordnet (Vereins-Admins können Konten mit weiteren
        // Vereinen nicht verwalten). Ein Konto ganz ohne Zuordnung bekäme der Admin sonst in die Hand: es geht über die
        // Einladung, die die Person selbst mit ihrem Passwort einlöst.
        if (konto && await knex('benutzer_vereine').where({ benutzer_id: konto.id }).first('verein_id')) {
            await knex.transaction(async (trx) => {
                await legeMitgliedschaftAn(trx, konto.id, vereinId);
                await trx('benutzer').where({ id: konto.id }).whereNull('aktiver_verein_id')
                    .update({ aktiver_verein_id: vereinId, updated_at: trx.fn.now() });
            });
            ergebnisse.push({ email, status: 'zugeordnet' });
            try {
                await sende({
                    to: email,
                    subject: `Hajime Pro: Sie gehören jetzt zu ${verein.name}`,
                    text: zuordnungsMailText(verein.name, `${b}/login.html`)
                });
            } catch (err) {
                console.error('[Helfer-Einladung] Info-Mail fehlgeschlagen:', err.message);
            }
            continue;
        }
        const token = await erzeugeEinladung(knex, { email, vereinId });
        try {
            await sende({
                to: email,
                subject: `Hajime Pro: Einladung von ${verein.name}`,
                text: mailText(verein.name, `${b}/einladung.html?token=${encodeURIComponent(token)}`)
            });
            ergebnisse.push({ email, status: 'gesendet' });
        } catch (err) {
            console.error('[Helfer-Einladung] Mail fehlgeschlagen:', err.message);
            await knex('orga_einladungen').where({ verein_id: vereinId, email }).whereNull('benutzt_am').update({ laeuft_ab_am: knex.fn.now() });
            ergebnisse.push({ email, status: 'fehler' });
        }
    }
    return { ergebnisse, ungueltig };
}

function registrierungsMailText(link) {
    return `Hallo,

Sie sind zu Hajime Pro eingeladen, der Turnierverwaltung für Judo-Wettkämpfe.

Über diesen Link legen Sie Ihr Konto an und wählen dabei Ihren Verein (nach der Bestätigung Ihrer E-Mail-Adresse schaltet ein Admin des Vereins Sie frei):
${link}

Falls Sie die Einladung nicht erwartet haben, können Sie diese Mail ignorieren.`;
}

/**
 * Lädt Personen ohne Angabe eines Vereins zur Registrierung ein. Die Mail führt auf die normale Registrierung
 * (E-Mail vorbelegt); Verein, E-Mail-Bestätigung und Freischaltung laufen wie bei jeder Registrierung, es gibt
 * keinen Einmal-Token und keine Sofort-Freischaltung. Ergebnis je Adresse: 'gesendet', 'bereits_konto' (die Adresse
 * hat schon ein Konto, keine Mail) oder 'fehler' (Mailversand fehlgeschlagen).
 * @returns {Promise<{ ergebnisse: { email: string, status: string }[], ungueltig: string[] }>}
 */
export async function sendeRegistrierungsEinladungen(knex, { eingabe, basisUrl, sende = sendeMail }) {
    const { adressen, ungueltig } = zerlegeEmailListe(eingabe);
    if (adressen.length === 0 && ungueltig.length === 0) {
        throw Object.assign(new FachFehler(400, 'Bitte mindestens eine E-Mail-Adresse angeben.'), { status: 400 });
    }
    if (adressen.length > MAX_EINLADUNGEN_JE_ANFRAGE) {
        throw Object.assign(new FachFehler(400, `Bitte höchstens ${MAX_EINLADUNGEN_JE_ANFRAGE} Adressen auf einmal einladen.`), { status: 400 });
    }
    const b = basis(basisUrl);
    const ergebnisse = [];
    for (const email of adressen) {
        if (await findeKontoPerEmail(knex, email)) {
            ergebnisse.push({ email, status: 'bereits_konto' });
            continue;
        }
        try {
            await sende({
                to: email,
                subject: 'Hajime Pro: Einladung zur Registrierung',
                text: registrierungsMailText(`${b}/login.html?registrieren=1&email=${encodeURIComponent(email)}`)
            });
            ergebnisse.push({ email, status: 'gesendet' });
        } catch (err) {
            console.error('[Registrierungs-Einladung] Mail fehlgeschlagen:', err.message);
            ergebnisse.push({ email, status: 'fehler' });
        }
    }
    return { ergebnisse, ungueltig };
}

/** Offene (nicht eingelöste, nicht abgelaufene) Einladungen eines Vereins, neueste zuerst. */
export async function ladeOffeneEinladungen(knex, vereinId) {
    const zeilen = await knex('orga_einladungen')
        .where({ verein_id: vereinId })
        .whereNull('benutzt_am')
        .whereRaw('laeuft_ab_am > now()')
        .orderBy('id', 'desc')
        .select('email', 'laeuft_ab_am');
    return zeilen.map((z) => ({ email: z.email, laeuftAbAm: z.laeuft_ab_am instanceof Date ? z.laeuft_ab_am.toISOString() : String(z.laeuft_ab_am) }));
}
