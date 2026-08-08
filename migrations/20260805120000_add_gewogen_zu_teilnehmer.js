export const config = { transaction: false };

// Eigenständiges "gewogen"-Flag, getrennt von der Lizenz-Bestätigung (siehe lizenz_ablauf-Toggle
// in teilnehmer.js) und vom reinen gewicht-Wert (der z.B. aus einem CSV-Import bereits gesetzt
// sein kann, ohne dass der Judoka tatsächlich an der Waage war).
export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.boolean('gewogen').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('gewogen');
    });
}
