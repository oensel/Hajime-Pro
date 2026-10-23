export const config = { transaction: false };

// Notfall-Schlüssel für den Super-Admin-Zugang (siehe src/services/notfallZugang.js): höchstens eine Zeile, nur der
// SHA-256 des Schlüssels; der Klartext wird bei der Erzeugung einmal angezeigt und nirgends gespeichert.
export async function up(knex) {
    await knex.schema.createTable('notfall_schluessel', (table) => {
        table.increments('id').primary();
        table.string('schluessel_hash', 64).notNullable().unique();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('notfall_schluessel');
}
