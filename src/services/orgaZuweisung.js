// Orga-Planer: Aufgaben/Posten Personen zuweisen (Spec 2026-10-18-orga-planer-design, "Zuweisen, Mail, Einladung").
// Modi: 'konto' (Mitglied des Vereins, Mail mit Link auf die Helfer-App), 'frei' (nur Name, keine Mail),
// 'einladung' (freier Name + E-Mail ohne Konto mit Mitgliedschaft: Einladungsmail, siehe orgaEinladung.js).
// Mailfehler brechen die Zuweisung nie ab; fehlt die Basis-URL für einen Link, ist das ein 503 wie bei der Registrierung.
import { FachFehler } from '../utils/fachFehler.js';
import { sendeMail } from '../utils/mailer.js';
import { HINWEIS_FEHLENDE_BASIS_URL } from '../utils/basisUrl.js';
import { findeKontoPerEmail, normalisiereEmail, MAX_EMAIL_LAENGE, MELDUNG_EMAIL_ZU_LANG } from './registrierung.js';
import { erzeugeEinladung } from './orgaEinladung.js';
import { istFreigegebenesMitglied } from '../utils/vereinHelper.js';

const MAX_NAME = 255;

function fehler(status, nachricht) {
    const e = new FachFehler(status, nachricht);
    e.status = status;
    return e;
}

function basis(basisUrl) {
    const b = typeof basisUrl === 'string' ? basisUrl.trim().replace(/\/+$/, '') : '';
    if (!b) throw fehler(503, HINWEIS_FEHLENDE_BASIS_URL);
    return b;
}

async function ladeKontext(knex, aufgabeId) {
    const aufgabe = await knex('orga_aufgaben').where({ id: aufgabeId }).first();
    if (!aufgabe) throw fehler(404, 'Aufgabe nicht gefunden.');
    const turnier = await knex('turniere').where({ id: aufgabe.turnier_id }).first('id', 'bezeichnung', 'datum', 'verein_id');
    if (!turnier || !turnier.verein_id) throw fehler(400, 'Das Turnier gehört keinem Verein.');
    const verein = await knex('vereine').where({ id: turnier.verein_id }).first('name');
    return { aufgabe, turnier, vereinName: verein ? verein.name : '' };
}

const hatMitgliedschaft = istFreigegebenesMitglied;

async function sendeSicher(sende, mail) {
    try {
        await sende(mail);
    } catch (err) {
        console.error('[Orga-Planer] Mail fehlgeschlagen:', err.message);
    }
}

function turnierText(turnier) {
    const datum = turnier.datum instanceof Date ? turnier.datum.toISOString().slice(0, 10) : String(turnier.datum || '').slice(0, 10);
    return datum ? `${turnier.bezeichnung} (${datum})` : turnier.bezeichnung;
}

async function sendeKontoMail(sende, konto, aufgabe, turnier, vereinName, b) {
    await sendeSicher(sende, {
        to: konto.email,
        subject: `Hajime Pro: Aufgabe "${aufgabe.titel}" für ${turnier.bezeichnung}`,
        text: `Hallo ${konto.vorname},

${vereinName} hat Ihnen beim Turnier ${turnierText(turnier)} die Aufgabe "${aufgabe.titel}" zugewiesen.

Ihre Aufgaben sehen Sie in der Helfer-App:
${b}/helfer.html#aufgaben`
    });
}

async function sendeEinladungsMail(knex, sende, { email, name, aufgabe, turnier, vereinId, vereinName }, b) {
    const token = await erzeugeEinladung(knex, { email, name, vereinId });
    await sendeSicher(sende, {
        to: email,
        subject: `Hajime Pro: Einladung von ${vereinName}`,
        text: `Hallo ${name || ''},

${vereinName} hat Ihnen beim Turnier ${turnierText(turnier)} die Aufgabe "${aufgabe.titel}" zugewiesen und lädt Sie zu Hajime Pro ein.

Über diesen Link legen Sie Ihr Konto an (14 Tage gültig, nur einmal verwendbar):
${b}/einladung.html?token=${encodeURIComponent(token)}

Falls Sie die Einladung nicht erwartet haben, können Sie diese Mail ignorieren.`
    });
}

