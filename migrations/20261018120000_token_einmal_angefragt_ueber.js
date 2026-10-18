export const config = { transaction: false };

// Helferverwaltung: der E-Mail-Bestätigungs-Token merkt sich, über welche Oberfläche registriert wurde
// ('helfer-app' | 'verwaltung'). Die Mitgliedschaft (benutzer_vereine.angefragt_ueber) entsteht erst nach
// der Bestätigung (Spec Abschnitt 4, Punkt 3), bis dahin muss die Angabe am Token hängen.
export async function up(knex) {
    await knex.schema.alterTable('token_einmal', (table) => {
        table.string('angefragt_ueber').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('token_einmal', (table) => {
        table.dropColumn('angefragt_ueber');
    });
}
