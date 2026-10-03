export const config = { transaction: false };

export async function up(knex) {
    await knex.schema.createTable('benutzer', (table) => {
        table.string('id').primary();
        table.string('email').notNullable().unique();
        table.string('vorname').nullable();
        table.string('nachname').nullable();
        table.timestamps(true, true);
    });

    await knex.schema.alterTable('turniere', (table) => {
        table.string('benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('benutzer_id');
    });
    await knex.schema.dropTableIfExists('benutzer');
}
