export const config = { transaction: false };

// Nachrichten (src/services/nachrichten.js): Kontakt an die Super-Admins, Vereinsanfragen ("Verein nicht aufgeführt")
// und Nachrichten zwischen Vereinsadmins/Mitgliedern. Eine Unterhaltung (nachrichten_threads) hat Teilnehmer
// (nachrichten_teilnehmer) und Nachrichten (nachrichten); `an_super_admins` macht sie für alle aktiven Super-Admins sichtbar.
// Gelesen wird je Konto bis zur letzten gelesenen Nachricht (nachrichten_gelesen).
export async function up(knex) {
    await knex.schema.createTable('nachrichten_threads', (table) => {
        table.increments('id');
        table.text('art').notNullable().defaultTo('nachricht'); // 'kontakt' | 'vereinsanfrage' | 'nachricht'
        table.text('betreff').notNullable();
        table.boolean('an_super_admins').notNullable().defaultTo(false);
        table.text('erstellt_von').nullable().references('id').inTable('benutzer').onDelete('SET NULL');
        table.text('absender_name').notNullable().defaultTo('');
        table.text('absender_email').nullable(); // nur bei Absendern ohne Konto: Antworten gehen per Mail dorthin
        table.text('anfrage_verein').nullable(); // Vereinsanfrage: der gewünschte Vereinsname
        table.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.timestamp('aktualisiert_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index(['an_super_admins', 'aktualisiert_am']);
    });
    await knex.schema.createTable('nachrichten_teilnehmer', (table) => {
        table.integer('thread_id').notNullable().references('id').inTable('nachrichten_threads').onDelete('CASCADE');
        table.text('benutzer_id').notNullable().references('id').inTable('benutzer').onDelete('CASCADE');
        table.primary(['thread_id', 'benutzer_id']);
        table.index(['benutzer_id']);
    });
    await knex.schema.createTable('nachrichten', (table) => {
        table.increments('id');
        table.integer('thread_id').notNullable().references('id').inTable('nachrichten_threads').onDelete('CASCADE');
        table.text('von_benutzer_id').nullable().references('id').inTable('benutzer').onDelete('SET NULL');
        table.text('von_name').notNullable().defaultTo('');
        table.text('text').notNullable();
        table.timestamp('erstellt_am', { useTz: true }).notNullable().defaultTo(knex.fn.now());
        table.index(['thread_id', 'id']);
    });
    await knex.schema.createTable('nachrichten_gelesen', (table) => {
        table.integer('thread_id').notNullable().references('id').inTable('nachrichten_threads').onDelete('CASCADE');
        table.text('benutzer_id').notNullable().references('id').inTable('benutzer').onDelete('CASCADE');
        table.integer('letzte_nachricht_id').notNullable().defaultTo(0);
        table.primary(['thread_id', 'benutzer_id']);
    });
}

export async function down(knex) {
    await knex.schema.dropTableIfExists('nachrichten_gelesen');
    await knex.schema.dropTableIfExists('nachrichten');
    await knex.schema.dropTableIfExists('nachrichten_teilnehmer');
    await knex.schema.dropTableIfExists('nachrichten_threads');
}
