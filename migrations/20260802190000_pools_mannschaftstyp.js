// Diskriminator für Mannschafts-Pools (Team vs. Team) neben den bisherigen Einzelwettkampf-
// Pools. gewichtsklasse bleibt bei typ='mannschaft' ungenutzt/NULL — dort tritt an ihre Stelle
// die editierbare Liste in mannschafts_gewichtsklassen (eine Position pro Team-Gewichtsklasse,
// z.B. ["-43","-50","-60","+60"]).
export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }
    await knex.schema.alterTable('pools', (table) => {
        table.string('typ').notNullable().defaultTo('einzel');
        table.text('mannschafts_gewichtsklassen').nullable();
        table.string('gewichtsklasse').nullable().alter();
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
    await knex.schema.alterTable('pools', (table) => {
        table.dropColumn('typ');
        table.dropColumn('mannschafts_gewichtsklassen');
    });
    await knex.schema.alterTable('pools', (table) => {
        table.string('gewichtsklasse').notNullable().alter();
    });
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}