/** Entscheidet für eine freie Person mit Adresse, ob ein Konto mit Mitgliedschaft existiert. */
async function findeMitglied(knex, email, vereinId) {
    const konto = await findeKontoPerEmail(knex, email);
    if (konto && konto.email_bestaetigt_am && await hatMitgliedschaft(knex, konto.id, vereinId)) return konto;
    return null;
}

/**
 * Weist eine Aufgabe zu.
 * @param {number} aufgabeId
 * @param {{ benutzerId: string } | { name: string, email?: string } | { frei: false }} ziel
 * @param {{ basisUrl: string|null, sende?: Function }} optionen
 * @returns {Promise<{ modus: 'konto'|'frei'|'einladung'|null }>} null bei aufgehobener Zuweisung
 */
export async function weiseZu(knex, aufgabeId, ziel = {}, { basisUrl, sende = sendeMail, mitMail = true } = {}) {
    const { aufgabe, turnier, vereinName } = await ladeKontext(knex, aufgabeId);
    const vereinId = turnier.verein_id;

    if (ziel.frei === false) {
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: null, name_frei: null, email_frei: null });
        return { modus: null };
    }

    if (ziel.benutzerId) {
        const konto = await knex('benutzer').where({ id: ziel.benutzerId }).first();
        if (!konto || !(await hatMitgliedschaft(knex, konto.id, vereinId))) {
            throw fehler(400, 'Diese Person ist kein freigegebenes Mitglied des Vereins.');
        }
        const b = mitMail ? basis(basisUrl) : null;
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: konto.id, name_frei: null, email_frei: null });
        if (mitMail) await sendeKontoMail(sende, konto, aufgabe, turnier, vereinName, b);
        return { modus: 'konto' };
    }

    const name = typeof ziel.name === 'string' ? ziel.name.trim() : '';
    if (!name) throw fehler(400, 'Bitte einen Namen angeben.');
    if (name.length > MAX_NAME) throw fehler(400, `Der Name ist zu lang (höchstens ${MAX_NAME} Zeichen).`);
    const email = normalisiereEmail(ziel.email);
    if (!email) {
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: null, name_frei: name, email_frei: null });
        return { modus: 'frei' };
    }
    if (email.length > MAX_EMAIL_LAENGE) throw fehler(400, MELDUNG_EMAIL_ZU_LANG);
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;".]+$/.test(email)) throw fehler(400, 'Bitte eine gültige E-Mail-Adresse angeben.');

    if (!mitMail) {
        // Hallen-Server: keine Einladungen und keine Mails, die Angaben werden nur gespeichert.
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: null, name_frei: name, email_frei: email });
        return { modus: 'frei' };
    }
    const b = basis(basisUrl);
    const mitglied = await findeMitglied(knex, email, vereinId);
    if (mitglied) {
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: mitglied.id, name_frei: null, email_frei: null });
        await sendeKontoMail(sende, mitglied, aufgabe, turnier, vereinName, b);
        return { modus: 'konto' };
    }
    await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: null, name_frei: name, email_frei: email });
    await sendeEinladungsMail(knex, sende, { email, name, aufgabe, turnier, vereinId, vereinName }, b);
    return { modus: 'einladung' };
}

/** Schickt die Einladung für eine Aufgabe mit freiem Namen und E-Mail erneut (neuer Token, ältere verfallen). */
export async function sendeEinladungNeu(knex, aufgabeId, basisUrl, { sende = sendeMail } = {}) {
    const { aufgabe, turnier, vereinName } = await ladeKontext(knex, aufgabeId);
    if (aufgabe.benutzer_id || !aufgabe.email_frei) {
        throw fehler(400, 'Diese Aufgabe hat keine Person mit E-Mail-Adresse, die eingeladen werden könnte.');
    }
    const b = basis(basisUrl);
    const mitglied = await findeMitglied(knex, aufgabe.email_frei, turnier.verein_id);
    if (mitglied) {
        await knex('orga_aufgaben').where({ id: aufgabeId }).update({ benutzer_id: mitglied.id, name_frei: null, email_frei: null });
        await sendeKontoMail(sende, mitglied, aufgabe, turnier, vereinName, b);
        return { modus: 'konto' };
    }
    await sendeEinladungsMail(knex, sende, {
        email: aufgabe.email_frei, name: aufgabe.name_frei, aufgabe, turnier, vereinId: turnier.verein_id, vereinName
    }, b);
    return { modus: 'einladung' };
}
