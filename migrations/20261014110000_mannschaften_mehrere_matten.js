// Mannschafts-Begegnungen eines Pools dürfen auf unterschiedlichen Matten laufen. Die Matte
// hängt an der Begegnung (und erbt an deren Einzelkämpfe); NULL = Matte des Pools. `runde` ist
// die Spielrunde der Begegnung: Runde n+1 beginnt erst, wenn Runde n des Pools beendet ist,
// damit ein Team nie gleichzeitig auf zwei Matten steht. `pools.mannschafts_matten` merkt sich
// die gewählten Matten (JSON-Liste), damit eine Neu-Erzeugung der Begegnungen sie wieder verteilt.
export async function up(knex) {
    await knex.schema.alterTable('mannschaftskaempfe', (table) => {
        table.integer('kampfflaeche_id').unsigned().nullable()
            .references('id').inTable('kampfflaechen').onDelete('SET NULL');
        table.integer('runde').nullable();
    });
    await knex.schema.alterTable('kaempfe', (table) => {
        table.integer('kampfflaeche_id').unsigned().nullable()
            .references('id').inTable('kampfflaechen').onDelete('SET NULL');
    });
    await knex.schema.alterTable('pools', (table) => {
        table.text('mannschafts_matten').nullable();
    });
}

export async function down(knex) {
    await knex.schema.alterTable('pools', (table) => { table.dropColumn('mannschafts_matten'); });
    await knex.schema.alterTable('kaempfe', (table) => { table.dropColumn('kampfflaeche_id'); });
    await knex.schema.alterTable('mannschaftskaempfe', (table) => {
        table.dropColumn('runde');
        table.dropColumn('kampfflaeche_id');
    });
}
