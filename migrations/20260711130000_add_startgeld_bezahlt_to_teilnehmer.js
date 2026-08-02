export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.boolean('startgeld_bezahlt').defaultTo(false);
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('startgeld_bezahlt');
    });
}
