import { istGueltigeRolle, rolleReicht, ROLLEN } from '../shared/rollen.js';

/**
 * Wirksamer Super-Admin: das Konto ist Super-Admin UND arbeitet gerade im Super-Admin-Modus. In einem Verein
 * (super_admin_modus = false) gelten nur die Rechte der Vereinsrolle.
 * @param {{ ist_super_admin?: any, super_admin_modus?: any }|null|undefined} benutzer Zeile aus `benutzer`
 * @returns {boolean}
 */
export function istSuperAdminAktiv(benutzer) {
    return !!(benutzer && benutzer.ist_super_admin && benutzer.super_admin_modus);
}

/**
 * Resolves a user's club name via the vereine table (verein_id) — the single source of
 * truth for a user's club (the legacy free-text benutzer.verein column has been removed).
 * @param {Object} knex - Knex instance
 * @param {Object} user - Row from the benutzer table
 * @returns {Promise<string|null>}
 */
export async function resolveUserVereinName(knex, user) {
    if (!user || !user.verein_id) return null;
    const verein = await knex('vereine').where({ id: user.verein_id }).first();
    return verein ? verein.name : null;
}

/**
 * Vereinsname des aktiven Vereins, aber nur, wenn der Benutzer dort Verwaltungsrechte hat (freigegeben,
 * Rolle mindestens 'benutzer'). Für alle Rechte-Pfade "eigener Verein" (Teilnehmer/Mannschaften eines
 * Fremdvereins anmelden, ändern, zurückziehen): ein reiner Helfer oder ein noch nicht freigegebenes
 * Mitglied gilt dort wie ein Konto ohne Verein.
 * @param {Object} knex - Knex instance
 * @param {Object} user - Ergebnis von ladeBenutzerMitAktivemVerein
 * @returns {Promise<string|null>}
 */
export async function ladeVerwaltendenVereinsnamen(knex, user) {
    if (!user || !rolleReicht(user.verein_rolle, 'benutzer')) return null;
    return resolveUserVereinName(knex, user);
}

/**
 * Lädt einen Benutzer inkl. seines aktiven Vereins (benutzer.aktiver_verein_id) und liefert
 * ihn in der historischen Form { ...benutzer, verein_id, verein_freigegeben } zurück, damit
 * resolveUserVereinName/hatVereinsZugriffAufTurnier sowie alle direkten user.verein_id-
 * Vergleiche im Code unverändert weiterlaufen — seit der Umstellung auf n:m-Mitgliedschaften
 * (benutzer_vereine) bedeuten diese beiden Felder jetzt "Status im aktiven Verein" statt
 * "der eine Verein des Nutzers". Einziger Ersatz für das frühere
 * knex('benutzer').where({id}).first() überall dort, wo Vereins-Zugehörigkeit geprüft wird.
 * @param {Object} knex - Knex instance
 * @param {string|number} benutzerId
 * @returns {Promise<Object|undefined>}
 */
export async function ladeBenutzerMitAktivemVerein(knex, benutzerId) {
    const rohBenutzer = await knex('benutzer').where({ id: benutzerId }).first();
    if (!rohBenutzer) return rohBenutzer;
    // Neben dem Konto-Merkmal ist_super_admin gilt für alle Rechteprüfungen super_admin_aktiv (Super-Admin-Modus).
    const benutzer = { ...rohBenutzer, super_admin_aktiv: istSuperAdminAktiv(rohBenutzer) };

    if (!benutzer.aktiver_verein_id) {
        return { ...benutzer, verein_id: null, verein_freigegeben: 0, verein_rolle: null };
    }

    const mitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzer.id, verein_id: benutzer.aktiver_verein_id })
        .first();

    const freigegeben = mitgliedschaft ? mitgliedschaft.freigegeben : 0;
    return {
        ...benutzer,
        verein_id: benutzer.aktiver_verein_id,
        verein_freigegeben: freigegeben,
        // Rolle im aktiven Verein; solange die Mitgliedschaft nicht freigegeben ist, gibt es keine.
        verein_rolle: freigegeben && istGueltigeRolle(mitgliedschaft.rolle) ? mitgliedschaft.rolle : null
    };
}

/**
 * Liefert alle Vereinsmitgliedschaften eines Benutzers (für den Vereinswechsler in der
 * Kopfleiste und die Profilseite), inkl. Vereinsname und Freigabe-Status je Mitgliedschaft.
 * @param {Object} knex - Knex instance
 * @param {string|number} benutzerId
 * @returns {Promise<Array<{verein_id: number, name: string, freigegeben: boolean, rolle: string|null}>>}
 */
export async function ladeVereineFuerBenutzer(knex, benutzerId) {
    const zeilen = await knex('benutzer_vereine')
        .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
        .where({ 'benutzer_vereine.benutzer_id': benutzerId })
        .select('vereine.id as verein_id', 'vereine.name', 'benutzer_vereine.freigegeben', 'benutzer_vereine.rolle')
        .orderBy('vereine.name');

    return zeilen.map(z => ({
        verein_id: z.verein_id,
        name: z.name,
        freigegeben: !!z.freigegeben,
        rolle: z.freigegeben && istGueltigeRolle(z.rolle) ? z.rolle : null
    }));
}

