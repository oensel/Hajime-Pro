// Aktionsprotokoll (nur Cloud): jede schreibende Aktion eines angemeldeten Kontos (Super-Admin, Admin, Benutzer, Helfer) und die
// Anmeldeereignisse (Login, 2FA, Passwort, Notfall-Schlüssel) landen in der Tabelle aktionsprotokoll.
//   - Die Middleware protokolliert nach der Antwort jede erfolgreiche POST/PUT/PATCH/DELETE-Anfrage mit angemeldetem Konto.
//     Gespeichert werden nur Route (IDs als :id), die IDs, Turnier/Verein und ein Klartext; nie der Body (Passwörter!) und keine Antwort.
//   - Anmeldeereignisse schreibt der Auth-Controller ausdrücklich (`protokolliere`), weil dort noch kein Konto angemeldet ist.
//   - Sichtbar: Super-Admin alles, Admin die Einträge seiner Vereine (verein_id); Aufbewahrung PROTOKOLL_AUFBEWAHRUNG_TAGE (Standard 365).
// Ein Fehler beim Protokollieren darf nie eine Aktion stören: alles hier fängt Fehler ab und meldet sie nur im Log.
import { istSuperAdminAktiv } from '../utils/vereinHelper.js';

export const STANDARD_AUFBEWAHRUNG_TAGE = 365;
const SCHREIBEND = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Rauschen und Dienste ohne Konto: Uplink/Teilnehmer-App, Sync, Video, Durchsage, Cluster
const IGNORIERT = [/^\/api\/live(\/|$)/, /^\/api\/sync(\/|$)/, /^\/api\/video(\/|$)/, /^\/api\/durchsage(\/|$)/, /^\/api\/cluster(\/|$)/, /^\/db(\/|$)/];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ROLLEN_ANZEIGE = { super_admin: 'Super-Admin', admin: 'Admin', benutzer: 'Benutzer', helfer: 'Helfer' };

