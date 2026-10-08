// Farbe von Kämpfer 2 (Kämpfer 1 trägt immer Weiß): 'blau' oder 'rot'.
// Reihenfolge der Geltung: Kampf (Scoreboard, live_farbe) > Pool > Turnier.
// pools.farbe_kaempfer2 = NULL bedeutet "vom Turnier übernehmen".
export async function up(knex) {
    await knex.schema.alterTable('turniere', (table) => {
        table.string('farbe_kaempfer2').notNullable().defaultTo('blau');
    });
    await knex.schema.alterTable('pools', (table) => {
        table.string('farbe_kaempfer2').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => { table.dropColumn('farbe_kaempfer2'); });
    await knex.schema.alterTable('turniere', (table) => { table.dropColumn('farbe_kaempfer2'); });
}
