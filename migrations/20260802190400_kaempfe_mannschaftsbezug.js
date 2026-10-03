// Additiv, nullable: verknüpft einen ganz normalen Einzelkampf mit der Begegnung, zu der er
// gehört (NULL für alle regulären Einzelwettkampf-Kämpfe). mannschaft_gewichtsklasse hält
// fest, welche Team-Positionsklasse dieser Einzelkampf innerhalb der Begegnung repräsentiert.
export async function up(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.integer('mannschaftskampf_id').unsigned().nullable()
            .references('id').inTable('mannschaftskaempfe').onDelete('CASCADE');
        table.string('mannschaft_gewichtsklasse').nullable();
    });
    await knex.schema.alterTable('kaempfe', (table) => {
        table.index('mannschaftskampf_id', 'idx_kaempfe_mannschaftskampf_id');
    });
}

export async function down(knex) {
    await knex.schema.alterTable('kaempfe', (table) => {
        table.dropIndex('mannschaftskampf_id', 'idx_kaempfe_mannschaftskampf_id');
        table.dropColumn('mannschaftskampf_id');
        table.dropColumn('mannschaft_gewichtsklasse');
    });
}
