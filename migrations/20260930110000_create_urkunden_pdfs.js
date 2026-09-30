// Zuletzt erzeugtes Urkunden-PDF je Pool (höchstens eines), damit auf urkunden.html erkennbar ist,
// für welche Pools schon Urkunden vorliegen, und das PDF erneut geöffnet werden kann.
// erzeugt_am als ISO-Text, damit SQLite und PostgreSQL denselben Wert liefern.
export async function up(knex) {
    await knex.schema.createTable('urkunden_pdfs', (table) => {
        table.increments('id').primary();
        table.integer('pool_id').unsigned().notNullable().unique().references('id').inTable('pools').onDelete('CASCADE');
        table.integer('vorlage_id').unsigned().nullable().references('id').inTable('urkunden_vorlagen').onDelete('SET NULL');
        table.string('vorlage_name');
        table.string('platzbereich').notNullable();
        table.string('reihenfolge').notNullable();
        table.integer('anzahl').notNullable();
        table.binary('pdf').notNullable();
        table.string('erzeugt_am').notNullable();
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('urkunden_pdfs');
}
