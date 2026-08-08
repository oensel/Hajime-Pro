export const config = { transaction: false };

// Ergänzt die bereits bestehende "bundesland"-Spalte (siehe
// 20260709174000_add_tournament_fields_and_club_auth.js) um eine Postleitzahl — zusammen bilden
// beide die Grundlage für die Entfernungsanzeige in der Turnierübersicht (siehe
// src/utils/entfernungHelper.js).
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('plz', 5).nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('plz');
    });
}
