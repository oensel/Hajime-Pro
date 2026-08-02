export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('anmeldeschluss').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('anmeldeschluss');
    });
}
