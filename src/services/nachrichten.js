// Nachrichten (nur Cloud): Kontakt an die Super-Admins (auch ohne Konto, z. B. die Vereinsanfrage auf login.html),
// Nachrichten von Vereinsadmins an Mitglieder des eigenen Vereins, an einzelne Admins anderer Vereine oder an alle
// Admins eines fremden Vereins. Jede Unterhaltung liegt in nachrichten_threads; wer sie sieht, bestimmen die Teilnehmer
// (nachrichten_teilnehmer) bzw. `an_super_admins` (alle Super-Admins im Super-Admin-Modus). Wer eine Nachricht erhält,
// bekommt eine Info-Mail ohne Inhalt (nur Absender, Betreff und Link); Absender ohne Konto bekommen die Antwort per Mail.
import { sendeMail } from '../utils/mailer.js';
import { FachFehler } from '../utils/fachFehler.js';
import { ermittleBasisUrl } from '../utils/basisUrl.js';
import { ladeBenutzerMitAktivemVerein } from '../utils/vereinHelper.js';
import { rolleReicht } from '../shared/rollen.js';
import { normalisiereEmail, MAX_EMAIL_LAENGE } from './registrierung.js';
import betriebsmodus from '../config/betriebsmodus.cjs';
import { helferAppLink } from '../utils/helferAppLink.js';

export const MAX_BETREFF = 150;
export const MAX_TEXT = 5000;
export const MAX_PERSONEN = 50;
// Unterhaltungen ohne neue Nachricht seit so vielen Tagen löscht der tägliche Lauf in app.js (Datenschutzerklärung,
// Abschnitt „Kontaktformular und Nachrichten“); NACHRICHTEN_AUFBEWAHRUNG_TAGE überschreibt den Wert.
export const NACHRICHTEN_TAGE = 365;
const EMAIL_MUSTER = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;".]+$/;

/** Die Nachrichten gibt es nur in der Cloud (NACHRICHTEN_AKTIV=true schaltet sie für Tests ein). */
export function istNachrichtenAktiv(env = process.env) {
    return betriebsmodus.liesBetriebsmodus(env).istCloud || env.NACHRICHTEN_AKTIV === 'true';
}

function fehler(status, text) {
    return new FachFehler(status, text);
}

function kontoName(k) {
    return `${k.vorname || ''} ${k.nachname || ''}`.trim() || k.email || 'Unbekannt';
}

function bereinige(wert, max, feld) {
    const t = String(wert ?? '').replace(/\r\n/g, '\n').trim();
    if (!t) throw fehler(400, `${feld} fehlt.`);
    if (t.length > max) throw fehler(400, `${feld} ist zu lang (höchstens ${max} Zeichen).`);
    return t;
}

/** Konto mit Super-Admin-Modus und aktivem Verein (wie requireAuth/ladeBenutzerMitAktivemVerein). */
export async function ladeKonto(knex, benutzerId) {
    const konto = await ladeBenutzerMitAktivemVerein(knex, benutzerId);
    if (!konto) throw fehler(401, 'Nicht angemeldet.');
    return konto;
}

// Unterhaltungen, die das Konto sieht: Teilnehmer, oder alle Super-Admin-Unterhaltungen für Super-Admins im Super-Admin-Modus.
function sichtbar(knex, konto) {
    return knex('nachrichten_threads as t').where((b) => {
        b.whereExists(knex('nachrichten_teilnehmer as p').whereRaw('p.thread_id = t.id').where('p.benutzer_id', konto.id));
        if (konto.super_admin_aktiv) b.orWhere('t.an_super_admins', true);
    });
}

function ungelesen(knex, query, konto) {
    return query.whereExists(
        knex('nachrichten as n').whereRaw('n.thread_id = t.id')
            .whereRaw('n.id > coalesce((select g.letzte_nachricht_id from nachrichten_gelesen g where g.thread_id = t.id and g.benutzer_id = ?), 0)', [konto.id])
            .whereRaw('n.von_benutzer_id is distinct from ?', [konto.id])
    );
}

export async function zaehleUngelesene(knex, konto) {
    const zeile = await ungelesen(knex, sichtbar(knex, konto), konto).count({ anzahl: 't.id' }).first();
    return Number(zeile?.anzahl || 0);
}

