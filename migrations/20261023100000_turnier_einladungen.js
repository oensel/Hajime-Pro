export const config = { transaction: false };

// Vereine, die zu einem Turnier eingeladen wurden ("Turnier teilen" mit Vereinsliste). Die Admins des Vereins sehen
// die offenen Einladungen in der Turnierübersicht. Eine Einladung je (Turnier, Verein).
export async function up(knex) {
    await knex.schema.createTable('turnier_einladungen', (table) => {
        table.increments('id');
        table.integer('turnier_id').notNullable().references('id').inTable('turniere').onDelete('CASCADE');
        table.integer('verein_id').notNullable().references('id').inTable('vereine').onDelete('CASCADE');
        table.string('eingeladen_von');
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.unique(['turnier_id', 'verein_id']);
        table.index('verein_id');
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('turnier_einladungen');
}
