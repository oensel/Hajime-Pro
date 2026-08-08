// Additiv, nullable: verknüpft einen ganz normalen Einzelkampf mit der Begegnung, zu der er
// gehört (NULL für alle regulären Einzelwettkampf-Kämpfe). mannschaft_gewichtsklasse hält
// fest, welche Team-Positionsklasse dieser Einzelkampf innerhalb der Begegnung repräsentiert.
export async function up(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }
    await knex.schema.alterTable('kaempfe', (table) => {
        table.integer('mannschaftskampf_id').unsigned().nullable()
            .references('id').inTable('mannschaftskaempfe').onDelete('CASCADE');
        table.string('mannschaft_gewichtsklasse').nullable();
    });
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
    await knex.schema.alterTable('kaempfe', (table) => {
        table.index('mannschaftskampf_id', 'idx_kaempfe_mannschaftskampf_id');
    });
}

export async function down(knex) {
    const isSqlite = knex.client.config.client === 'sqlite3';
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = OFF;');
    }
    await knex.schema.alterTable('kaempfe', (table) => {
        table.dropIndex('mannschaftskampf_id', 'idx_kaempfe_mannschaftskampf_id');
        table.dropColumn('mannschaftskampf_id');
        table.dropColumn('mannschaft_gewichtsklasse');
    });
    if (isSqlite) {
        await knex.raw('PRAGMA foreign_keys = ON;');
    }
}
