export const config = { transaction: false };

export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    await knex.schema.alterTable('benutzer', (table) => {
        table.string('verein').nullable();
    });

    await knex.schema.alterTable('turniere', (table) => {
        table.string('bundesland').nullable();
        table.text('altersklassen').nullable(); // Stores JSON array as text
        table.string('status').notNullable().defaultTo('anmeldung_offen');
    });

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.string('registriert_von_benutzer_id').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
    });

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}

export async function down(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }

    await knex.schema.alterTable('turnier_teilnehmer', (table) => {
        table.dropColumn('registriert_von_benutzer_id');
    });

    await knex.schema.alterTable('turniere', (table) => {
        table.dropColumn('bundesland');
        table.dropColumn('altersklassen');
        table.dropColumn('status');
    });

    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('verein');
    });

    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}