/** Unterhaltungen des Kontos, neueste zuerst, mit letzter Nachricht und Ungelesen-Kennzeichen. */
export async function listeThreads(knex, konto) {
    const threads = await sichtbar(knex, konto).select('t.*').orderBy('t.aktualisiert_am', 'desc').orderBy('t.id', 'desc').limit(300);
    if (threads.length === 0) return [];
    const ids = threads.map((t) => t.id);
    const letzte = await knex('nachrichten').whereIn('thread_id', ids).select('thread_id', 'von_name', 'text', 'id', 'von_benutzer_id', 'erstellt_am').orderBy('id', 'desc');
    const letzteJe = new Map();
    for (const n of letzte) if (!letzteJe.has(n.thread_id)) letzteJe.set(n.thread_id, n);
    const offene = new Set(await ungelesen(knex, sichtbar(knex, konto), konto).whereIn('t.id', ids).pluck('t.id'));
    return threads.map((t) => {
        const l = letzteJe.get(t.id);
        return {
            id: t.id,
            art: t.art,
            betreff: t.betreff,
            absender: t.absender_name,
            anSuperAdmins: !!t.an_super_admins,
            aktualisiertAm: t.aktualisiert_am,
            letzteVon: l ? l.von_name : '',
            vorschau: l ? l.text.slice(0, 140) : '',
            ungelesen: offene.has(t.id)
        };
    });
}

async function pruefeZugriff(knex, konto, threadId) {
    const thread = await sichtbar(knex, konto).where('t.id', threadId).select('t.*').first();
    if (!thread) throw fehler(404, 'Unterhaltung nicht gefunden.');
    return thread;
}

/** Eine Unterhaltung mit Verlauf; markiert sie für das Konto als gelesen. */
export async function ladeThread(knex, konto, threadId) {
    const thread = await pruefeZugriff(knex, konto, threadId);
    const nachrichten = await knex('nachrichten').where({ thread_id: thread.id }).orderBy('id').select('id', 'von_name', 'von_benutzer_id', 'text', 'erstellt_am');
    const teilnehmer = await knex('nachrichten_teilnehmer as p').join('benutzer as b', 'b.id', 'p.benutzer_id').where('p.thread_id', thread.id).select('b.id', 'b.vorname', 'b.nachname');
    const letzteId = nachrichten.length ? nachrichten[nachrichten.length - 1].id : 0;
    await knex.raw(
        `insert into nachrichten_gelesen (thread_id, benutzer_id, letzte_nachricht_id) values (?, ?, ?)
         on conflict (thread_id, benutzer_id) do update set letzte_nachricht_id = greatest(nachrichten_gelesen.letzte_nachricht_id, excluded.letzte_nachricht_id)`,
        [thread.id, konto.id, letzteId]
    );
    return {
        id: thread.id,
        art: thread.art,
        betreff: thread.betreff,
        absender: thread.absender_name,
        absenderEmail: konto.super_admin_aktiv ? thread.absender_email : null,
        anfrageVerein: thread.anfrage_verein,
        anSuperAdmins: !!thread.an_super_admins,
        teilnehmer: teilnehmer.map((t) => ({ id: t.id, name: kontoName(t) })),
        nachrichten: nachrichten.map((n) => ({
            id: n.id, von: n.von_name, eigene: n.von_benutzer_id === konto.id, text: n.text, erstelltAm: n.erstellt_am
        }))
    };
}

// --- Benachrichtigung per Mail ---------------------------------------------------------------------

async function benachrichtige(knex, { thread, absenderId, absenderIstSuperAdmin, basisUrl, sende }) {
    const empfaenger = new Map();
    const ergaenze = (zeilen) => { for (const z of zeilen) if (z.email && !z.gesperrt && z.id !== absenderId) empfaenger.set(z.id, z); };
    ergaenze(await knex('nachrichten_teilnehmer as p').join('benutzer as b', 'b.id', 'p.benutzer_id').where('p.thread_id', thread.id).select('b.id', 'b.email', 'b.vorname', 'b.nachname', 'b.gesperrt'));
    if (thread.an_super_admins && !absenderIstSuperAdmin) {
        ergaenze(await knex('benutzer').where({ ist_super_admin: true }).select('id', 'email', 'vorname', 'nachname', 'gesperrt'));
    }
    const link = basisUrl ? `${basisUrl}/nachrichten.html?id=${thread.id}` : null;
    const appLink = helferAppLink(basisUrl, 'nachrichten');
    const mails = [...empfaenger.values()].map((k) => ({
        to: k.email,
        subject: `Neue Nachricht in Hajime Pro: ${thread.betreff}`,
        text: `Hallo ${k.vorname || ''},\n\nDu hast eine neue Nachricht in Hajime Pro (Betreff: ${thread.betreff}).\n\n${link ? `Lesen und antworten:\n${link}\n${appLink ? `\nIn der Helfer-App:\n${appLink}\n` : ''}` : 'Melde dich an und öffne über das Profil-Icon deine Nachrichten.\n'}`
    }));
    await Promise.all(mails.map((m) => sende(m).catch((e) => console.error('[Nachrichten] Mail fehlgeschlagen:', e.message))));
}

