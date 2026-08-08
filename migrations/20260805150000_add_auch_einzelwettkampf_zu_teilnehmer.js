export const config = { transaction: false };

// Opt-in für Mannschaftsmitglieder (siehe mannschaft_mitglieder), die ZUSÄTZLICH auch an der
// Einzelwettkampf-Poolauslosung teilnehmen sollen. Ohne dieses Flag werden Mannschaftsmitglieder
// bei der Poolgenerierung übersprungen (siehe generierePools in poolController.js) — Standardfall
// ist also "nur Mannschaft". Für Teilnehmer, die (noch) keiner Mannschaft angehören, hat das Flag
// keine Wirkung.
export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.boolean('auch_einzelwettkampf').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('auch_einzelwettkampf');
    });
}
