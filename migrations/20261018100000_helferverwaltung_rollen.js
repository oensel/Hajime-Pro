export const config = { transaction: false };

// Helferverwaltung, Teil 1: Rollen je Vereinsmitgliedschaft, E-Mail-Bestätigung und Einmal-Token
// (Bestätigungs-/Reset-Links).
export async function up(knex) {
    await knex.schema.alterTable('benutzer_vereine', (table) => {
        table.string('rolle').nullable();
        table.string('angefragt_ueber').nullable(); // 'helfer-app' | 'verwaltung'
        table.string('entschieden_von').nullable()
            .references('id').inTable('benutzer').onDelete('SET NULL');
        table.timestamp('entschieden_am').nullable();
    });

    await knex.schema.alterTable('benutzer', (table) => {
        table.timestamp('email_bestaetigt_am').nullable();
    });

    // Bestandsdaten: freigegebene Mitgliedschaften werden Admins, alle bisherigen Benutzer gelten als bestätigt.
    await knex('benutzer_vereine').where({ freigegeben: 1 }).update({ rolle: 'admin' });
    await knex('benutzer').update({ email_bestaetigt_am: knex.fn.now() });

    await knex.schema.createTable('token_einmal', (table) => {
        table.increments('id').primary();
        table.string('benutzer_id').notNullable()
            .references('id').inTable('benutzer').onDelete('CASCADE');
        table.string('zweck').notNullable();
        table.integer('verein_id').unsigned().nullable()
            .references('id').inTable('vereine').onDelete('CASCADE');
        table.string('token_hash').notNullable().unique();
        table.timestamp('laeuft_ab_am').notNullable();
        table.timestamp('benutzt_am').nullable();
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('token_einmal');
    await knex.schema.alterTable('benutzer', (table) => {
        table.dropColumn('email_bestaetigt_am');
    });
    await knex.schema.alterTable('benutzer_vereine', (table) => {
        table.dropColumn('entschieden_am');
        table.dropColumn('entschieden_von');
        table.dropColumn('angefragt_ueber');
        table.dropColumn('rolle');
    });
}
