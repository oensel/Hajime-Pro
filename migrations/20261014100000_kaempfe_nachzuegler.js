// Nachzügler in einem laufenden Jeder-gegen-Jeden-Pool (docs/specs/2026-10-14-nachzuegler-laufender-pool.md):
// die zusätzlichen Kämpfe des Nachzüglers sind gekennzeichnet, damit die Mattenplanung sie zwischen die übrigen
// Kämpfe des Pools verteilt statt hinten anzuhängen.
export async function up(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.boolean('nachzuegler').notNullable().defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => { table.dropColumn('nachzuegler'); });
}
