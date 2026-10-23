// Unbestätigte Konten (E-Mail-Adresse nie bestätigt) werden nach 30 Tagen gelöscht (Datenschutzerklärung, Abschnitt 3): täglicher Lauf in der Cloud
// (app.js) und der Knopf „Unbestätigte aufräumen“ der Super-Admins (nutzerController.js). Super-Admin-Konten sind ausgenommen; Mitgliedschaften
// und Einmal-Token folgen per CASCADE.
export const UNBESTAETIGT_TAGE = 30;

/** @returns {Promise<number>} Anzahl gelöschter Konten */
export async function loescheUnbestaetigteKonten(knex, tage = UNBESTAETIGT_TAGE) {
    const n = Number(tage);
    if (!Number.isInteger(n) || n < 1) return 0;
    return knex('benutzer')
        .whereNull('email_bestaetigt_am')
        .where({ ist_super_admin: false })
        .whereRaw("created_at < now() - (? * interval '1 day')", [n])
        .del();
}
