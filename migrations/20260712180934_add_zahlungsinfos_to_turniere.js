export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.decimal('startgeld', 6, 2).nullable();
        table.string('iban').nullable();
        table.string('kontoinhaber').nullable();
        table.string('verwendungszweck').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('startgeld');
        table.dropColumn('iban');
        table.dropColumn('kontoinhaber');
        table.dropColumn('verwendungszweck');
    });
}
