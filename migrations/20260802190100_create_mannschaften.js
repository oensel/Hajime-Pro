// Eine Mannschaft in einem Mannschafts-Pool. verein ist bewusst freier Text statt FK auf
// vereine (gleiche Begründung wie turnier_teilnehmer.verein: Gastvereine ohne eigenen
// App-Account müssen trotzdem eine Mannschaft melden können).
export async function up(knex) {
    await knex.schema.createTable('mannschaften', (table) => {
        table.increments('id').primary();
        table.integer('turnier_id').unsigned().notNullable()
            .references('id').inTable('turniere').onDelete('CASCADE');
        table.integer('pool_id').unsigned().nullable()
            .references('id').inTable('pools').onDelete('SET NULL');
        table.string('verein').notNullable();
        table.string('bezeichnung').notNullable();
        table.string('status').notNullable().defaultTo('angemeldet');
        table.timestamps(true, true);
        table.index('turnier_id', 'idx_mannschaften_turnier_id');
        table.index('pool_id', 'idx_mannschaften_pool_id');
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('mannschaften');
}