// --- Klartexte ---
const AKTIONEN = {
    'POST /api/turniere': ['turnier.anlegen', 'Turnier angelegt'],
    'POST /api/turniere/import': ['turnier.import', 'Turnier importiert'],
    'PUT /api/turniere/:id': ['turnier.aendern', 'Turnier geändert'],
    'DELETE /api/turniere/:id': ['turnier.loeschen', 'Turnier gelöscht'],
    'POST /api/turniere/:id/teilen': ['turnier.teilen', 'Turnier per Mail geteilt'],
    'POST /api/turniere/:id/duplizieren': ['turnier.duplizieren', 'Turnier dupliziert'],
    'POST /api/turniere/:id/import-ergebnisse': ['turnier.ergebnisse', 'Turnierergebnisse importiert'],
    'PUT /api/auth/profile': ['profil.aendern', 'Profil geändert'],
    'POST /api/auth/steuerung-passwort': ['steuerung.passwort', 'Turnierleitungs-Passwort geändert'],
    'POST /api/auth/2fa/backup-codes': ['2fa.backupcodes', 'Neue Backup-Codes für die Zwei-Faktor-Anmeldung erzeugt'],
    'POST /api/vereine/rolle': ['verein.rolle', 'Rolle im Verein geändert'],
    'POST /api/vereine/einladungen': ['verein.einladung', 'Einladung verschickt'],
    'POST /api/vereine/aktiv': ['verein.wechsel', 'Aktiven Verein bzw. Modus gewechselt'],
    'POST /api/nutzer/:id/super-admin': ['nutzer.superadmin', 'Super-Admin-Recht geändert'],
    'POST /api/nutzer/:id/passwort': ['nutzer.passwort', 'Initialpasswort vergeben'],
    'POST /api/nutzer/:id/passwort-mail': ['nutzer.passwortmail', 'Mail zum Zurücksetzen des Passworts angestoßen'],
    'POST /api/nutzer/:id/mitgliedschaft': ['nutzer.zuweisen', 'Konto einem Verein zugewiesen'],
    'DELETE /api/nutzer/:id/mitgliedschaft/:id': ['nutzer.entfernen', 'Konto aus einem Verein entfernt'],
    'POST /api/nutzer/:id/sperren': ['nutzer.sperren', 'Konto gesperrt bzw. entsperrt'],
    'POST /api/nutzer/:id/bestaetigen': ['nutzer.bestaetigen', 'E-Mail-Adresse von Hand bestätigt'],
    'POST /api/nutzer/:id/bestaetigungs-mail': ['nutzer.bestaetigungsmail', 'Bestätigungsmail erneut gesendet'],
    'POST /api/nutzer/:id/2fa-zuruecksetzen': ['nutzer.2fa', 'Zwei-Faktor-Anmeldung eines Kontos zurückgesetzt'],
    'PUT /api/nutzer/:id': ['nutzer.aendern', 'Benutzer bearbeitet'],
    'DELETE /api/nutzer/:id': ['nutzer.loeschen', 'Benutzer gelöscht'],
    'DELETE /api/nutzer/unbestaetigte': ['nutzer.aufraeumen', 'Unbestätigte Konten gelöscht'],
    'POST /api/nutzer/vereine': ['verein.anlegen', 'Verein angelegt'],
    'POST /api/nutzer/vereine/import': ['verein.import', 'Vereine importiert'],
    'PUT /api/nutzer/vereine/:id': ['verein.aendern', 'Verein geändert'],
    'DELETE /api/nutzer/vereine/:id': ['verein.loeschen', 'Verein gelöscht'],
    'POST /api/nutzer/vereine/:id/zusammenfuehren': ['verein.zusammenfuehren', 'Vereine zusammengeführt'],
    'POST /api/nutzer/turniere/:id/archivieren': ['turnier.archivieren', 'Turnier archiviert bzw. wiederhergestellt'],
    'DELETE /api/nutzer/turniere/:id': ['turnier.loeschen', 'Turnier endgültig gelöscht'],
    'POST /api/sicherung/erstellen': ['sicherung.erstellen', 'Sicherung auf dem Server abgelegt'],
    'POST /api/sicherung/herunterladen': ['sicherung.herunterladen', 'Sicherung heruntergeladen'],
    'POST /api/sicherung/dateien/:id/herunterladen': ['sicherung.herunterladen', 'Sicherung heruntergeladen'],
    'POST /api/sicherung/wiederherstellen': ['sicherung.wiederherstellen', 'Sicherung wiedereingespielt (alle Daten ersetzt)'],
    'POST /api/cloud-update/start': ['server.update', 'Server-Update gestartet'],
    'POST /api/sicherung/automatisch-jetzt': ['sicherung.automatik', 'Automatische Sicherung von Hand gestartet'],
    'DELETE /api/konsole': ['konsole.leeren', 'Fehlerprotokoll (Konsole) geleert']
};
const RESSOURCEN = {
    turniere: 'Turnier', teilnehmer: 'Teilnehmer', pools: 'Pool', kampfflaechen: 'Matte', kaempfe: 'Kampf', mannschaften: 'Mannschaft',
    mannschaftskaempfe: 'Mannschaftskampf', orga: 'Orga-Aufgabe', 'helfer-plan': 'Helferplan', helfer: 'Helfer-App', urkunden: 'Urkunden',
    vereine: 'Verein', nutzer: 'Benutzer', freigabe: 'Freischaltung', auth: 'Konto', sicherung: 'Sicherung', einladung: 'Einladung'
};
const VERBEN = { POST: 'angelegt bzw. ausgeführt', PUT: 'geändert', PATCH: 'geändert', DELETE: 'gelöscht' };

