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
