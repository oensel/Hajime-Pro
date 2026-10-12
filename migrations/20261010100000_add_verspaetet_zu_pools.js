// Sammelpool "Verspätet" für Nachzügler (docs/specs/2026-10-10-nachzuegler-pool-design.md): das Kennzeichen steuert
// die Ausblendung in allen Anzeigen außer der Pool-Verwaltung, unabhängig vom Namen des Pools.
export async function up(knex) {
    await knex.schema.alterTable('pools', (table) => {
        table.boolean('verspaetet').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => { table.dropColumn('verspaetet'); });
}