/** Pfad ohne Query, mit :id statt Zahlen/UUIDs und :token statt langer Zufallstexte; dazu die gefundenen IDs. */
export function normalisierePfad(url) {
    const pfad = String(url || '').split('?')[0];
    const ids = [];
    const teile = pfad.split('/').map((teil) => {
        if (/^\d+$/.test(teil) || UUID.test(teil)) { ids.push(teil); return ':id'; }
        if (/^[A-Za-z0-9_-]{24,}$/.test(teil)) return ':token';
        return teil;
    });
    return { pfad: teile.join('/'), ids };
}

/** @returns {{ aktion: string, beschreibung: string }} */
export function beschreibeAktion(methode, normPfad) {
    const bekannt = AKTIONEN[`${methode} ${normPfad}`];
    if (bekannt) return { aktion: bekannt[0], beschreibung: bekannt[1] };
    const teile = normPfad.split('/').filter(Boolean); // ['api', 'turniere', ':id', 'xyz']
    const ressource = RESSOURCEN[teile[1]] || teile[1] || 'Daten';
    const unterpunkte = teile.slice(2).filter((t) => !t.startsWith(':'));
    const zusatz = unterpunkte.length ? `: ${unterpunkte.join(' ')}` : '';
    return {
        aktion: `${teile[1] || 'api'}.${methode.toLowerCase()}${unterpunkte.length ? `.${unterpunkte.join('.')}` : ''}`,
        beschreibung: `${ressource}${zusatz} ${VERBEN[methode] || 'bearbeitet'}`
    };
}

export function istProtokollierbar(methode, pfad) {
    return SCHREIBEND.has(methode) && !IGNORIERT.some((muster) => muster.test(pfad));
}

// --- Schreiben ---
/** Legt einen Eintrag an. Fehler werden nur geloggt. */
export async function protokolliere(knex, eintrag) {
    try {
        await knex('aktionsprotokoll').insert({
            benutzer_id: eintrag.benutzerId ?? null,
            benutzer_name: eintrag.benutzerName ?? null,
            benutzer_email: eintrag.benutzerEmail ?? null,
            rolle: eintrag.rolle ?? null,
            verein_id: eintrag.vereinId ?? null,
            verein_name: eintrag.vereinName ?? null,
            turnier_id: eintrag.turnierId ?? null,
            aktion: eintrag.aktion,
            beschreibung: eintrag.beschreibung,
            methode: eintrag.methode ?? null,
            pfad: eintrag.pfad ? String(eintrag.pfad).slice(0, 300) : null,
            status: eintrag.status ?? null,
            ip: eintrag.ip ?? null,
            details: JSON.stringify(eintrag.details || {})
        });
    } catch (err) {
        console.error('[Protokoll] Eintrag fehlgeschlagen:', err.message);
    }
}

/** Name, Rolle und Verein eines Kontos als Momentaufnahme (für Eintrag und Anmeldeereignisse). */
export async function ladeKontext(knex, benutzerId, { vereinId = null, turnierId = null } = {}) {
    const benutzer = await knex('benutzer').where({ id: benutzerId })
        .first('id', 'vorname', 'nachname', 'email', 'ist_super_admin', 'super_admin_modus', 'aktiver_verein_id');
    if (!benutzer) return null;
    const superAktiv = istSuperAdminAktiv(benutzer);
    let verein = vereinId;
    if (verein == null && turnierId != null) {
        const turnier = await knex('turniere').where({ id: turnierId }).first('verein_id');
        verein = turnier ? turnier.verein_id : null;
    }
    // Eine Vereinsangabe aus der Anfrage zählt nur, wenn der Handelnde dort freigegebenes Mitglied (oder Super-Admin) ist; sonst könnte jemand
    // Einträge in der Sicht eines fremden Vereins erzeugen. Dann gilt der aktive Verein.
    if (verein != null && !superAktiv) {
        const mitglied = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: verein }).first('freigegeben');
        if (!mitglied || !mitglied.freigegeben) verein = null;
    }
    // Im Super-Admin-Modus gehört eine Aktion ohne erkennbaren Verein keinem Verein; sonst dem aktiven Verein.
    if (verein == null && !superAktiv) verein = benutzer.aktiver_verein_id;
    let rolle = superAktiv ? 'super_admin' : null;
    if (!rolle && verein != null) {
        const m = await knex('benutzer_vereine').where({ benutzer_id: benutzerId, verein_id: verein }).first('rolle', 'freigegeben');
        rolle = m && m.freigegeben ? m.rolle : null;
    }
    const vereinZeile = verein != null ? await knex('vereine').where({ id: verein }).first('name') : null;
    return {
        benutzerId,
        benutzerName: `${benutzer.vorname || ''} ${benutzer.nachname || ''}`.trim() || benutzer.email,
        benutzerEmail: benutzer.email,
        rolle,
        vereinId: verein ?? null,
        vereinName: vereinZeile ? vereinZeile.name : null
    };
}

