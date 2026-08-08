export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.text('mannschafts_altersklassen').nullable(); // Stores JSON array as text, analog zu "altersklassen"
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('mannschafts_altersklassen');
    });
}
