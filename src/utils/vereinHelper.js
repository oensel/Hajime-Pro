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
    const benutzer = await knex('benutzer').where({ id: benutzerId }).first();
    if (!benutzer) return benutzer;

    if (!benutzer.aktiver_verein_id) {
        return { ...benutzer, verein_id: null, verein_freigegeben: 0 };
    }

    const mitgliedschaft = await knex('benutzer_vereine')
        .where({ benutzer_id: benutzer.id, verein_id: benutzer.aktiver_verein_id })
        .first();

    return {
        ...benutzer,
        verein_id: benutzer.aktiver_verein_id,
        verein_freigegeben: mitgliedschaft ? mitgliedschaft.freigegeben : 0
    };
}

/**
 * Liefert alle Vereinsmitgliedschaften eines Benutzers (für den Vereinswechsler in der
 * Kopfleiste und die Profilseite), inkl. Vereinsname und Freigabe-Status je Mitgliedschaft.
 * @param {Object} knex - Knex instance
 * @param {string|number} benutzerId
 * @returns {Promise<Array<{verein_id: number, name: string, freigegeben: boolean}>>}
 */
export async function ladeVereineFuerBenutzer(knex, benutzerId) {
    const zeilen = await knex('benutzer_vereine')
        .join('vereine', 'vereine.id', 'benutzer_vereine.verein_id')
        .where({ 'benutzer_vereine.benutzer_id': benutzerId })
        .select('vereine.id as verein_id', 'vereine.name', 'benutzer_vereine.freigegeben')
        .orderBy('vereine.name');

    return zeilen.map(z => ({ verein_id: z.verein_id, name: z.name, freigegeben: !!z.freigegeben }));
}

/**
 * Setzt den aktiven Verein eines Benutzers (Auswahl in der Kopfleiste). Erlaubt nur den
 * Wechsel zu einem Verein, in dem der Benutzer tatsächlich Mitglied ist (freigegeben oder
 * wartend — der Status selbst wird weiterhin separat geprüft, hier geht es nur um die Sicht).
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

    await knex('benutzer').where({ id: benutzerId }).update({ aktiver_verein_id: vereinId });
}

/**
 * Einzige Zugriffsregel für Turniere: ein Benutzer darf ein Turnier verwalten, wenn er ein
 * freigegebenes Mitglied desselben Vereins ist, der das Turnier ausrichtet (turnier.verein_id).
 * Es gibt keinen separaten "Besitzer" mehr — die Zugehörigkeit zum Verein allein entscheidet.
 * @param {Object} user - Row from the benutzer table
 * @param {Object} turnier - Row from the turniere table (needs verein_id)
 * @returns {boolean}
 */
export function hatVereinsZugriffAufTurnier(user, turnier) {
    return !!(
        user && user.verein_freigegeben && user.verein_id &&
        turnier && turnier.verein_id && user.verein_id === turnier.verein_id
    );
}