const ganzzahl = (w) => (/^\d+$/.test(String(w ?? '')) && Number(w) <= 2147483647 ? Number(w) : null);

/** Express-Middleware: protokolliert nach der Antwort jede erfolgreiche schreibende Anfrage eines angemeldeten Kontos. */
export function erzeugeProtokollMiddleware(knex) {
    return async (req, res, next) => {
        const methode = req.method;
        const url = req.originalUrl || req.url;
        const { pfad, ids } = normalisierePfad(url);
        if (!istProtokollierbar(methode, String(url).split('?')[0])) return next();
        // Das Ziel eines Benutzer-Eingriffs vor dem Löschen merken (Name/E-Mail), sonst fehlt es im Eintrag
        const zielId = pfad.startsWith('/api/nutzer/') ? ids.find((i) => UUID.test(i)) : null;
        // Abgewartet, bevor die Anfrage weiterläuft: sonst kann das Löschen vor der Abfrage durchlaufen (Wettlauf um die Datenbankverbindung).
        const ziel = zielId ? await knex('benutzer').where({ id: zielId }).first('vorname', 'nachname', 'email').catch(() => null) : null;

        res.on('finish', async () => {
            try {
                if (!req.user || !req.user.id || res.statusCode >= 400) return;
                const body = req.body && typeof req.body === 'object' ? req.body : {};
                const query = req.query || {};
                const turnierId = pfad.startsWith('/api/turniere/') || pfad.startsWith('/api/nutzer/turniere/')
                    ? ganzzahl(ids.find((i) => /^\d+$/.test(i)))
                    : ganzzahl(body.turnierId ?? body.turnier_id ?? query.turnierId);
                const vereinId = pfad.startsWith('/api/nutzer/vereine/') ? ganzzahl(ids.find((i) => /^\d+$/.test(i)))
                    : ganzzahl(body.vereinId ?? query.vereinId);
                const kontext = await ladeKontext(knex, req.user.id, { vereinId, turnierId });
                if (!kontext) return;
                const { aktion, beschreibung } = beschreibeAktion(methode, pfad);
                const details = { ids };
                if (ziel) details.ziel = `${ziel.vorname || ''} ${ziel.nachname || ''}`.trim() + ` <${ziel.email}>`;
                if (turnierId != null) details.turnierId = turnierId;
                await protokolliere(knex, { ...kontext, turnierId, aktion, beschreibung, methode, pfad, status: res.statusCode, details });
            } catch (err) {
                console.error('[Protokoll] Middleware-Fehler:', err.message);
            }
        });
        next();
    };
}

// --- Anmeldeereignisse ---
/**
 * Schreibt ein Ereignis zu einem (ggf. noch nicht angemeldeten) Konto, z. B. Login oder Passwort-Reset.
 * `konto` = benutzer-Zeile oder null (unbekannte Adresse); `adresse` = die eingegebene E-Mail bei unbekanntem Konto.
 */
