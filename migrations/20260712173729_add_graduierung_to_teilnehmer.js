export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('graduierung').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('graduierung');
    });
}