async function mailAnAnonymen(thread, text, von, sende) {
    if (!thread.absender_email || thread.erstellt_von) return;
    await sende({
        to: thread.absender_email,
        subject: `Antwort zu: ${thread.betreff}`,
        text: `Hallo ${thread.absender_name},\n\n${von} hat dir auf deine Anfrage bei Hajime Pro geantwortet:\n\n${text}\n\n(Diese Nachricht kommt aus einem Postfach, auf das du nicht direkt antworten kannst. Antworte bitte über das Kontaktformular auf der Anmeldeseite oder, wenn du ein Konto hast, nach dem Anmelden.)`
    }).catch((e) => console.error('[Nachrichten] Mail an Absender fehlgeschlagen:', e.message));
}

// --- Kontakt ohne Konto -----------------------------------------------------------------------------

/**
 * Kontaktformular ohne Anmeldung (login.html und alle Seiten ohne Konto). `art` 'vereinsanfrage' verlangt den
 * vollständigen Vereinsnamen (der Verein darf noch nicht existieren); alles landet bei den Super-Admins.
 */
export async function sendeKontaktOhneKonto(knex, eingabe, { basisUrl = null, sende = sendeMail } = {}) {
    const name = bereinige(eingabe.name, 100, 'Der Name');
    const email = normalisiereEmail(eingabe.email);
    if (!email || email.length > MAX_EMAIL_LAENGE || !EMAIL_MUSTER.test(email)) throw fehler(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    const text = bereinige(eingabe.text, MAX_TEXT, 'Die Nachricht');
    const istAnfrage = eingabe.art === 'vereinsanfrage';
    let anfrageVerein = null;
    let betreff;
    if (istAnfrage) {
        anfrageVerein = bereinige(eingabe.vereinsname, 150, 'Der Vereinsname').replace(/\s+/g, ' ');
        if (anfrageVerein.length < 5) throw fehler(400, 'Bitte den vollständigen Vereinsnamen eingeben.');
        const vorhanden = await knex('vereine').whereRaw('lower(trim(name)) = ?', [anfrageVerein.toLowerCase()]).first('id');
        if (vorhanden) throw fehler(409, 'Diesen Verein gibt es schon. Bitte wähle ihn bei der Registrierung aus der Liste.');
        betreff = `Vereinsanfrage: ${anfrageVerein}`;
    } else {
        betreff = bereinige(eingabe.betreff, MAX_BETREFF, 'Der Betreff');
    }
    const thread = await knex.transaction(async (trx) => {
        const [t] = await trx('nachrichten_threads').insert({
            art: istAnfrage ? 'vereinsanfrage' : 'kontakt', betreff, an_super_admins: true,
            absender_name: name, absender_email: email, anfrage_verein: anfrageVerein
        }).returning('*');
        await trx('nachrichten').insert({ thread_id: t.id, von_name: name, text });
        return t;
    });
    await benachrichtige(knex, { thread, absenderId: null, absenderIstSuperAdmin: false, basisUrl, sende });
    return { id: thread.id };
}

// --- Angemeldet schreiben ---------------------------------------------------------------------------

async function vereineAlsAdmin(knex, konto) {
    const zeilen = await knex('benutzer_vereine').where({ benutzer_id: konto.id, freigegeben: 1 }).select('verein_id', 'rolle');
    return zeilen.filter((z) => rolleReicht(z.rolle, 'admin')).map((z) => z.verein_id);
}

/** Wer darf an andere Konten schreiben: Admins (eines Vereins) und Super-Admins; alle anderen nur an die Super-Admins. */
async function darfAnKonten(knex, konto) {
    return konto.super_admin_aktiv || (await vereineAlsAdmin(knex, konto)).length > 0;
}

const aktiveKonten = (knex) => knex('benutzer').where((b) => b.where({ gesperrt: false }).orWhereNull('gesperrt'));

/** Empfängerkonten eines Ziels (ohne Absender); prüft nebenbei die Berechtigung. */
async function loeseZielAuf(knex, konto, ziel) {
    if (!ziel || ziel.art === 'super_admins') return { anSuperAdmins: true, ids: [] };
    if (!(await darfAnKonten(knex, konto))) throw fehler(403, 'Du darfst nur den Super-Admins schreiben.');
    const eigene = new Set(await vereineAlsAdmin(knex, konto));
    if (ziel.art === 'verein') {
        const vereinId = Number(ziel.vereinId);
        if (!Number.isInteger(vereinId)) throw fehler(400, 'Verein fehlt.');
        const eigenerVerein = konto.super_admin_aktiv || eigene.has(vereinId);
        const mitglieder = await knex('benutzer_vereine').where({ verein_id: vereinId, freigegeben: 1 }).select('benutzer_id', 'rolle');
        const ids = mitglieder.filter((m) => eigenerVerein || rolleReicht(m.rolle, 'admin')).map((m) => m.benutzer_id);
        return { anSuperAdmins: false, ids: ids.filter((i) => i !== konto.id) };
    }
    if (ziel.art === 'personen') {
        const ids = [...new Set((Array.isArray(ziel.benutzerIds) ? ziel.benutzerIds : []).map(String))].filter((i) => i !== konto.id);
        if (ids.length === 0) throw fehler(400, 'Bitte mindestens einen Empfänger wählen.');
        if (ids.length > MAX_PERSONEN) throw fehler(400, `Höchstens ${MAX_PERSONEN} Empfänger je Nachricht.`);
        const mitgliedschaften = await knex('benutzer_vereine').whereIn('benutzer_id', ids).where({ freigegeben: 1 }).select('benutzer_id', 'verein_id', 'rolle');
        for (const id of ids) {
            const m = mitgliedschaften.filter((z) => z.benutzer_id === id);
            const erlaubt = konto.super_admin_aktiv || m.some((z) => eigene.has(z.verein_id) || rolleReicht(z.rolle, 'admin'));
            if (!erlaubt) throw fehler(403, 'Einer der Empfänger darf von dir nicht angeschrieben werden.');
        }
        return { anSuperAdmins: false, ids };
    }
    throw fehler(400, 'Unbekanntes Ziel.');
}

/** Neue Unterhaltung von einem angemeldeten Konto. ziel: { art: 'super_admins' } | { art: 'verein', vereinId } | { art: 'personen', benutzerIds } */
export async function sendeNachricht(knex, konto, { betreff, text, ziel }, { basisUrl = null, sende = sendeMail } = {}) {
    const b = bereinige(betreff, MAX_BETREFF, 'Der Betreff');
    const t = bereinige(text, MAX_TEXT, 'Die Nachricht');
    const { anSuperAdmins, ids } = await loeseZielAuf(knex, konto, ziel);
    if (!anSuperAdmins) {
        const gueltig = await aktiveKonten(knex).whereIn('id', ids).pluck('id');
        if (gueltig.length === 0) throw fehler(400, 'Es gibt keinen Empfänger, der diese Nachricht erhalten kann.');
        ids.splice(0, ids.length, ...gueltig);
    }
    const name = kontoName(konto);
    const thread = await knex.transaction(async (trx) => {
        const [th] = await trx('nachrichten_threads').insert({
            art: anSuperAdmins ? 'kontakt' : 'nachricht', betreff: b, an_super_admins: anSuperAdmins,
            erstellt_von: konto.id, absender_name: name, absender_email: null
        }).returning('*');
        const teilnehmer = [konto.id, ...ids].map((benutzer_id) => ({ thread_id: th.id, benutzer_id }));
        await trx('nachrichten_teilnehmer').insert(teilnehmer);
        const [n] = await trx('nachrichten').insert({ thread_id: th.id, von_benutzer_id: konto.id, von_name: name, text: t }).returning('id');
        await trx('nachrichten_gelesen').insert({ thread_id: th.id, benutzer_id: konto.id, letzte_nachricht_id: typeof n === 'object' ? n.id : n });
        return th;
    });
    await benachrichtige(knex, { thread, absenderId: konto.id, absenderIstSuperAdmin: !!konto.super_admin_aktiv, basisUrl, sende });
    return { id: thread.id };
}

/** Antwort in einer Unterhaltung, die das Konto sieht. */
export async function antworte(knex, konto, threadId, text, { basisUrl = null, sende = sendeMail } = {}) {
    const thread = await pruefeZugriff(knex, konto, threadId);
    const t = bereinige(text, MAX_TEXT, 'Die Nachricht');
    const name = kontoName(konto);
    await knex.transaction(async (trx) => {
        const [n] = await trx('nachrichten').insert({ thread_id: thread.id, von_benutzer_id: konto.id, von_name: name, text: t }).returning('id');
        const nid = typeof n === 'object' ? n.id : n;
        await trx.raw('insert into nachrichten_teilnehmer (thread_id, benutzer_id) values (?, ?) on conflict do nothing', [thread.id, konto.id]);
        await trx.raw(
            `insert into nachrichten_gelesen (thread_id, benutzer_id, letzte_nachricht_id) values (?, ?, ?)
             on conflict (thread_id, benutzer_id) do update set letzte_nachricht_id = excluded.letzte_nachricht_id`,
            [thread.id, konto.id, nid]
        );
        await trx('nachrichten_threads').where({ id: thread.id }).update({ aktualisiert_am: trx.fn.now() });
    });
    await benachrichtige(knex, { thread, absenderId: konto.id, absenderIstSuperAdmin: !!konto.super_admin_aktiv, basisUrl, sende });
    await mailAnAnonymen(thread, t, name, sende);
}

/**
 * Auswahl für das Schreiben: Vereine, die das Konto als Admin verwaltet (mit Mitgliedern), und alle Vereine für
 * Nachrichten an fremde Admins. Ohne Admin-Recht bleibt nur der Kontakt zu den Super-Admins.
 */
export async function ladeEmpfaengerAuswahl(knex, konto) {
    if (!(await darfAnKonten(knex, konto))) return { darfAnKonten: false, eigeneVereine: [], vereine: [] };
    const eigene = konto.super_admin_aktiv
        ? await knex('vereine').pluck('id')
        : await vereineAlsAdmin(knex, konto);
    const vereine = await knex('vereine').select('id', 'name').orderBy('name');
    const mitglieder = await knex('benutzer_vereine as bv').join('benutzer as b', 'b.id', 'bv.benutzer_id')
        .whereIn('bv.verein_id', eigene).where('bv.freigegeben', 1)
        .select('bv.verein_id', 'b.id', 'b.vorname', 'b.nachname', 'bv.rolle');
    const nachVerein = (id) => mitglieder.filter((m) => m.verein_id === id && m.id !== konto.id)
        .map((m) => ({ id: m.id, name: kontoName(m), rolle: m.rolle })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return {
        darfAnKonten: true,
        eigeneVereine: vereine.filter((v) => eigene.includes(v.id)).map((v) => ({ id: v.id, name: v.name, mitglieder: nachVerein(v.id) })),
        vereine
    };
}

/** Admins eines (fremden) Vereins, nur Namen: für die namentliche Auswahl. */
export async function ladeVereinsAdmins(knex, konto, vereinId) {
    if (!(await darfAnKonten(knex, konto))) throw fehler(403, 'Keine Berechtigung.');
    const zeilen = await knex('benutzer_vereine as bv').join('benutzer as b', 'b.id', 'bv.benutzer_id')
        .where({ 'bv.verein_id': vereinId, 'bv.freigegeben': 1 }).whereNot('b.id', konto.id)
        .select('b.id', 'b.vorname', 'b.nachname', 'bv.rolle');
    return zeilen.filter((z) => rolleReicht(z.rolle, 'admin')).map((z) => ({ id: z.id, name: kontoName(z) }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Löscht Unterhaltungen, deren letzte Nachricht älter als `tage` ist; Teilnehmer, Nachrichten und Gelesen-Stände folgen per CASCADE. */
export async function loescheAlteNachrichten(knex, tage = NACHRICHTEN_TAGE) {
    const n = Number(tage);
    if (!Number.isInteger(n) || n < 1) return 0;
    return knex('nachrichten_threads').whereRaw("aktualisiert_am < now() - (? * interval '1 day')", [n]).del();
}

export { ermittleBasisUrl };
