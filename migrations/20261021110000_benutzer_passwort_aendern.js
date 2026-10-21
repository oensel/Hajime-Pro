export const config = { transaction: false };

// Initialpasswort: Setzt ein Super-Admin ein Passwort, muss die Person es beim nächsten Anmelden selbst ändern.
export async function up(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.boolean('muss_passwort_aendern').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('muss_passwort_aendern');
    });
}
