export const config = { transaction: false };

// Super-Admin-Verwaltung: Konten sperren (Login und alle Anfragen werden abgelehnt, Daten bleiben erhalten) und
// Turniere archivieren (verschwinden aus den Turnierlisten, bleiben aber vollständig gespeichert).
export async function up(knex) {
    await knex.schema.alterTable('benutzer', (table) => {
        table.boolean('gesperrt').notNullable().defaultTo(false);
        table.timestamp('gesperrt_am').nullable();
    });
    await knex.schema.alterTable('turniere', (table) => {
        table.boolean('archiviert').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('archiviert');
    });
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('gesperrt_am');
        table.dropColumn('gesperrt');
    });
}
