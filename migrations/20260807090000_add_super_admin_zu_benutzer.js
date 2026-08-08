export const config = { transaction: false };

// Markiert Benutzer, die Erstregistrierungen neuer Vereine prüfen dürfen (Bootstrapping-Rolle,
// siehe ensureSuperAdmin in src/utils/superAdmin.js). Unabhängig von jeder Vereinsmitgliedschaft.
export async function up(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.boolean('ist_super_admin').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('ist_super_admin');
    });
}