/**
 * Setzt den aktiven Verein eines Benutzers (Auswahl in der Kopfleiste). Erlaubt nur den
 * Wechsel zu einem Verein, in dem der Benutzer tatsächlich Mitglied ist (freigegeben oder
 * wartend — der Status selbst wird weiterhin separat geprüft, hier geht es nur um die Sicht).
 * Auch ein Verein, in dem der Benutzer nur Helfer ist, lässt sich wählen: die Rechte ergeben sich
 * allein aus der Rolle dieser Mitgliedschaft (verein_rolle), nicht daraus, dass er aktiv ist.
 * @param {Object} knex - Knex instance
 * @param {string|number} benutzerId
 * @param {number} vereinId
 * @throws {Error} wenn der Benutzer kein Mitglied dieses Vereins ist
 */
export async function setzeAktivenVerein(knex, benutzerId, vereinId) {
    const mitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzerId, verein_id: vereinId })
        .first();

    if (!mitgliedschaft) {
        throw new Error('Sie sind kein Mitglied dieses Vereins.');
    }

    // Ein Vereinswechsel beendet den Super-Admin-Modus (Rechte nur noch laut Rolle in diesem Verein).
    await knex('benutzer').where({ id: benutzerId }).update({ aktiver_verein_id: vereinId, super_admin_modus: false });
}

/**
 * Schaltet einen Super-Admin in den Super-Admin-Modus (aktiver_verein_id bleibt als Rückweg erhalten).
 * @throws {Error} wenn das Konto kein Super-Admin ist
 */
export async function setzeSuperAdminModus(knex, benutzerId) {
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first('ist_super_admin');
    if (!benutzer || !benutzer.ist_super_admin) {
        throw new Error('Nur Super-Admins können in den Super-Admin-Modus wechseln.');
    }
    await knex('benutzer').where({ id: benutzerId }).update({ super_admin_modus: true });
}

/**
 * Zugriffsregel für die Verwaltung von Turnieren: ein Benutzer darf ein Turnier verwalten, wenn
 * - er im Super-Admin-Modus ist (super_admin_aktiv, alle Vereine), oder
 * - sein aktiver Verein der Ausrichter ist (turnier.verein_id), seine Mitgliedschaft dort freigegeben
 *   ist und mindestens die Rolle 'benutzer' hat. Reine Helfer haben kein Verwaltungsrecht.
 * @param {Object} user - Ergebnis von ladeBenutzerMitAktivemVerein (verein_id, verein_freigegeben, verein_rolle)
 * @param {Object} turnier - Row from the turniere table (needs verein_id)
 * @returns {boolean}
 */
export function hatVereinsZugriffAufTurnier(user, turnier) {
    if (!user || !turnier) return false;
    if (user.super_admin_aktiv) return true;
    return !!(
        user.verein_freigegeben && user.verein_id &&
        turnier.verein_id && user.verein_id === turnier.verein_id &&
        rolleReicht(user.verein_rolle, 'benutzer')
    );
}

/**
 * Helfer-Zugriff auf einen Verein (Helfer-App): jede freigegebene Mitgliedschaft, gleich welche
 * Rolle, oder Super-Admin.
 * @returns {Promise<boolean>}
 */
export async function hatHelferZugriffAufVerein(knex, benutzerId, vereinId) {
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    if (!benutzer) return false;
    if (istSuperAdminAktiv(benutzer)) return true;
    const mitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzerId, verein_id: vereinId, freigegeben: 1 })
        .first();
    return !!(mitgliedschaft && istGueltigeRolle(mitgliedschaft.rolle));
}

/**
 * IDs der Vereine, in denen der Benutzer freigegebenes Mitglied mit mindestens der verlangten Rolle
 * ist. Nur Mitgliedschaften: der Super-Admin bekommt hier keine Sonderbehandlung (Aufrufer prüfen
 * ist_super_admin selbst).
 * @param {'helfer'|'benutzer'|'admin'} mindestens
 * @returns {Promise<number[]>}
 */
export async function ladeVereinIdsMitRolle(knex, benutzerId, mindestens) {
    const zeilen = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzerId, freigegeben: 1 })
        .select('verein_id', 'rolle');
    return zeilen.filter(z => rolleReicht(z.rolle, mindestens)).map(z => z.verein_id);
}

/** Freigegebenes Mitglied des Vereins mit gültiger Rolle (gemeinsames Prädikat für Zuweisen und Mitgliederliste). */
export async function istFreigegebenesMitglied(knex, benutzerId, vereinId) {
    if (benutzerId == null || vereinId == null) return false;
    const m = await knex('benutzer_vereine')
        .where({ benutzer_id: String(benutzerId), verein_id: vereinId, freigegeben: 1 }).first('rolle');
    return !!(m && istGueltigeRolle(m.rolle));
}

/** Rollen, die ein freigegebenes Mitglied haben kann (für whereIn in Mitgliederlisten). */
export const MITGLIED_ROLLEN = ROLLEN;