export async function protokolliereKonto(knex, { konto = null, adresse = null, vereinId = null, aktion, beschreibung, ip = null, status = null, details = {} }) {
    try {
        let kontext = konto ? await ladeKontext(knex, konto.id) : null;
        if (!kontext && vereinId != null) {
            const verein = await knex('vereine').where({ id: vereinId }).first('name');
            kontext = { benutzerEmail: adresse ? String(adresse).slice(0, 254) : null, vereinId, vereinName: verein ? verein.name : null };
        }
        await protokolliere(knex, {
            ...(kontext || { benutzerEmail: adresse ? String(adresse).slice(0, 254) : null }),
            aktion, beschreibung, ip, status, details
        });
    } catch (err) {
        console.error('[Protokoll] Ereignis fehlgeschlagen:', err.message);
    }
}

// --- Lesen ---
export const EINTRAEGE_JE_SEITE = 50;

/**
 * @param {{ superAdmin: boolean, vereinIds: number[] }} scope
 * @param {{ seite?: number, proSeite?: number, von?: string, bis?: string, benutzer?: string, suche?: string, vereinId?: number|null }} filter
 */
export async function listeProtokoll(knex, scope, filter = {}) {
    const proSeite = Math.min(200, Math.max(1, Number(filter.proSeite) || EINTRAEGE_JE_SEITE));
    const seite = Math.max(1, Number(filter.seite) || 1);
    const abfrage = () => {
        const q = knex('aktionsprotokoll');
        if (!scope.superAdmin) q.whereIn('verein_id', scope.vereinIds.length ? scope.vereinIds : [-1]);
        if (filter.vereinId != null) q.where('verein_id', filter.vereinId);
        if (filter.von && /^\d{4}-\d{2}-\d{2}$/.test(filter.von)) q.where('zeitpunkt', '>=', `${filter.von} 00:00:00`);
        if (filter.bis && /^\d{4}-\d{2}-\d{2}$/.test(filter.bis)) q.where('zeitpunkt', '<', knex.raw("(?::date + 1)", [filter.bis]));
        const wie = (text) => `%${String(text).trim().replace(/[\\%_]/g, (z) => `\\${z}`)}%`;
        if (filter.benutzer && String(filter.benutzer).trim()) {
            q.where((b) => b.whereILike('benutzer_name', wie(filter.benutzer)).orWhereILike('benutzer_email', wie(filter.benutzer)));
        }
        if (filter.suche && String(filter.suche).trim()) {
            q.where((b) => b.whereILike('beschreibung', wie(filter.suche)).orWhereILike('aktion', wie(filter.suche)).orWhereRaw('details::text ILIKE ?', [wie(filter.suche)]));
        }
        return q;
    };
    const gesamt = parseInt((await abfrage().count('* as n').first()).n, 10);
    const zeilen = await abfrage().orderBy([{ column: 'zeitpunkt', order: 'desc' }, { column: 'id', order: 'desc' }])
        .limit(proSeite).offset((seite - 1) * proSeite)
        .select('id', 'zeitpunkt', 'benutzer_name', 'benutzer_email', 'rolle', 'verein_id', 'verein_name', 'turnier_id', 'aktion', 'beschreibung', 'methode', 'status', 'details');
    return {
        gesamt, seite, proSeite, seiten: Math.max(1, Math.ceil(gesamt / proSeite)),
        eintraege: zeilen.map((z) => ({ ...z, zeitpunkt: new Date(z.zeitpunkt).toISOString(), id: String(z.id) }))
    };
}

// --- Aufbewahrung ---
export async function bereinigeProtokoll(knex, tage = STANDARD_AUFBEWAHRUNG_TAGE) {
    const n = Number(tage);
    if (!Number.isFinite(n) || n < 1) return 0;
    return knex('aktionsprotokoll').where('zeitpunkt', '<', knex.raw("now() - (? * interval '1 day')", [n])).del();
}
